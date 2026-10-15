#!/usr/bin/env python3
"""Authorized public-page acceptance; real free MT, optional isolated Ollama gateway.

No login, challenge bypass, real browser profile, remote LLM, or production gateway.
See README.md for the independent coverage definition and limits of geometry checks.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CACHE = Path.home() / '.cache' / 'duallens-e2e'
PROBE = (HERE / 'acceptance_probe.js').read_text(encoding='utf-8')
MOBILE_UA = ('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
DEVICES = {'desktop': (1280, 800, False), 'phone': (375, 812, True), 'tablet': (800, 1280, True)}
MT_HOSTS = {'edge.microsoft.com', 'api-edge.cognitive.microsofttranslator.com', 'clients5.google.com',
            'translate.googleapis.com', 'translate.google.com'}


def load_sites(path=HERE / 'acceptance_sites.json'):
    sites = json.loads(path.read_text(encoding='utf-8'))
    ids = set()
    for s in sites:
        if not re.fullmatch(r'[a-z0-9-]+', s['id']) or s['id'] in ids:
            raise ValueError('Invalid or duplicate site id')
        ids.add(s['id'])
        if not s['url'].startswith('https://') or not s.get('category'):
            raise ValueError('Sites must be public HTTPS URLs with categories')
    return sites


def outcome(r):
    if r.get('status') in ('UNREACHABLE', 'UNSUPPORTED', 'ERROR'):
        return r['status']
    checks = [r.get('t_first') is not None and r['t_first'] <= 3,
              r.get('coverage') is not None and r['coverage'] >= .95,
              not r.get('layout_issues'), r.get('restore_identical') is True,
              not r.get('visible_errors')]
    return 'PASS' if all(checks) else 'FAIL'


def markdown(rows):
    lines = ['# DualLens real-page acceptance', '',
             'Times are seconds from the command; — means unobserved/not applicable. '
             'PDF coverage uses reader text blocks, not webpage nodes. '
             'UNREACHABLE/UNSUPPORTED never count as PASS.', '',
             '| Page | Device | t_first | t_fill | t_final (LLM) | Coverage | Layout | Restore | Result |',
             '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |']
    def t(v):
        return f'{v:.3f}' if isinstance(v, (int, float)) else '—'
    for r in rows:
        coverage = f"{r['coverage']:.1%}" if r.get('coverage') is not None else '—'
        restored = {True: 'yes', False: 'NO', None: '—'}[r.get('restore_identical')]
        lines.append(f"| {r['id']} | {r['device']} | {t(r.get('t_first'))} | {t(r.get('t_fill'))} | "
                     f"{t(r.get('t_final'))} | {coverage} | {len(r.get('layout_issues', []))} | {restored} | {r['status']} |")
    return '\n'.join(lines) + '\n'


def write_reports(out, metadata, rows):
    counts = {s: sum(r['status'] == s for r in rows) for s in ('PASS', 'FAIL', 'UNREACHABLE', 'UNSUPPORTED', 'ERROR')}
    (out / 'matrix.json').write_text(json.dumps({'metadata': metadata, 'summary': counts, 'rows': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'matrix.md').write_text(markdown(rows), encoding='utf-8')
    for r in rows:
        (out / f"{r['id']}-{r['device']}.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding='utf-8')
    return counts


def direct_request(req):
    """GM-equivalent anonymous HTTP, on a worker thread. Never forward page cookies."""
    from urllib.parse import urlsplit
    url = urlsplit(req['url'])
    if url.scheme != 'https' or url.hostname not in MT_HOSTS or url.username or url.password:
        raise ValueError('Userscript test transport only permits free MT hosts')
    headers = {k: v for k, v in req.get('headers', {}).items() if k.lower() not in ('cookie', 'authorization', 'proxy-authorization')}
    data = req.get('data')
    request = urllib.request.Request(req['url'], data=data.encode('utf-8') if isinstance(data, str) else None,
                                     headers=headers, method=req.get('method', 'GET'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    # Reject redirects to unapproved destinations before opening them.
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            target = urlsplit(newurl)
            if target.scheme != 'https' or target.hostname not in MT_HOSTS:
                raise ValueError('MT redirect rejected')
            return super().redirect_request(request, fp, code, msg, headers, newurl)
    opener.add_handler(Redirect())
    try:
        timeout_ms = req.get('timeout') or 30000  # GM timeout=0 means no manager timeout
        response = opener.open(request, timeout=min(30, timeout_ms / 1000))
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        body = response.read(4 * 1024 * 1024 + 1)
        if len(body) > 4 * 1024 * 1024:
            raise ValueError('MT response too large')
        return {'status': response.code, 'responseText': body.decode('utf-8'), 'responseHeaders': str(response.headers)}


GM_STUB = r"""(settings) => {
  const data=new Map([['duallens:local', {'settings.core':settings}]]), listeners=new Map(), commands=new Map(), roots=[];
  const attach=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(init) {const root=attach.call(this,init);if(this.localName==='dl-ui')roots.push({host:this,root});return root;};
  window.GM_getValue=(k,d)=>structuredClone(data.get(k)??d);
  window.GM_setValue=(k,v)=>{const old=data.get(k);data.set(k,structuredClone(v));for(const cb of listeners.get(k)||[])cb(k,old,v,false);};
  window.GM_deleteValue=k=>data.delete(k);
  window.GM_addValueChangeListener=(k,cb)=>{if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(cb);return listeners.get(k).length;};
  window.GM_registerMenuCommand=(label,fn)=>commands.set(label,fn);
  window.GM_xmlhttpRequest=req=>{let stopped=false;window.__acceptanceHTTP({url:req.url,method:req.method,headers:req.headers,data:req.data,timeout:req.timeout})
    .then(r=>{if(!stopped)req.onload?.(r);}).catch(()=>{if(!stopped)req.onerror?.({status:0});});
    return {abort(){stopped=true;req.onabort?.();}};};
  window.__acceptanceGM={ready:()=>commands.has('翻译 / 恢复当前页面'),toggle:()=>commands.get('翻译 / 恢复当前页面')(),
    ui:()=>roots.filter(r=>r.host.isConnected).flatMap(r=>[...r.root.querySelectorAll('*')]).filter(e=>{
      const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&b.width&&b.height;
    }).filter(e=>e.matches('.toast,.error,[role=alert],.spinner')).map(e=>({type:e.className,text:e.textContent.slice(0,160)}))};
}"""

PDF_SAMPLE = r"""({n,ids})=>{
  const blocks=__duallensPdfBlocks(n).filter(b=>ids.includes(b.id));
  // Classify immutable source, never exclude merely because an item is skip.
  // 120 means diagnostic truncation: keep uncertain sources in the denominator.
  const exceptions=blocks.filter(b=>b.source && b.source.length<120 && !__dlAcceptance.eligible(b.source.replace(/<[^>]*>/g,'')));
  const except=new Set(exceptions.map(b=>b.id));
  return {elapsed:(performance.now()-__acceptancePdfStart)/1000,total:ids.length-except.size,
    exclusions:exceptions.map(b=>({id:b.id,source:b.source.slice(0,40),reason:'source-code-url-number-or-target-language'})),
    blocks:blocks.filter(b=>!except.has(b.id)),
    painted:[...document.querySelectorAll(`.pdf-page[data-page="${n}"] .tb`)].filter(e=>!except.has(+e.dataset.block)).map(e=>({id:+e.dataset.block,stage:e.dataset.stage,
      text:e.textContent,unrefined:e.title.includes('显示的是机器翻译'),visible:e.getBoundingClientRect().top<innerHeight&&e.getBoundingClientRect().bottom>0}))};}"""


def gateway_child(repo, home):
    """Read existing configuration in memory; all writes go to the private test home.

    The serve CLI has no backend restriction flags. Instantiate its identical server
    with an in-memory Ollama-only policy instead of rewriting user's gateway.json.
    """
    if home.name != 'gateway' or not home.parent.name.startswith('run-acceptance-') or home.parent.parent != CACHE.resolve():
        raise ValueError('Test gateway state must be inside its owned acceptance cache directory')
    spec = importlib.util.spec_from_file_location('acceptance_gateway', repo / 'gateway' / 'duallens_gateway.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = module.config_load()  # never print/copy the user's configuration
    for backend in ('sjtu', 'hermes', 'claude', 'codex'):
        config[backend]['enabled'] = False
    config['remote']['enabled'] = False
    config['port'] = 18799
    available = config['ollama'].get('models', [])
    model = 'qwen3:4b' if 'qwen3:4b' in available else next((m for m in available if not re.search(r'(?:20|30|70)b', m)), None)
    if not model:
        raise RuntimeError('No permitted small Ollama model in existing configuration')
    config['auto']['prefer'] = ['ollama/' + model]
    home.mkdir(parents=True, exist_ok=True)
    gateway = module.Gateway(home=home, config=config)
    server = module.make_server(port=18799, gateway=gateway)
    print('ACCEPTANCE gateway ready: port=18799 policy=ollama-only sjtu=0', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


async def start_gateway(repo, run):
    # Do not connect to or kill a pre-existing process occupying the test port.
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1', 18799)) == 0:
            raise RuntimeError('Port 18799 already in use; refusing to reuse or stop it')
    child = await asyncio.create_subprocess_exec(sys.executable, '-B', str(Path(__file__).resolve()),
        '--gateway-child', '--repo', str(repo), '--out', str(run / 'gateway'),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        line = await asyncio.wait_for(child.stdout.readline(), 15)
        if not line.startswith(b'ACCEPTANCE gateway ready:'):
            raise RuntimeError('Temporary gateway failed to start (configuration details withheld)')
    except BaseException:
        if child.returncode is None:
            child.terminate()
            await child.wait()
        raise
    return child


class Browser:
    def __init__(self, pw, ext, bundle, run, device, llm):
        self.pw, self.ext, self.bundle, self.run, self.device, self.llm = pw, ext, bundle, run, device, llm
        self.ctx = self.sw = self.ext_id = None
        self.transport = {}
        self.http_tasks = {}
        self.profile = run / ('profile-' + device)

    async def start(self):
        width, height, touch = DEVICES[self.device]
        opts = dict(headless=False, viewport={'width': width, 'height': height},
                    args=['--headless=new', '--no-first-run', '--no-default-browser-check', '--no-proxy-server'],
                    has_touch=touch, is_mobile=touch)
        if touch:
            opts['user_agent'] = MOBILE_UA.replace(' Mobile', '') if self.device == 'tablet' else MOBILE_UA
        else:
            opts['args'] += [f'--disable-extensions-except={self.ext}', f'--load-extension={self.ext}']
            opts['ignore_default_args'] = ['--disable-extensions']
        self.ctx = await self.pw.chromium.launch_persistent_context(str(self.profile), **opts)
        if touch:
            async def http(source, req):
                from urllib.parse import urlsplit
                began = time.monotonic()
                record = {'host': urlsplit(req['url']).hostname}
                pending = self.http_tasks.setdefault(source['page'], set())
                pending.add(asyncio.current_task())
                try:
                    result = await asyncio.to_thread(direct_request, req)
                    record['status'] = result['status']
                    return result
                except Exception as exc:
                    record['error_class'] = type(exc).__name__
                    raise
                finally:
                    record['seconds'] = time.monotonic() - began
                    self.transport.setdefault(source['page'], []).append(record)
                    pending.discard(asyncio.current_task())
            await self.ctx.expose_binding('__acceptanceHTTP', http)
        else:
            self.sw = next((w for w in self.ctx.service_workers if w.url.startswith('chrome-extension:')), None)
            if self.sw is None:
                self.sw = await self.ctx.wait_for_event('serviceworker', timeout=20000)
            self.ext_id = self.sw.url.split('/')[2]
            bridge = await self.ctx.new_page()
            await bridge.goto(f'chrome-extension://{self.ext_id}/ui/options.html')
            await bridge.evaluate("""async patch=>{const {saveSettings}=await import('../shared/settings.js');await saveSettings(patch);}""", settings(self.llm))
            await bridge.close()

    async def attach(self, page):
        if self.device != 'desktop':
            # Match the canonical userscript runner: GM storage is private to this page
            # instance, real anonymous HTTP is supplied by the test host. Security of
            # Tampermonkey's isolated world is deliberately NOT claimed by this harness.
            await page.evaluate(GM_STUB, settings(self.llm))
            await page.evaluate(self.bundle.read_text(encoding='utf-8'))
            await page.wait_for_function('window.__acceptanceGM?.ready()', timeout=20000)
            return None
        tab = await self.sw.evaluate("async u=>(await chrome.tabs.query({})).find(t=>t.url===u)?.id", page.url)
        if tab is None:
            raise RuntimeError('Extension tab not found')
        for _ in range(60):
            r = await self.send(tab, {'type': 'get-state'})
            if r is not None:
                return tab
            await page.wait_for_timeout(200)
        raise RuntimeError('Content script not ready')

    async def send(self, tab, msg):
        return await self.sw.evaluate("""async ({tab,msg})=>{try{return await chrome.tabs.sendMessage(tab,msg);}catch{return null;}}""", {'tab': tab, 'msg': msg})

    async def toggle(self, page, tab):
        if self.device == 'desktop':
            result = await self.send(tab, {'type': 'command', 'name': 'toggle-page'})
            if result is None:
                raise RuntimeError('Translation command not delivered')
        else:
            await page.evaluate('__acceptanceGM.toggle()')

    async def close(self):
        if self.ctx:
            await self.ctx.close()

    async def drain(self, page):
        tasks = list(self.http_tasks.pop(page, set()))
        if tasks:
            # User-triggered restore has cancelled delivery. Finish bounded anonymous
            # host reads before closing the binding's frame; no late Channel.send
            # callbacks should target a destroyed page.
            await asyncio.gather(*tasks, return_exceptions=True)
            await page.wait_for_timeout(100)


def settings(llm):
    patch = {'version': 2, 'targetLang': 'zh-CN', 'sourceLang': 'auto', 'cache': {'enabled': False},
             'translation': {'mode': 'mt+llm', 'refineTimeoutMs': 90000, 'mt': {'engine': 'microsoft', 'fallback': True}},
             'provider': {'active': '', 'chain': []}}
    if llm == 'gateway':
        patch['provider'] = {'active': 'acceptance', 'chain': [{'profileId': 'acceptance', 'model': 'auto'}],
            'profiles': [{'id': 'acceptance', 'name': 'Temporary acceptance gateway', 'kind': 'gateway',
                'baseUrl': 'http://127.0.0.1:18799/v1', 'model': 'auto', 'jsonMode': True,
                'maxItems': 12, 'maxChars': 2000, 'concurrency': 2, 'timeoutMs': 95000, 'fallbackModels': []}]}
    return patch


async def unreachable(page, response):
    if response is not None and response.status >= 400:
        return f'HTTP {response.status}'
    info = await page.evaluate("""()=>({title:document.title,text:document.body?.innerText.slice(0,4000)||'',
      challenge:[...document.querySelectorAll('#challenge-form,iframe[src*=captcha],#captcha,.g-recaptcha')].some(e=>{
        const r=e.getBoundingClientRect();
        if(r.width<200||r.height<120||r.top>=innerHeight||r.bottom<=0)return false;
        for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;}
        return true;
      }),url:location.href})""")
    if info['challenge']:
        return 'Human verification challenge; not bypassed'
    if re.search(r'(just a moment|access denied|robot check|captcha|verify you are human|security checkpoint)', info['title'], re.I):
        return 'Access/challenge page: ' + info['title'][:100]
    if re.search(r'(sign in to (?:x|twitter)|log in to (?:x|twitter)|you.ve been blocked|enable javascript and cookies to continue|unusual traffic)', info['text'], re.I):
        return 'Login or access wall; not bypassed'
    if '/login' in info['url'] or '/i/flow/' in info['url']:
        return 'Redirected to login; not attempted'
    return None


async def screenshot(page, out, stem, issues):
    paths, errors = [], []
    async def capture(filename, clip=None):
        # Native Chromium capture avoids Playwright caret/style mutation, font
        # waits on blocked pages, and viewport-only clipping of PDF page 11.
        client = await page.context.new_cdp_session(page)
        try:
            options = {'format': 'png', 'fromSurface': True, 'captureBeyondViewport': True}
            if clip is None:
                try:
                    clip = await page.evaluate('()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})')
                except Exception:
                    size = page.viewport_size or DEVICES['desktop'][:2]
                    if not isinstance(size, dict):
                        size = dict(zip(('width', 'height'), size))
                    clip = {'x': 0, 'y': 0, **size}
            options['clip'] = {**clip, 'scale': 1}
            result = await asyncio.wait_for(client.send('Page.captureScreenshot', options), 12)
            (out / filename).write_bytes(base64.b64decode(result['data']))
        finally:
            with contextlib.suppress(Exception):
                await client.detach()
    try:
        full_clip = await page.evaluate("""()=>({x:0,y:scrollY,width:innerWidth,height:Math.min(innerHeight*4,Math.max(innerHeight,document.documentElement.scrollHeight-scrollY))})""")
    except Exception:
        size = page.viewport_size or {'width': 1280, 'height': 800}
        full_clip = {'x': 0, 'y': 0, **size}
    for label, clip in [('viewport', None), ('full', full_clip)]:
        filename = stem + '-' + label + '.png'
        try:
            await capture(filename, clip)
            paths.append(filename)
        except Exception as exc:
            errors.append(label + ' screenshot failed: ' + type(exc).__name__)
    # One screenshot per issue. No scroll_into_view: screenshots must not trigger
    # additional lazy translations or alter the measured viewport cohort.
    for i, issue in enumerate(issues):
        b = issue.get('box', {})
        if not b or b['width'] <= 0 or b['height'] <= 0:
            continue
        clip = {'x': max(0, b['x'] - 8), 'y': max(0, b['y'] + await page.evaluate('scrollY') - 8),
                'width': min(DEVICES[stem.split('-')[-1]][0] if stem.split('-')[-1] in DEVICES else 1280, b['width'] + 16),
                'height': min(1600, b['height'] + 16)}
        filename = f'{stem}-issue-{i:03}.png'
        try:
            await capture(filename, clip)
            issue['screenshot'] = filename
        except Exception:
            issue['screenshot_error'] = 'Element clip unavailable'
    return paths, errors


async def visible_errors(browser, page, tab):
    errors = await page.evaluate("""()=>[...document.querySelectorAll('dl-r,dl-t[data-dl-state=error],dl-t[data-dl-state=pending]')].filter(e=>{
      const r=e.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0;
    }).map(e=>({type:e.localName,state:e.dataset.dlState,text:(e.title||e.textContent).slice(0,160)}))""")
    if browser.device == 'desktop':
        state = await browser.send(tab, {'type': 'get-state'})
        if state:
            # Only numeric/boolean status; never save source-bearing UI responses.
            return errors, {k: state.get(k) for k in ('units', 'pending', 'done', 'failed', 'refining', 'translated')}
    else:
        errors.extend(await page.evaluate('__acceptanceGM.ui()'))
    return errors, None


async def web_case(browser, site, out, theme, timeout):
    device = browser.device + ('-dark' if theme == 'dark' else '')
    r = {'id': site['id'], 'category': site['category'], 'device': device, 'url': site['url'],
         'coverage_kind': 'frozen-visible-text-nodes-plus-placeholders', 'llm': browser.llm}
    page = await browser.ctx.new_page()
    page.set_default_timeout(15000)
    await page.emulate_media(color_scheme=theme)
    try:
        try:
            nav_started = time.monotonic()
            response = await page.goto(site['url'], wait_until='domcontentloaded', timeout=25000)
            r['navigation_seconds'] = time.monotonic() - nav_started
        except Exception as exc:
            r.update(status='UNREACHABLE', reason=re.sub(r'https?://\S+', '<url>', str(exc).split('Call log:')[0])[:260])
            with contextlib.suppress(Exception):
                r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
            return r
        await page.wait_for_timeout(2000)
        reason = await unreachable(page, response)
        if reason:
            r.update(status='UNREACHABLE', reason=reason)
            r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
            return r
        if site.get('ready_selector'):
            try:
                await page.locator(site['ready_selector']).first.wait_for(state='visible', timeout=20000)
            except Exception:
                r.update(status='UNREACHABLE', reason='Public content readiness timeout (no login/challenge bypass attempted)')
                r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
                return r
        r['final_url'] = page.url
        r['emulation'] = await page.evaluate("""()=>({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,android:navigator.userAgent.includes('Android')})""")
        tab = await browser.attach(page)
        await page.evaluate(PROBE)
        r['cohort'] = await page.evaluate('__dlAcceptance.freeze()')
        content_deadline = time.monotonic() + 10
        while not r['cohort']['total'] and time.monotonic() < content_deadline:
            # Hydrated SPAs can paint an empty heading before filling its text.
            # Readiness precedes the trigger; never time an empty skeleton as if
            # the user had a readable article to translate.
            await page.wait_for_timeout(250)
            r['cohort'] = await page.evaluate('__dlAcceptance.freeze()')
        if not r['cohort']['total']:
            r.update(status='FAIL', reason='No eligible visible text; coverage cannot be claimed')
            r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
            return r
        # A no-translation control interval makes dynamic-site restore failures reviewable.
        await page.wait_for_timeout(500)
        r['control_restore'] = await page.evaluate('__dlAcceptance.restoreResult()')
        # Refresh the frozen cohort immediately before the one and only trigger.
        r['cohort'] = await page.evaluate('__dlAcceptance.freeze()')
        await page.evaluate('__dlAcceptance.start()')
        await browser.toggle(page, tab)
        deadline = time.monotonic() + timeout
        idle_since = None
        observed_start = time.monotonic()
        s = None
        while time.monotonic() < deadline:
            s = await page.evaluate('__dlAcceptance.sample()')
            if s.get('t_fill') is not None and (browser.llm == 'none' or s.get('t_final') is not None):
                break
            # A partial result with no pending/draft nodes cannot improve without a
            # new page mutation. Preserve missing marks; do not spend the entire
            # timeout waiting for an unsupported placeholder to translate itself.
            busy = await page.evaluate("!!document.querySelector('dl-t[data-dl-state=pending],dl-t[data-dl-stage=draft]')")
            if s['covered'] and not busy:
                idle_since = idle_since or time.monotonic()
                if time.monotonic() - observed_start >= 5 and time.monotonic() - idle_since >= 2:
                    r['observation_ended'] = 'quiescent-partial-result'
                    break
            else:
                idle_since = None
            await page.wait_for_timeout(100)
        r.update(s or {})
        r['missing_diagnostics'] = await page.evaluate('__dlAcceptance.diagnose()')
        r['layout_issues'] = await page.evaluate('__dlAcceptance.layout(' + ('true' if theme == 'dark' else 'false') + ')')
        r['visible_errors'], r['state'] = await visible_errors(browser, page, tab)
        r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, r['layout_issues'])
        await browser.toggle(page, tab)
        await page.wait_for_function("!document.querySelector('dl-t,dl-o,dl-w,dl-r')", timeout=15000)
        r.update(await page.evaluate('__dlAcceptance.restoreResult()'))
        r['status'] = outcome(r)
    except Exception as exc:
        r.update(status='ERROR', reason=type(exc).__name__ + ': ' + str(exc).split('Call log:')[0][:300])
        with contextlib.suppress(Exception):
            r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
    finally:
        if browser.device != 'desktop':
            await browser.drain(page)
            r['transport'] = browser.transport.pop(page, [])
        await page.close()
    return r


async def pdf_case(browser, site, out, number, theme, timeout):
    from urllib.parse import quote
    device = browser.device + ('-dark' if theme == 'dark' else '')
    r = {'id': site['id']+f'-p{number}', 'site_id': site['id'], 'category': site['category'], 'device': device,
         'url': site['url'], 'llm': browser.llm, 'coverage_kind': 'pdf-reader-visible-text-blocks'}
    if browser.device != 'desktop':
        return {**r, 'status': 'UNSUPPORTED', 'reason': 'PDF reader is extension-only (PLATFORMS/PDF contract)'}
    page = await browser.ctx.new_page()
    failures = []
    script_errors = []
    page.on('requestfailed', lambda req: failures.append(req.failure))
    page.on('pageerror', lambda error: script_errors.append(str(error)[:200]))
    async def wait_eval(expression, arg=None, seconds=35):
        # As in the canonical PDF suite, avoid wait_for_function's string
        # evaluation under extension CSP. Never loosen CSP for an acceptance test.
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if await page.evaluate(expression, arg):
                return
            await page.wait_for_timeout(100)
        raise TimeoutError('PDF readiness deadline')
    try:
        await page.emulate_media(color_scheme=theme)
        await page.goto(f'chrome-extension://{browser.ext_id}/pdf/viewer.html?file='+quote(site['url'], safe=''))
        try:
            await wait_eval("()=>!document.querySelector('#translate').disabled || !!document.querySelector('#status.error')")
        except TimeoutError:
            r.update(status='FAIL' if script_errors else 'UNREACHABLE', reason='PDF load timed out; no bypass/download fallback attempted',
                     request_failures=failures, script_errors=script_errors)
            return r
        error = await page.locator('#status').evaluate("e=>e.classList.contains('error')?e.textContent:null")
        if error:
            r.update(status='UNREACHABLE', reason=error[:200])
            return r
        await page.locator('#page-number').fill(str(number))
        await page.locator('#jump').click()
        shell = f'.pdf-page[data-page="{number}"]'
        await page.locator(shell).scroll_into_view_if_needed()
        await wait_eval('(n)=>window.__duallensPdfBlocks?.(n).length>0', arg=number, seconds=25)
        await page.wait_for_timeout(800)
        # PDF uses its local segmentation diagnostics (not the page walker). Restrict to
        # text-kind blocks; formulas/page numbers are preserved in original canvas.
        ids = await page.evaluate("""n=>__duallensPdfBlocks(n).filter(b=>b.kind==='text').map(b=>b.id)""", number)
        r['total'] = len(ids)
        original_selector = shell + ' .sheet.orig'
        source_dom = await page.locator(original_selector).evaluate('e=>e.outerHTML')
        pixel_digest = """async e=>{const c=e.querySelector('canvas');if(!c)return null;
          const bytes=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          const hash=await crypto.subtle.digest('SHA-256',bytes);
          return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}"""
        source_pixels = await page.locator(original_selector).evaluate(pixel_digest)
        await page.evaluate(PROBE)
        await page.evaluate('__dlAcceptance.freeze()')
        await page.evaluate("window.__acceptancePdfStart=performance.now();document.querySelector('#translate').click()")
        end = time.monotonic() + timeout
        latest = []
        while time.monotonic() < end:
            data = await page.evaluate(PDF_SAMPLE, {'n': number, 'ids': ids})
            latest = data['blocks']
            r['total'] = data['total']
            r['pdf_exclusions'] = data['exclusions']
            done = [b for b in data['painted'] if re.search('[\u4e00-\u9fff]', b['text'])]
            if any(b['visible'] for b in done):
                r.setdefault('t_first', data['elapsed'])
            if data['total'] and len(done) == data['total']:
                r.setdefault('t_fill', data['elapsed'])
                if browser.llm == 'none':
                    break
                if all(b['stage'] == 'final' and not b['unrefined'] for b in done):
                    r.setdefault('t_final', data['elapsed'])
                    break
            await page.wait_for_timeout(100)
        r['covered'] = sum(bool(b.get('text')) and b.get('state') in ('draft', 'final') and bool(re.search('[\u4e00-\u9fff]', b['text'])) for b in latest)
        r['coverage'] = r['covered'] / r['total'] if r['total'] else None
        r['missing'] = [{k: b.get(k) for k in ('id', 'kind', 'state', 'source', 'error')} for b in latest if b.get('state') not in ('draft', 'final')]
        r['layout_issues'] = await page.evaluate('__dlAcceptance.layout(' + ('true' if theme == 'dark' else 'false') + ')')
        r['visible_errors'] = await page.locator('.tb-retry,.tb-wait,#status.error').all_text_contents()
        r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, r['id']+'-'+device, r['layout_issues'])
        await page.locator('#restore').click()
        await page.wait_for_timeout(400)
        r.update(await page.evaluate('__dlAcceptance.restoreResult()'))
        r['pdf_source_dom_identical'] = source_dom == await page.locator(original_selector).evaluate('e=>e.outerHTML')
        r['pdf_original_pixels_identical'] = source_pixels == await page.locator(original_selector).evaluate(pixel_digest)
        r['status'] = outcome(r)
    except Exception as exc:
        r.update(status='ERROR', reason=type(exc).__name__ + ': ' + str(exc).split('Call log:')[0][:300])
    finally:
        with contextlib.suppress(Exception):
            if not r.get('screenshots'):
                r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, r['id']+'-'+device, [])
        await page.close()
    return r


async def run(args):
    # Import canonical staging/cleanup, not its synthetic test settings or test transport.
    import run_e2e as canonical
    from playwright.async_api import async_playwright
    repo = args.repo.resolve()
    sites = load_sites()
    unknown = set(args.only) - {s['id'] for s in sites}
    if unknown:
        raise ValueError('Unknown --only: ' + ', '.join(sorted(unknown)))
    if args.only:
        sites = [s for s in sites if s['id'] in args.only]
    if args.llm == 'gateway' and args.device != 'desktop':
        raise ValueError('--llm gateway requires --device desktop (never expose loopback config to mobile)')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:6]
    if args.resume and args.out:
        raise ValueError('--resume cannot be combined with --out')
    out = args.resume.resolve() if args.resume else args.out.resolve() if args.out else CACHE / 'v04' / 'acceptance' / stamp
    previous = json.loads((out / 'matrix.json').read_text(encoding='utf-8')) if args.resume else None
    if previous and (previous['metadata']['repo'] != str(repo) or previous['metadata']['llm'] != args.llm):
        raise ValueError('Resume requires the identical checkout path and LLM mode')
    if not args.resume and out.exists() and any(out.iterdir()):
        raise ValueError('--out must be empty; never overwrite prior acceptance evidence')
    if out == repo or repo in out.parents:
        raise ValueError('Evidence/profile output must stay outside the checkout')
    out.mkdir(parents=True, exist_ok=True)
    run_dir = CACHE / ('run-acceptance-' + uuid.uuid4().hex[:10])
    run_dir.mkdir(parents=True)
    rows, child = previous['rows'] if previous else [], None
    reports_allowed = previous is None
    completed = {(r['id'], r['device']) for r in rows}
    metadata = {'run_id': stamp, 'started_utc': datetime.now(timezone.utc).isoformat(), 'repo': str(repo),
        'llm': args.llm, 'policy': 'real-free-MT; gateway auto restricted to local Ollama; SJTU=0; no Claude/Codex',
        'emulation_only': True, 'coverage_version': 2, 'timeout_seconds': args.timeout or (95 if args.llm == 'gateway' else 25),
        'probe_sha256': hashlib.sha256(PROBE.encode('utf-8')).hexdigest(),
        'limits': ['Desktop Chromium only, not actual Chrome/Edge or physical Android',
                   'Structural Chinese-output coverage, not semantic translation quality',
                   'Layout findings are objective geometry candidates requiring screenshot review',
                   'Only initially visible text; no login, consent clicks, comment expansion, or caption opening',
                   'PDF denominator is reader text blocks on requested page; not comparable to web nodes',
                   'Restoration compares body serialization, including autonomous site mutations']}
    if previous:
        if previous['metadata'].get('coverage_version') != metadata['coverage_version']:
            raise ValueError('Coverage algorithm changed; use a fresh output directory')
        metadata['run_id'] = previous['metadata']['run_id']
        metadata['started_utc'] = previous['metadata']['started_utc']
        metadata['resumed_utc'] = [*previous['metadata'].get('resumed_utc', []), datetime.now(timezone.utc).isoformat()]
        metadata['resume_note'] = 'Existing finished rows retained; remaining cases use current harness. See per-row observation_ended.'
    try:
        ext, missing = canonical.stage_extension(run_dir, repo / 'extension')
        if missing:
            raise RuntimeError('Extension runtime references missing: ' + ', '.join(missing))
        metadata['extension_sha256'] = hashlib.sha256((ext / 'manifest.json').read_bytes()).hexdigest()
        digest = hashlib.sha256()
        for file in sorted(p for p in ext.rglob('*') if p.is_file()):
            digest.update(file.relative_to(ext).as_posix().encode('utf-8'))
            digest.update(file.read_bytes())
        metadata['extension_tree_sha256'] = digest.hexdigest()
        if previous and previous['metadata']['extension_tree_sha256'] != digest.hexdigest():
            raise ValueError('Extension changed since checkpoint; run into a fresh output directory')
        revision = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        metadata['revision'] = revision.stdout.strip() if revision.returncode == 0 else 'unknown'
        bundle = run_dir / 'duallens.user.js'
        built = await asyncio.create_subprocess_exec('node', str(repo / 'scripts/build_userscript.mjs'), '--output', str(bundle),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await built.communicate()
        if built.returncode:
            raise RuntimeError('Userscript build failed: ' + stderr.decode('utf-8', errors='replace')[:300])
        print(stdout.decode('utf-8').strip(), flush=True)
        metadata['userscript_sha256'] = hashlib.sha256(bundle.read_bytes()).hexdigest()
        if previous and previous['metadata']['userscript_sha256'] != metadata['userscript_sha256']:
            raise ValueError('Userscript changed since checkpoint; run into a fresh output directory')
        reports_allowed = True
        if args.llm == 'gateway':
            child = await start_gateway(repo, run_dir)
        async with async_playwright() as pw:
            devices = list(DEVICES) if args.device == 'all' else [args.device]
            for device in devices:
                browser = Browser(pw, ext, bundle, run_dir, device, args.llm)
                try:
                    await browser.start()
                    metadata['browser_version'] = browser.ctx.browser.version if browser.ctx.browser else 'persistent Chromium'
                    for site in sites:
                        for theme in (['light', 'dark'] if device == 'desktop' and args.llm == 'none' else ['light']):
                            numbers = site.get('pages', [1]) if site.get('kind') == 'pdf' else [None]
                            for number in numbers:
                                case_id = site['id'] + (f'-p{number}' if number else '')
                                case_device = device + ('-dark' if theme == 'dark' else '')
                                if (case_id, case_device) in completed:
                                    continue
                                fn = pdf_case(browser, site, out, number, theme, metadata['timeout_seconds']) if number else web_case(browser, site, out, theme, metadata['timeout_seconds'])
                                r = await fn
                                rows.append(r)
                                write_reports(out, metadata, rows)
                                print(f"RESULT {r['id']} {r['device']} {r['status']} first={r.get('t_first')} coverage={r.get('coverage')} layout={len(r.get('layout_issues', []))} restore={r.get('restore_identical')}" + (' reason='+r['reason'] if r.get('reason') else ''), flush=True)
                finally:
                    await browser.close()
        metadata['complete'] = True
    finally:
        if child and child.returncode is None:
            child.terminate()
            await child.wait()
        if args.llm == 'gateway':
            metadata['gateway_stopped'] = child is not None and child.returncode is not None
            metadata['sjtu_calls'] = 0
            log = run_dir / 'gateway' / 'gateway.log'
            if log.exists():
                # Gateway log is source-free numeric metadata, but retain only a safe
                # aggregation, never arbitrary user configuration or response payloads.
                events = [json.loads(x) for x in log.read_text(encoding='utf-8').splitlines()]
                metadata['gateway_requests'] = len(events)
                metadata['gateway_served'] = sorted({e.get('served', '') for e in events})
                metadata['gateway_status_counts'] = {str(status): sum(e.get('status') == status for e in events) for status in sorted({e.get('status', 0) for e in events})}
        counts = write_reports(out, metadata, rows) if reports_allowed else {}
        canonical.remove_runtime_dir(run_dir)
    print('SUMMARY acceptance total=' + str(len(rows)) + ' ' + ' '.join(f'{k}={v}' for k,v in counts.items()) + ' out=' + str(out), flush=True)
    return 1 if any(r['status'] != 'PASS' for r in rows) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=REPO)
    parser.add_argument('--only', action='append', default=[])
    parser.add_argument('--device', choices=['desktop', 'phone', 'tablet', 'all'], default='all')
    parser.add_argument('--llm', choices=['none', 'gateway'], default='none')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--resume', type=Path, help='Resume a checkpoint directory; extension/userscript hashes must match')
    parser.add_argument('--timeout', type=float, help='Observation deadline in seconds (default MT=25/gateway=95)')
    parser.add_argument('--gateway-child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.gateway_child:
        gateway_child(args.repo.resolve(), args.out.resolve())
        return 0
    if args.timeout is not None and not 3 <= args.timeout <= 180:
        parser.error('--timeout must be 3..180 seconds')
    try:
        return asyncio.run(run(args))
    except (ValueError, RuntimeError) as exc:
        print('ERROR acceptance: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Authorized public-page acceptance; free MT and an optional user-supplied OpenAI-compatible URL.

No login, challenge bypass, real browser profile, implicit model-service configuration.
See README.md for the independent coverage definition and limits of geometry checks.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
import tempfile
CACHE = Path(os.environ.get('DUALLENS_E2E_OUT') or Path(tempfile.gettempdir()) / 'duallens-e2e').expanduser().resolve()
PROBE = (HERE / 'acceptance_probe.js').read_text(encoding='utf-8')
MOBILE_UA = ('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
DEVICES = {'desktop': (1280, 800, False), 'phone': (375, 812, True), 'tablet': (800, 1280, True)}
MT_HOSTS = {'edge.microsoft.com', 'api-edge.cognitive.microsofttranslator.com', 'clients5.google.com',
            'translate.googleapis.com', 'translate.google.com'}
DESKTOP_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')


def apply_restore_control(result, control):
    """Only the same structural element/attribute may be explained by the control.

    Text/order changes and dl residue are never excused. A failed control explains
    nothing. Keep every raw delta (including strict body diff) for review.
    """
    allowed = {(x['path'], x['attribute']) for x in [*control.get('restore_attributes', []), *control.get('restore_attribute_activity', [])]
               if x['attribute'] != '__element_removed__'} if control.get('complete') else set()
    explained, unexplained = [], []
    for delta in result.get('restore_attributes', []):
        (explained if (delta['path'], delta['attribute']) in allowed else unexplained).append(delta)
    result['restore_site_attribute_changes'] = explained
    result['restore_unexplained_attributes'] = unexplained
    result['restore_identical'] = not (unexplained or result.get('restore_text_changes') or result.get('restore_residue'))
    return result


def pdf_restore_verdict(result):
    """Reader chrome is exempt; original layer/rendering and residue are not."""
    return (result.get('pdf_source_dom_identical') is True and
            result.get('pdf_original_pixels_identical') is True and
            not result.get('restore_residue'))


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
        label = r['id'] + (f" (替补 {r['fallback_for']})" if r.get('fallback_for') else '')
        lines.append(f"| {label} | {r['device']} | {t(r.get('t_first'))} | {t(r.get('t_fill'))} | "
                     f"{t(r.get('t_final'))} | {coverage} | {len(r.get('layout_issues', []))} | {restored} | {r['status']} |")
    return '\n'.join(lines) + '\n'


def write_reports(out, metadata, rows):
    counts = {s: sum(r['status'] == s for r in rows) for s in ('PASS', 'FAIL', 'UNREACHABLE', 'UNSUPPORTED', 'ERROR')}
    (out / 'matrix.json').write_text(json.dumps({'metadata': metadata, 'summary': counts, 'rows': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'matrix.md').write_text(markdown(rows), encoding='utf-8')
    for r in rows:
        (out / f"{r['id']}-{r['device']}.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding='utf-8')
    return counts


def validate_llm_url(value):
    from urllib.parse import urlsplit
    from ipaddress import ip_address, ip_network
    if value == 'none':
        return value
    url = urlsplit(value)
    local = url.hostname == 'localhost'
    try:
        address = ip_address(url.hostname or '')
        local = local or address.is_loopback or address in ip_network('10.' + '0.0.0/8') or address in ip_network('172.' + '16.0.0/12') or address in ip_network('192.' + '168.0.0/16') or address in ip_network('100.64.0.0/10')
    except ValueError:
        pass
    if not url.hostname or url.username or url.password or url.query or url.fragment or url.scheme not in ('http', 'https') or (url.scheme == 'http' and not local):
        raise ValueError('LLM base URL must use HTTPS (or a local HTTP address), without credentials, query or fragment')
    return value.rstrip('/')


def direct_request(req, llm='none'):
    """GM-equivalent anonymous HTTP, on a worker thread. Never forward page cookies."""
    from urllib.parse import urlsplit
    url = urlsplit(req['url'])
    llm = validate_llm_url(llm)
    model_request = llm != 'none' and req['url'] in (llm + '/models', llm + '/chat/completions')
    if not model_request and (url.scheme != 'https' or url.hostname not in MT_HOSTS or url.username or url.password):
        raise ValueError('Test transport permits only free MT hosts or the explicit model endpoint')
    headers = {k: v for k, v in req.get('headers', {}).items() if k.lower() not in ('cookie', 'authorization', 'proxy-authorization')}
    if model_request and os.environ.get('DUALLENS_API_KEY'):
        headers['Authorization'] = 'Bearer ' + os.environ['DUALLENS_API_KEY']
    data = req.get('data')
    request = urllib.request.Request(req['url'], data=data.encode('utf-8') if isinstance(data, str) else None,
                                     headers=headers, method=req.get('method', 'GET'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    # Reject redirects to unapproved destinations before opening them.
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            target = urlsplit(newurl)
            if model_request or target.scheme != 'https' or target.hostname not in MT_HOSTS:
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


GM_STUB = r"""({settings,secrets,acked}) => {
  const data=new Map([['duallens:local', {'settings.core':settings,secrets,'ui.device':{onboarded:true,acked}}]]), listeners=new Map(), commands=new Map(), roots=[];
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


class Browser:
    def __init__(self, pw, ext, bundle, run, device, llm, headed=False, ack=True):
        self.pw, self.ext, self.bundle, self.run, self.device, self.llm = pw, ext, bundle, run, device, llm
        self.ctx = self.sw = self.ext_id = None
        self.mobile_browser = self.bridge = None
        self.transport = {}
        self.http_tasks = {}
        self.profile = run / ('profile-' + device)
        self.headed = headed
        self.ack = ack
        self.network_requests = []

    async def start(self):
        width, height, touch = DEVICES[self.device]
        opts = dict(headless=False, locale='zh-CN', device_scale_factor=1, viewport={'width': width, 'height': height},
                    args=['--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--force-device-scale-factor=1'],
                    has_touch=touch, is_mobile=touch)
        if not self.headed:
            opts['args'].insert(0, '--headless=new')
        if touch:
            opts['user_agent'] = MOBILE_UA.replace(' Mobile', '') if self.device == 'tablet' else MOBILE_UA
        else:
            opts['user_agent'] = DESKTOP_UA
            opts['args'] += [f'--disable-extensions-except={self.ext}', f'--load-extension={self.ext}']
            opts['ignore_default_args'] = ['--disable-extensions']
        if touch:
            # Mobile needs no extension profile. A fresh browser context also avoids
            # Chromium 130's persistent --headless=new screenshot metrics reset.
            launch_args=[a for a in opts.pop('args') if a!='--headless=new']
            opts.pop('headless')
            self.mobile_browser=await self.pw.chromium.launch(headless=not self.headed,args=launch_args)
            self.ctx=await self.mobile_browser.new_context(**opts)
        else:
            self.ctx = await self.pw.chromium.launch_persistent_context(str(self.profile), **opts)
        if not touch:
            from urllib.parse import urlsplit
            hosts = MT_HOSTS | ({urlsplit(self.llm).hostname} if self.llm != 'none' else set())
            self.ctx.on('request', lambda req: self.network_requests.append(urlsplit(req.url).hostname)
                        if urlsplit(req.url).hostname in hosts else None)
        if touch:
            async def http(source, req):
                from urllib.parse import urlsplit
                began = time.monotonic()
                record = {'host': urlsplit(req['url']).hostname}
                self.network_requests.append(record['host'])
                pending = self.http_tasks.setdefault(source['page'], set())
                pending.add(asyncio.current_task())
                try:
                    result = await asyncio.to_thread(direct_request, req, self.llm)
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
            # Seed manager-private device state before any target navigation;
            # evaluating the userscript later must not reset that consent.
            seed={'settings':settings(self.llm),'acked':acknowledged_destinations(self.llm) if self.ack else [],
                  'secrets':{'acceptance':{'apiKey':os.environ.get('DUALLENS_API_KEY','')}} if self.llm != 'none' else {}}
            await self.ctx.add_init_script(script='('+GM_STUB+')('+json.dumps(seed)+');')
        else:
            self.sw = next((w for w in self.ctx.service_workers if w.url.startswith('chrome-extension:')), None)
            if self.sw is None:
                self.sw = await self.ctx.wait_for_event('serviceworker', timeout=20000)
            self.ext_id = self.sw.url.split('/')[2]
            bridge = await self.ctx.new_page()
            await bridge.goto(f'chrome-extension://{self.ext_id}/ui/options.html')
            await bridge.evaluate("""async ({patch,key})=>{const {saveSettings,getDefaultSettingsStore}=await import('../shared/settings.js');await saveSettings(patch);if(key)await getDefaultSettingsStore().setSecret('acceptance',key);}""", {'patch':settings(self.llm),'key':os.environ.get('DUALLENS_API_KEY','') if self.llm != 'none' else ''})
            await bridge.evaluate("acked=>chrome.storage.local.set({'ui.device':{onboarded:true,acked}})", acknowledged_destinations(self.llm) if self.ack else [])
            self.bridge = bridge

    async def attach(self, page):
        if self.device != 'desktop':
            # Match the canonical userscript runner: GM storage is private to this page
            # instance, real anonymous HTTP is supplied by the test host. Security of
            # Tampermonkey's isolated world is deliberately NOT claimed by this harness.
            await page.evaluate(self.bundle.read_text(encoding='utf-8'))
            await page.wait_for_function('window.__acceptanceGM?.ready()', timeout=20000)
            return None
        tab = await self.sw.evaluate("async u=>(await chrome.tabs.query({})).find(t=>t.url===u)?.id", page.url)
        if tab is None:
            raise RuntimeError('Extension tab not found')
        # v0.6 has resident content scripts and no tab-ensure message. Probe the
        # same controller state first; current on-demand pages still use ensure.
        if await self.send(tab, {'type':'get-state'}) is not None:
            return tab
        try:
            ensured = await asyncio.wait_for(self.bridge.evaluate("tabId=>chrome.runtime.sendMessage({type:'tab-ensure',tabId})",tab),20)
        except asyncio.TimeoutError:
            raise RuntimeError('Content injection handshake timed out') from None
        if not ensured or not ensured.get('ok'):
            raise RuntimeError('Content injection failed: '+str(ensured.get('reason') if ensured else 'no response'))
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
        if self.mobile_browser:
            await self.mobile_browser.close()

    async def drain(self, page):
        tasks = list(self.http_tasks.pop(page, set()))
        if tasks:
            # User-triggered restore has cancelled delivery. Finish bounded anonymous
            # host reads before closing the binding's frame; no late Channel.send
            # callbacks should target a destroyed page.
            await asyncio.gather(*tasks, return_exceptions=True)
            await page.wait_for_timeout(100)


def acknowledged_destinations(llm):
    """Only destinations used by this harness's explicit settings, never wildcard consent."""
    from urllib.parse import urlsplit
    ids = ['mt:microsoft', 'mt:google']
    if llm != 'none':
        url = urlsplit(llm)
        ids.append('llm:' + url.scheme + '://' + url.netloc)
    return ids


def settings(llm):
    patch = {'version': 3, 'targetLang': 'zh-CN', 'sourceLang': 'auto', 'cache': {'enabled': False},
             'translation': {'mode': 'mt+llm', 'refineTimeoutMs': 90000, 'mt': {'engine': 'microsoft', 'fallback': True}},
             'provider': {'active': '', 'chain': []},
             **{feature:{'enabled':False} for feature in ['floatBall','selection','hover','input','comics','subtitles']}}
    if llm != 'none':
        patch['provider'] = {'active': 'acceptance', 'chain': [{'profileId': 'acceptance', 'model': os.environ.get('DUALLENS_MODEL', '')}],
            'profiles': [{'id': 'acceptance', 'name': 'Acceptance model service', 'kind': 'openai',
                'baseUrl': validate_llm_url(llm), 'model': os.environ.get('DUALLENS_MODEL', ''), 'jsonMode': True,
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
    mobile = bool(re.search(r'-(?:phone|tablet)(?:-|$)', stem))
    async def capture(filename, clip=None):
        # Native Chromium capture avoids Playwright caret/style mutation, font
        # waits on blocked pages, and viewport-only clipping of PDF page 11.
        client = await page.context.new_cdp_session(page)
        try:
            options = {'format': 'png', 'fromSurface': True, 'captureBeyondViewport': not mobile}
            if mobile:
                # Chromium 130's beyond-viewport capture can change mobile device
                # metrics, reflow the page and clip fixed cards. Capture the actual
                # compositor viewport without a clip or any emulation changes.
                result = await asyncio.wait_for(client.send('Page.captureScreenshot', options), 12)
                (out / filename).write_bytes(base64.b64decode(result['data']))
                return
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
    for label, clip in ([('viewport', None)] if mobile else [('viewport', None), ('full', full_clip)]):
        filename = stem + '-' + label + '.png'
        try:
            await capture(filename, clip)
            paths.append(filename)
        except Exception as exc:
            errors.append(label + ' screenshot failed: ' + type(exc).__name__)
    # One screenshot per issue. No scroll_into_view: screenshots must not trigger
    # additional lazy translations or alter the measured viewport cohort.
    for i, issue in enumerate(issues):
        if mobile:
            issue['screenshot'] = stem + '-viewport.png'
            continue
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


async def restore_control(browser, site, out, theme, duration, capture_after):
    """Fresh no-translation run, same device/theme, matched post-trigger duration.

    Replay the native captures at the same elapsed offset. It is sequential, not
    simultaneous: record actual time/URL and fail closed on a wall or redirect.
    """
    control = await browser.ctx.new_page()
    try:
        await control.emulate_media(color_scheme=theme)
        response = await control.goto(site['url'], wait_until='domcontentloaded', timeout=25000)
        await control.wait_for_timeout(2000)
        reason = await unreachable(control, response)
        if reason:
            return {'complete': False, 'reason': reason}
        await browser.attach(control)  # same installed UI, never issue a translation command
        await control.evaluate(PROBE)
        await control.evaluate('__dlAcceptance.freeze();__dlAcceptance.start()')
        began = time.monotonic()
        await control.wait_for_timeout(max(0, capture_after)*1000)
        paths, errors = await screenshot(control, out, site['id']+'-'+browser.device+('-dark' if theme=='dark' else '')+'-control', [])
        await control.wait_for_timeout(max(0, duration-(time.monotonic()-began))*1000)
        result = await control.evaluate('__dlAcceptance.restoreResult()')
        result.update(complete=not errors, window_seconds=time.monotonic()-began, requested_window_seconds=duration,
                      url=control.url, screenshots=paths, screenshot_errors=errors)
        return result
    except Exception as exc:
        return {'complete': False, 'reason': type(exc).__name__}
    finally:
        await control.close()


async def verify_no_ack(browser, page, requests_before, baseline_width=None):
    client = await browser.ctx.new_cdp_session(page)
    try:
        end = time.monotonic() + 8
        while time.monotonic() < end:
            tree = (await client.send('Accessibility.getFullAXTree'))['nodes']
            dialog = next((n for n in tree if n.get('role', {}).get('value') == 'alertdialog'), None)
            if dialog:
                break
            await page.wait_for_timeout(100)
        else:
            raise AssertionError('No first-send confirmation card')
        await page.wait_for_timeout(750)
        assert requests_before == 0 and len(browser.network_requests) == 0, 'Translation HTTP before consent'
        assert await page.locator('dl-t,dl-o,dl-w,dl-r').count() == 0, 'Progress markers before consent'
        remote=await client.send('DOM.resolveNode',{'backendNodeId':dialog['backendDOMNodeId']})
        geometry=(await client.send('Runtime.callFunctionOn',{'objectId':remote['object']['objectId'],
            'functionDeclaration':"function(){return {box:this.getBoundingClientRect().toJSON(),button:this.querySelector('.primary').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,fixed:getComputedStyle(this).position==='fixed'}}",
            'returnByValue':True}))['result']['value']
        if geometry['fixed']:
            for key in ['box','button']:
                box=geometry[key]
                assert box['left']>=16 and box['right']<=geometry['width']-16 and box['top']>=0 and box['bottom']<=geometry['height'], 'Consent outside viewport'
            assert baseline_width is None or geometry['scroll']==baseline_width, 'Consent expanded page width'
        return geometry
    finally:
        await client.detach()


async def web_case(browser, site, out, theme, timeout):
    device = browser.device + ('-dark' if theme == 'dark' else '')
    r = {'id': site['id'], 'category': site['category'], 'device': device, 'url': site['url'],
         'coverage_kind': 'frozen-visible-text-nodes-plus-placeholders', 'llm': browser.llm}
    if site.get('fallback_for'):
        r['fallback_for'] = site['fallback_for']
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
        # Refresh immediately before the one and only command. The independent
        # matched-duration control runs after this case, with no translation.
        r['cohort'] = await page.evaluate('__dlAcceptance.freeze()')
        await page.evaluate('__dlAcceptance.start()')
        restore_start = time.monotonic()
        requests_before = len(browser.network_requests)
        baseline_width = await page.evaluate('document.documentElement.scrollWidth')
        await browser.toggle(page, tab)
        if not browser.ack:
            r['confirmation_geometry'] = await verify_no_ack(browser,page,requests_before,baseline_width)
            r['confirmation_visible'] = True
            r['translation_requests'] = 0
            if browser.device == 'desktop':
                # Chromium 130 persistent headless capture can stall with an open
                # top-layer popover. AX and DOM verify this gate; desktop visuals
                # are covered by the isolated offline UI suite.
                r['screenshots'] = []
                r['screenshot_note'] = 'Desktop popover capture omitted; AX/geometry verified'
            else:
                r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, [])
            await page.keyboard.press('Escape')
            r.update(await page.evaluate('__dlAcceptance.restoreResult()'))
            assert r['restore_identical'], 'Cancel changed original page'
            r.update(status='PASS', acceptance_mode='first-send-confirmation')
            return r
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
        capture_after = time.monotonic() - restore_start
        r['screenshots'], r['screenshot_errors'] = await screenshot(page, out, site['id']+'-'+device, r['layout_issues'])
        await browser.toggle(page, tab)
        await page.wait_for_function("!document.querySelector('dl-t,dl-o,dl-w,dl-r')", timeout=15000)
        r.update(await page.evaluate('__dlAcceptance.restoreResult()'))
        duration = time.monotonic() - restore_start
        r['control_restore'] = await restore_control(browser, site, out, theme, duration, capture_after)
        if r['control_restore'].get('url') != r['final_url']:
            r['control_restore']['complete'] = False
            r['control_restore']['reason'] = 'Control final URL differs'
        apply_restore_control(r, r['control_restore'])
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
        text_layer = "e=>e.querySelector('.textLayer')?.outerHTML??null"
        source_dom = await page.locator(original_selector).evaluate(text_layer)
        pixel_digest = """async e=>{const c=e.querySelector('canvas');if(!c)return null;
          const bytes=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          const hash=await crypto.subtle.digest('SHA-256',bytes);
          return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}"""
        source_pixels = await page.locator(original_selector).evaluate(pixel_digest)
        await page.evaluate(PROBE)
        await page.evaluate('__dlAcceptance.freeze()')
        requests_before = len(browser.network_requests)
        await page.evaluate("window.__acceptancePdfStart=performance.now();document.querySelector('#translate').click()")
        if not browser.ack:
            await verify_no_ack(browser,page,requests_before)
            r['screenshots'],r['screenshot_errors'] = await screenshot(page,out,r['id']+'-'+device,[])
            await page.keyboard.press('Escape')
            assert source_dom == await page.locator(original_selector).evaluate(text_layer), 'PDF source DOM changed'
            assert source_pixels == await page.locator(original_selector).evaluate(pixel_digest), 'PDF source pixels changed'
            r.update(status='PASS',acceptance_mode='first-send-confirmation',confirmation_visible=True,translation_requests=0,restore_identical=True)
            return r
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
        # Native full-page capture can evict/recreate offscreen PDF canvases. Bring
        # this original page back to the same view before comparing its rendering.
        await page.locator(shell).scroll_into_view_if_needed()
        await wait_eval("n=>!!document.querySelector(`.pdf-page[data-page=\"${n}\"] .sheet.orig canvas`)", number)
        await page.wait_for_timeout(400)
        r.update(await page.evaluate('__dlAcceptance.restoreResult()'))
        r['pdf_source_dom_identical'] = source_dom is not None and source_dom == await page.locator(original_selector).evaluate(text_layer)
        r['pdf_original_pixels_identical'] = source_pixels is not None and source_pixels == await page.locator(original_selector).evaluate(pixel_digest)
        r['pdf_restore_pages'] = [{'page': number, 'text_layer_identical': r['pdf_source_dom_identical'],
                                  'rendering_identical': r['pdf_original_pixels_identical']}]
        r['restore_identical'] = pdf_restore_verdict(r)
        r['restore_scope'] = 'requested-page-original-text-layer-and-rendering; no-dl-residue; toolbar-exempt'
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
    rows = previous['rows'] if previous else []
    reports_allowed = previous is None
    completed = {(r['id'], r['device']) for r in rows}
    metadata = {'run_id': stamp, 'started_utc': datetime.now(timezone.utc).isoformat(), 'repo': str(repo),
        'llm': args.llm, 'policy': 'free MT; optional explicit OpenAI-compatible endpoint; key read only from environment',
        'emulation_only': True, 'coverage_version': 3, 'restore_version': 2, 'headed': args.headed, 'ack': args.ack,
        'timeout_seconds': args.timeout or (95 if args.llm != 'none' else 25),
        'probe_sha256': hashlib.sha256(PROBE.encode('utf-8')).hexdigest(),
        'limits': ['Desktop Chromium only, not actual Chrome/Edge or physical Android',
                   'Structural Chinese-output coverage, not semantic translation quality',
                   'Layout findings are objective geometry candidates requiring screenshot review',
                   'Only initially visible text; no login, consent clicks, comment expansion, or caption opening',
                   'PDF denominator is reader text blocks on requested page; not comparable to web nodes',
                   'Restore requires original text/order/paths and attributes; matched control may explain only same-attribute changes',
                   'Control is a sequential fresh navigation of matched duration, not simultaneous deterministic replay',
                   'Name/identifier/unchanged-MT exclusions are auditable heuristics, not semantic model judgements']}
    if previous:
        if previous['metadata'].get('ack', True) != args.ack:
            raise ValueError('Consent mode changed; use a fresh output directory')
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
        async with async_playwright() as pw:
            devices = list(DEVICES) if not args.device or 'all' in args.device else list(dict.fromkeys(args.device))
            for device in devices:
                browser = Browser(pw, ext, bundle, run_dir, device, args.llm, headed=args.headed, ack=args.ack)
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
        counts = write_reports(out, metadata, rows) if reports_allowed else {}
        canonical.remove_runtime_dir(run_dir)
    print('SUMMARY acceptance total=' + str(len(rows)) + ' ' + ' '.join(f'{k}={v}' for k,v in counts.items()) + ' out=' + str(out), flush=True)
    return 1 if any(r['status'] != 'PASS' for r in rows) else 0


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=REPO)
    parser.add_argument('--only', action='append', default=[])
    parser.add_argument('--device', action='append', choices=['desktop', 'phone', 'tablet', 'all'], help='Repeat to add devices; all (default) runs desktop, phone and tablet')
    parser.add_argument('--ack', action=argparse.BooleanOptionalAction, default=True, help='Pre-confirm selected destinations (default); --no-ack checks confirmation and zero translation HTTP')
    parser.add_argument('--llm', default='none', metavar='BASE_URL', help='Explicit OpenAI-compatible base URL; default none. Key: DUALLENS_API_KEY; model: DUALLENS_MODEL')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--resume', type=Path, help='Resume a checkpoint directory; extension/userscript hashes must match')
    parser.add_argument('--timeout', type=float, help='Observation deadline in seconds (default MT=25/LLM=95)')
    parser.add_argument('--headed', action='store_true', help='Visible Chromium; no headless flag; ordinary desktop UA')
    args = parser.parse_args(argv)
    if args.timeout is not None and not 3 <= args.timeout <= 180:
        parser.error('--timeout must be 3..180 seconds')
    return args


def main():
    args = parse_args()
    try:
        args.llm = validate_llm_url(args.llm)
        if args.llm != 'none' and not os.environ.get('DUALLENS_MODEL'):
            raise ValueError('Set DUALLENS_MODEL when using --llm')
        return asyncio.run(run(args))
    except (ValueError, RuntimeError) as exc:
        print('ERROR acceptance: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

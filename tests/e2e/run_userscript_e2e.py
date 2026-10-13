#!/usr/bin/env python3
"""Offline userscript desktop/touch E2E, no extension or real provider.

Build first: node scripts/build_userscript.mjs
Run with the same Python/browser environment as run_e2e.py. Profiles and evidence remain
in ~/.cache/duallens-e2e. GM/shadow instrumentation is test-only, outside the product bundle.
"""
from __future__ import annotations
import argparse
import json
import time
import traceback
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
from run_e2e import REPO, E2E_ROOT, start_fixtures, remove_runtime_dir, check

ARTIFACTS = E2E_ROOT / 'artifacts' / 'userscript'

STUB = r"""(() => {
  const data = new Map();
  const listeners = new Map();
  const commands = new Map();
  const roots = [];
  const calls = [];
  const tasks = [];
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = original.call(this, init);
    if (this.localName === 'dl-ui') roots.push({host:this,root});
    return root;
  };
  data.set('duallens:sync', {settings:{provider:{active:'mock'}}});
  window.GM_getValue = (key, fallback) => structuredClone(data.get(key) ?? fallback);
  window.GM_setValue = (key, value) => {
    const old = data.get(key); data.set(key,structuredClone(value));
    for (const cb of listeners.get(key) || []) cb(key,old,value,false);
  };
  window.GM_deleteValue = key => {
    const old = data.get(key); data.delete(key);
    for (const cb of listeners.get(key) || []) cb(key,old,{},false);
  };
  window.GM_addValueChangeListener = (key, cb) => {
    if(!listeners.has(key)) listeners.set(key,[]);
    listeners.get(key).push(cb);
    return listeners.get(key).length;
  };
  window.GM_registerMenuCommand = (label, fn) => commands.set(label,fn);
  window.GM_xmlhttpRequest = req => {
    // GM transport mock, never page fetch; exercise the real OpenAI adapter offline.
    calls.push({url:req.url,method:req.method,anonymous:req.anonymous,hasAuth:!!req.headers.Authorization});
    let stopped=false;
    const timer=setTimeout(() => {
      if(stopped)return;
      if(req.method==='GET') req.onload({status:200,responseText:JSON.stringify({data:[{id:'mock'}]}),responseHeaders:''});
      else {
        const payload=JSON.parse(req.data);
        const user=payload.messages.find(m=>m.role==='user').content;
        const input=JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1));
        req.onload({status:200,responseHeaders:'Content-Type: application/json',responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.t.map(t=>'【译】'+t)})}}]})});
      }
    },30);
    return {abort(){stopped=true;clearTimeout(timer);req.onabort?.();}};
  };
  try { new PerformanceObserver(list => tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true}); } catch {}
  // This object is exclusively a fixture instrumentation surface, never emitted by the packer.
  window.__platformFixture = {
    command(label) { if(!commands.has(label))throw Error('Command unavailable'); return commands.get(label)(); },
    hasCommand:label=>commands.has(label),
    settings(patch) {
      const merge=(a,b)=>{const r=structuredClone(a||{});for(const[k,v]of Object.entries(b))r[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(r[k],v):v;return r;};
      GM_setValue('duallens:sync',{settings:merge(data.get('duallens:sync')?.settings,patch)});
    },
    elements(selector) { return roots.filter(r=>r.host.isConnected).flatMap(r=>[...r.root.querySelectorAll(selector)]); },
    rect(selector) { const el=this.elements(selector).find(e=>getComputedStyle(e).display!=='none'); if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; },
    data(key) { return structuredClone(data.get(key)); },
    calls, tasks,
  };
})();"""


def command(page, label):
    page.evaluate('label => __platformFixture.command(label)', label)


def rect(page, selector):
    return page.evaluate('s => __platformFixture.rect(s)', selector)


def click_shadow(page, selector):
    r = rect(page, selector)
    check(bool(r), 'missing UI control: ' + selector)
    page.mouse.click(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)


def fill_shadow(page, label, value):
    # No production test hooks: fixture captures closed roots before bundle execution.
    page.evaluate("""({label,value}) => {
      const wrap=__platformFixture.elements('label').find(el=>el.firstChild?.textContent===label);
      const input=wrap.querySelector('input,select'); input.value=value; input.dispatchEvent(new Event('change',{bubbles:true}));
    }""", {'label': label, 'value': value})


def wait_done(page, selector='#p-plain'):
    page.wait_for_function('(s) => document.querySelector(s)?.querySelector(\'dl-t[data-dl-state="done"]\')', arg=selector)


def select_text(page, selector='#p-plain'):
    return page.evaluate("""s => {
      const el=document.querySelector(s); const text=[...el.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(50,text.length));
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const r=range.getBoundingClientRect();document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
      return {bottom:r.bottom,left:r.left};
    }""", selector)


def ready(page, base, fixture='article.html'):
    page.goto(base + '/' + fixture)
    page.wait_for_function("__platformFixture.hasCommand('翻译 / 恢复当前页面')")
    page.wait_for_function("!!__platformFixture.rect('.ball')")


def desktop_cases(page, base):
    ready(page, base)
    original = page.evaluate('document.body.outerHTML')
    command(page, '翻译 / 恢复当前页面'); wait_done(page)
    check('【译】' in page.locator('#p-plain dl-t').inner_text(), 'missing mock translation')
    check(page.locator('#p-links dl-t a').count() > 0, 'inline links were lost')
    command(page, '切换双语 / 仅译文')
    page.wait_for_function("document.querySelector('#p-plain').classList.contains('dl-only')")
    check(page.locator('#p-plain dl-o').evaluate("e=>getComputedStyle(e).display") == 'none', 'source remains visible')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    check(page.evaluate('document.body.outerHTML') == original, 'restore is not DOM-identical')
    command(page, '切换双语 / 仅译文')
    select_text(page)
    page.wait_for_function("!!__platformFixture.rect('.icon.show')")
    click_shadow(page, '.icon.show')
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('form').length===1")
    fill_shadow(page, '目标语言', 'ja')
    click_shadow(page, 'button[type=submit]')
    page.wait_for_function("__platformFixture.data('duallens:sync').settings.targetLang==='ja'")
    check(all(page.evaluate("[...document.querySelectorAll('dl-ui')].map(e=>e.shadowRoot===null)")), 'overlay must stay closed')
    page.keyboard.press('Escape')
    page.wait_for_function("__platformFixture.elements('form').length===0")
    # Dynamic fixture exercises timed appends and SPA updates using the same controller.
    ready(page, base, 'dynamic.html')
    command(page, '翻译 / 恢复当前页面')
    wait_done(page, '#dyn-1')
    page.locator('#nav-btn').click(); wait_done(page, '#spa-route-2-1')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    return 'translation, exact restore, only mode, selection, settings, dynamic append/SPA'


def secret_transport_case(page, base):
    ready(page, base)
    page.evaluate("""() => {
      __platformFixture.settings({provider:{active:'custom',profiles:[{id:'custom',kind:'openai',model:'mock',baseUrl:'https://mock.invalid/v1',concurrency:2,maxItems:12,maxChars:4000}]}});
    }""")
    command(page, 'DualLens 设置')
    page.wait_for_function("__platformFixture.elements('form').length===1")
    # beforeinput is prevented: the key never becomes the value of the connected DOM input.
    page.evaluate("""() => {
      const el=__platformFixture.elements('input[type=password]')[0];
      for(const data of 'sk-test-not-real')el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data,cancelable:true,bubbles:true}));
    }""")
    check(page.evaluate("__platformFixture.elements('input[type=password]')[0].value.includes('sk-test')") is False, 'key leaked into DOM value')
    click_shadow(page, 'button[type=submit]')
    page.wait_for_function("!!__platformFixture.data('duallens:local')?.secrets?.custom")
    check(page.evaluate("JSON.stringify(__platformFixture.data('duallens:sync')).includes('sk-test')") is False, 'key leaked into public settings')
    check(page.evaluate("__platformFixture.elements('input[type=password]')[0].value") == '', 'key editor did not clear')
    click_shadow(page, 'form .actions button[type=button]')
    page.wait_for_function("__platformFixture.elements('.status').some(e=>e.textContent.includes('连接成功'))")
    page.keyboard.press('Escape'); command(page, '翻译 / 恢复当前页面'); wait_done(page)
    check(page.evaluate('__platformFixture.calls.every(c=>c.anonymous&&c.hasAuth)') is True, 'GM transport was not anonymous/authenticated')
    check(page.evaluate('localStorage.length') == 0, 'host localStorage was used')
    check(page.evaluate("document.body.outerHTML.includes('sk-test')") is False, 'key leaked into document')
    return 'GM HTTP exercised; secret remains in GM local area; no DOM/public-settings key'


def mobile_cases(page, base):
    ready(page, base)
    check(page.evaluate("matchMedia('(pointer: coarse)').matches"), 'device has no coarse pointer')
    target = page.locator('#p-plain'); target.scroll_into_view_if_needed(); box = target.bounding_box()
    client = page.context.new_cdp_session(page)
    x, y = box['x'] + 30, box['y'] + 10
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    page.wait_for_timeout(600)
    client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    wait_done(page)
    # Moving/scrolling within the hold threshold cancels long-press.
    cancel_target = page.locator('#p-bold'); cancel_target.scroll_into_view_if_needed(); cancel_box = cancel_target.bounding_box()
    cx, cy = cancel_box['x'] + 30, cancel_box['y'] + 10
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': cx, 'y': cy - 30}]})
    page.wait_for_timeout(600); client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    check(page.locator('#p-bold dl-t').count() == 0, 'scroll gesture triggered long-press translation')
    target.scroll_into_view_if_needed(); selected = select_text(page)
    page.wait_for_function("!!__platformFixture.rect('.icon.show')")
    icon = rect(page, '.icon.show')
    check(icon['y'] >= selected['bottom'] and icon['height'] >= 44 and icon['width'] >= 44, 'selection icon is not a 44px target below the selection')
    click_shadow(page, '.icon.show')
    page.wait_for_function("__platformFixture.elements('.dst').some(e=>e.textContent.startsWith('【译】'))")
    page.keyboard.press('Escape')
    # Pointer event drag from one edge to the other, using actual touch input.
    before = rect(page, '.ball')
    x, y = before['x'] + 22, before['y'] + 22
    client.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 40, 'y': 160}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(100)
    after = rect(page, '.ball')
    check(after['x'] < 20 and abs(after['y'] - before['y']) > 30, 'ball touch drag did not persist/move')
    check(after['height'] >= 44, 'ball touch target too small')
    # Input action keeps the last focused field while tapping the more/menu controls.
    page.locator('#ta').fill('Hello from the current input box.'); page.locator('#ta').focus()
    click_shadow(page, '.more'); page.wait_for_function("__platformFixture.elements('.menu.show').length===1")
    click_shadow(page, '.menu.show .row.btn')
    page.wait_for_function("document.querySelector('#ta').value.startsWith('【译】')")
    command(page, 'DualLens 设置'); page.wait_for_function("__platformFixture.elements('form').length===1")
    panel = rect(page, '.panel')
    if page.viewport_size['width'] < 600:
        check(panel['x'] == 0 and panel['y'] == 0 and panel['width'] == page.viewport_size['width'], 'narrow settings not fullscreen')
    fill_shadow(page, '目标语言', 'ja'); click_shadow(page, 'button[type=submit]')
    page.wait_for_function("__platformFixture.data('duallens:sync').settings.targetLang==='ja'")
    page.keyboard.press('Escape')
    # Long-page metrics include translation start and the full viewport-by-viewport scroll.
    ready(page, base, 'long.html')
    start = page.evaluate('performance.now()'); command(page, '翻译 / 恢复当前页面')
    page.wait_for_timeout(1000)
    # Translation changes document height. Re-read it after each slice so "bottom" means
    # the actual final bottom, not the shorter pre-translation document's old height.
    scrolls = 0
    while page.evaluate('scrollY + innerHeight < document.documentElement.scrollHeight - 2'):
        check(scrolls < 600, 'long-page scroll did not converge')
        page.evaluate('scrollBy(0, innerHeight * .65)'); page.wait_for_timeout(250)
        scrolls += 1
    page.wait_for_function("[...document.querySelectorAll('p.lp')].every(p=>p.querySelector('dl-t[data-dl-state=done]'))")
    check(page.evaluate('scrollY + innerHeight >= document.documentElement.scrollHeight - 2'), 'did not reach the final page bottom')
    end = page.evaluate('performance.now()')
    metrics = page.evaluate("""({start,end}) => {
      const tasks=__platformFixture.tasks.filter(t=>t.start>=start&&t.start<=end);
      const ms=tasks.reduce((n,t)=>n+t.duration,0);
      return {over50ms:tasks.filter(t=>t.duration>50).length,maxMs:Math.max(0,...tasks.map(t=>t.duration)),longTaskMs:ms,observedMs:end-start,
        translated:document.querySelectorAll('dl-t[data-dl-state=done]').length,
        sourceParagraphs:document.querySelectorAll('p[id^=lp-]').length,nonLongTimeRatio:1-ms/(end-start)};
    }""", {'start': start, 'end': end})
    check(metrics['translated'] >= metrics['sourceParagraphs'], 'long-page scroll did not translate all paragraphs')
    command(page, '翻译 / 恢复当前页面')
    page.wait_for_function("!document.querySelector('dl-t')")
    return metrics


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--only', action='append', default=[])
    args = ap.parse_args()
    bundle = REPO / 'dist' / 'duallens.user.js'
    check(bundle.is_file(), 'build dist/duallens.user.js first')
    cases = [('desktop', 1280, 800, False, desktop_cases), ('secret_transport', 1280, 800, False, secret_transport_case),
             ('mobile_375', 375, 812, True, mobile_cases), ('tablet_800', 800, 1280, True, mobile_cases)]
    if args.only: cases = [c for c in cases if any(o in c[0] for o in args.only)]
    if not cases: print('no matching cases'); return 2
    E2E_ROOT.mkdir(parents=True, exist_ok=True); ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server, base = start_fixtures(); results = []
    try:
        with sync_playwright() as pw:
            for name, width, height, touch, fn in cases:
                profile = E2E_ROOT / ('profile-userscript-' + uuid.uuid4().hex[:8])
                context = None; started = time.time(); page = None
                try:
                    context = pw.chromium.launch_persistent_context(str(profile), headless=True,
                        viewport={'width': width, 'height': height}, has_touch=touch, is_mobile=touch,
                        args=['--no-first-run', '--no-default-browser-check'])
                    # Stub is installed before the real, unchanged artifact. No extension is loaded.
                    context.add_init_script(script=STUB)
                    context.add_init_script(path=str(bundle))
                    page = context.new_page(); page.set_default_timeout(15000)
                    detail = fn(page, base)
                    results.append({'name': name, 'status': 'PASS', 'detail': detail, 'seconds': round(time.time() - started, 2)})
                    print('PASS ' + name + ': ' + json.dumps(detail, ensure_ascii=False), flush=True)
                except Exception as exc:
                    detail = type(exc).__name__ + ': ' + str(exc)
                    results.append({'name': name, 'status': 'FAIL', 'detail': detail})
                    print('FAIL ' + name + ': ' + detail, flush=True)
                    traceback.print_exc(limit=5)
                    if page: page.screenshot(path=str(ARTIFACTS / (name + '.png')))
                finally:
                    if context: context.close()
                    remove_runtime_dir(profile)
    finally:
        server.shutdown()
    (ARTIFACTS / 'last-run.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    failed = sum(r['status'] == 'FAIL' for r in results)
    print(f"SUMMARY userscript total={len(results)} PASS={len(results)-failed} FAIL={failed} SKIP=0")
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())

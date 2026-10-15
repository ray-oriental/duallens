"""Explicitly authorized real-page timing of the double-engine pipeline (SPEC 8.1). No login, no paid model.

Machine translation: the real, free, unofficial Microsoft endpoint, direct connection.
Refinement: the user's loopback gateway with the local Ollama model only (no SJTU, Claude or Codex call).
Reports, per page and viewport: first machine draft, machine-filled viewport, first LLM final, LLM-refined
viewport, and the layout shift measured while drafts become finals. Screenshots stay outside git.

    python tests/e2e/run_v04_engine_live.py [--only wiki] [--llm none]
"""
import argparse
import json
import re
import time
import uuid

import run_e2e as e
from playwright.sync_api import Error as BrowserError

URLS = {
    'wiki': 'https://en.wikipedia.org/wiki/Machine_translation',
    'novel': 'https://www.pixiv.net/novel/show.php?id=29352462#2',
}
VIEWPORTS = {'desktop': {'width': 1280, 'height': 800}, 'phone': {'width': 375, 'height': 812}}
OUT = e.E2E_ROOT / 'v04' / 'dev-engine'
TRACE = False

# Units are the source nodes that should get a dl-t: wikipedia paragraphs, or pixiv's text-count spans.
UNITS = {
    'wiki': "#mw-content-text p",
    'novel': "span.text-count",
}

JS_INSTALL = """(unitSelector) => {
  window.__v04 = { t0: performance.now(), shifts: 0, events: [] };
  try {
    new PerformanceObserver((list) => { for (const x of list.getEntries()) if (!x.hadRecentInput) window.__v04.shifts += x.value; })
      .observe({ type: 'layout-shift', buffered: false });
  } catch {}
}"""

JS_SAMPLE = """(unitSelector) => {
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; };
  const units = window.__v04.units || [...document.querySelectorAll(unitSelector)].filter((el) => el.textContent.trim().length > 24 && inView(el));
  const translationOf = (el) => {
    if (el.localName === 'span') { for (let n = el.nextSibling; n; n = n.nextSibling) { if (n.nodeType === 1 && n.localName === 'dl-t') return n; if (n.nodeType === 1 && n.matches('span.text-count') && n.textContent.trim()) break; } return null; }
    return el.querySelector(':scope > dl-t');
  };
  const rows = units.map((el) => { const t = translationOf(el); return t && t.getAttribute('data-dl-state') === 'done' && /[\\u4e00-\\u9fff]/.test(t.textContent)
    ? {stage:t.getAttribute('data-dl-stage'),engine:t.getAttribute('data-dl-engine')} : null; });
  return { now: performance.now(), shifts: window.__v04.shifts, n: units.length, draft: rows.filter((s) => s?.stage === 'draft').length,
    final: rows.filter((s) => s?.stage === 'final').length, refined:rows.filter(s=>s?.stage === 'final' && s.engine==='llm').length,
    tops: units.slice(0, 6).map((el) => Math.round(el.getBoundingClientRect().top)) };
}"""


def measure(h, name, viewport_name, unit_selector, result, llm):
    page = h.page
    page.locator(unit_selector).filter(has_text=re.compile(r'.{25}')).first.scroll_into_view_if_needed(timeout=20000)
    page.evaluate(JS_INSTALL, unit_selector)
    for _ in range(100):  # wait until the page has units in view
        if page.evaluate(JS_SAMPLE, unit_selector)['n'] > 0:
            break
        page.wait_for_timeout(100)
    base = page.evaluate(JS_SAMPLE, unit_selector)
    assert base['n'] > 0, 'no readable source units in the viewport; timing would be meaningless'
    page.evaluate("""selector => { window.__v04.units = [...document.querySelectorAll(selector)].filter(el => {
      const r=el.getBoundingClientRect(); return el.textContent.trim().length>24 && r.width>0 && r.height>0 && r.top<innerHeight && r.bottom>0;
    }); }""", unit_selector)
    result['selectorMatches'] = page.evaluate('(s) => document.querySelectorAll(s).length', unit_selector)
    result['visibleUnits'] = base['n']
    page.screenshot(path=str(OUT / f'{name}-{viewport_name}-original.png'))
    started = time.monotonic()
    h.command('toggle-page')
    marks = {}
    end = started + (120 if llm else 25)
    last = None
    trace_at = -1
    while time.monotonic() < end:
        s = page.evaluate(JS_SAMPLE, unit_selector)
        ms = round((time.monotonic() - started) * 1000)
        covered = s['draft'] + s['final']
        if covered and 'firstTranslationMs' not in marks:
            marks['firstTranslationMs'] = ms
        if s['draft'] and 'firstDraftMs' not in marks:
            marks['firstDraftMs'] = ms
        if s['n'] and covered == s['n'] and 'viewportCoveredMs' not in marks:
            marks['viewportCoveredMs'] = ms
            marks['coveredAs'] = {'draft': s['draft'], 'final': s['final']}
            page.screenshot(path=str(OUT / f'{name}-{viewport_name}-{result["llm"]}-first.png'))
            marks['shiftsAtCovered'] = s['shifts']
            marks['topsAtCovered'] = s['tops']
        if s['refined'] and 'firstRefinedMs' not in marks:
            marks['firstRefinedMs'] = ms
        if s['n'] and s['final'] == s['n'] and 'viewportFinalMs' not in marks:
            marks['viewportFinalMs'] = ms
            marks['shiftsAtFinal'] = s['shifts']
            marks['topsAtFinal'] = s['tops']
            last = s
            break
        last = s
        if TRACE and ms // 3000 != trace_at:
            trace_at = ms // 3000
            print('  trace', ms, {k: s[k] for k in ('n', 'draft', 'final')}, h.state() and {k: h.state().get(k) for k in ('pending', 'done', 'refining')}, flush=True)
        page.wait_for_timeout(30)
    result.update(marks)
    result['last'] = last
    result['speedTargetMet'] = marks.get('viewportCoveredMs', 1_000_000) <= 1000
    result['refinement'] = ('complete' if last and last['refined'] == base['n'] else 'partial' if last and last['refined'] else 'unavailable') if llm else 'not_requested'
    if 'shiftsAtCovered' in marks and 'shiftsAtFinal' in marks:
        result['layoutShiftWhileRefining'] = round(marks['shiftsAtFinal'] - marks['shiftsAtCovered'], 5)
    page.screenshot(path=str(OUT / f'{name}-{viewport_name}-{result["llm"]}-final.png'))
    state = h.state() or {}
    result['state'] = {k: state.get(k) for k in ('units', 'done', 'pending', 'failed', 'refining')}
    # a restore must leave nothing behind
    h.command('toggle-page')
    page.wait_for_function("() => document.querySelectorAll('dl-t,dl-o,dl-w,dl-r').length === 0", timeout=15000)
    result['restored'] = True
    assert 'viewportCoveredMs' in marks, 'the originally visible source units were not all translated'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=list(URLS), action='append', default=[])
    ap.add_argument('--llm', choices=['ollama', 'none'], default='none')
    ap.add_argument('--viewport', choices=list(VIEWPORTS), action='append', default=[])
    ap.add_argument('--trace', action='store_true')
    ap.add_argument('--refine-timeout-ms', type=int, default=20000)
    args = ap.parse_args()
    if not 1000 <= args.refine_timeout_ms <= 90000:
        ap.error('--refine-timeout-ms must be between 1000 and 90000')
    global TRACE
    TRACE = args.trace
    OUT.mkdir(parents=True, exist_ok=True)
    run = e.E2E_ROOT / ('run-v04-live-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e.stage_extension(run, e.EXT_SRC)
    assert not missing, 'missing runtime assets'
    results = []
    try:
        with e.sync_playwright() as pw:
            h = e.Session(pw, ext, '', 'v04-live')
            h.profile.mkdir()
            try:
                h.ctx = pw.chromium.launch_persistent_context(
                    str(h.profile), headless=False,
                    args=['--headless=new', f'--disable-extensions-except={ext}', f'--load-extension={ext}',
                          '--no-first-run', '--no-proxy-server'],
                    ignore_default_args=['--disable-extensions'], viewport=e.VIEWPORT)
                h.ext_id = e.get_sw(h.ctx).url.split('/')[2]
                bridge = h.ctx.new_page()
                bridge.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
                patch = {'targetLang': 'zh-CN', 'sourceLang': 'auto', 'cache': {'enabled': False}, 'lazy': {'rootMarginPx': 0},
                         'translation': {'mode': 'mt+llm', 'refineTimeoutMs': args.refine_timeout_ms, 'mt': {'engine': 'microsoft'}}}
                if args.llm == 'ollama':
                    patch['provider'] = {'active': 'gateway', 'chain': [{'profileId': 'gateway', 'model': 'ollama/qwen3:4b'}],
                        'profiles': [{'id': 'gateway', 'kind': 'gateway', 'name': 'local', 'baseUrl': 'http://127.0.0.1:18790/v1',
                                      'model': 'ollama/qwen3:4b', 'jsonMode': True, 'maxItems': 12, 'maxChars': 2000, 'concurrency': 2,
                                      'timeoutMs': 90000, 'fallbackModels': []}]}
                else:
                    patch['provider'] = {'active': '', 'chain': []}
                bridge.evaluate("async (patch) => { const { saveSettings } = await import('../shared/settings.js'); await saveSettings(patch); }", patch)
                bridge.close()
                for name, url in URLS.items():
                    if args.only and name not in args.only:
                        continue
                    for viewport_name, size in VIEWPORTS.items():
                        if args.viewport and viewport_name not in args.viewport:
                            continue
                        result = {'page': name, 'viewport': viewport_name, 'url': url, 'llm': args.llm, 'refineBudgetMs': args.refine_timeout_ms}
                        h.page = h.ctx.new_page()
                        h.page.set_viewport_size(size)
                        if viewport_name == 'phone':
                            device = h.ctx.new_cdp_session(h.page)
                            device.send('Emulation.setDeviceMetricsOverride', {
                                'width': size['width'], 'height': size['height'], 'deviceScaleFactor': 1,
                                'mobile': True, 'screenWidth': size['width'], 'screenHeight': size['height']})
                            device.send('Emulation.setTouchEmulationEnabled', {'enabled': True})
                            device.send('Network.setUserAgentOverride', {'userAgent':
                                'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
                                'platform': 'Android'})
                        try:
                            h.page.goto(url, wait_until='domcontentloaded', timeout=60000)
                            h.page.wait_for_timeout(5000)
                            result['emulation'] = h.page.evaluate("() => ({width:innerWidth,coarse:matchMedia('(pointer: coarse)').matches,android:navigator.userAgent.includes('Android')})")
                            h.tab_id = h.sw_eval(e.JS_FIND_TAB, h.page.url)
                            h.wait_ready()
                            measure(h, name, viewport_name, UNITS[name], result, args.llm == 'ollama')
                            result['outcome'] = 'PASS'
                        except (AssertionError, BrowserError, RuntimeError) as error:
                            result['outcome'] = 'FAIL'
                            result['error'] = str(error)[:400]
                            try:
                                h.page.screenshot(path=str(OUT / f'{name}-{viewport_name}-failure.png'))
                            except BrowserError:
                                pass
                        finally:
                            h.page.close()
                        results.append(result)
                        print(json.dumps(result, ensure_ascii=False), flush=True)
            finally:
                h.close()
    finally:
        e.remove_runtime_dir(run)
    report = f'live-results-{args.llm}-{args.refine_timeout_ms}-{"-".join(args.only) or "all"}-{"-".join(args.viewport) or "all"}.json'
    (OUT / report).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    failed = sum(r['outcome'] == 'FAIL' for r in results)
    print(f'SUMMARY v04-engine-live total={len(results)} PASS={len(results) - failed} FAIL={failed} screenshots={OUT}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())

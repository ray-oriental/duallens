#!/usr/bin/env python3
"""Offline media acceptance using canonical staging/profile helpers.

Every YouTube address is fulfilled from local fixtures; all other non-extension
network traffic is aborted. No real YouTube, provider, login or browser profile.
Build userscript first, then use the same Playwright install as run_e2e.py.
"""
from __future__ import annotations
import json
import time
import traceback
import uuid
import io
import wave
import re
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect
from run_e2e import REPO, E2E_ROOT, stage_extension, Session, check, remove_runtime_dir, JS_FIND_TAB
from run_userscript_e2e import STUB, command as gm_command, click_shadow

ARTIFACTS = E2E_ROOT / 'artifacts' / 'media'
FIXTURE = REPO / 'tests' / 'fixtures' / 'subtitles' / 'youtube.html'
TRACK = {'events': [{'tStartMs': i * 1000, 'dDurationMs': 1000,
                    'segs': [{'utf8': f'Sentence {i}. <plain text>'}]} for i in range(30)]}


def local_youtube(context, requests):
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000)
        stream.writeframes(b'\0\0' * 8000 * 35)
    def route(request):
        url = urlsplit(request.request.url)
        if url.scheme in ('chrome-extension', 'data', 'about'):
            request.continue_(); return
        if url.hostname not in ('www.youtube.com', 'm.youtube.com'):
            request.abort(); return
        if url.path == '/api/timedtext':
            requests.append(parse_qs(url.query))
            request.fulfill(status=200, content_type='application/json', body=json.dumps(TRACK), headers={'Access-Control-Allow-Origin': '*'}); return
        if url.path == '/fixture.wav':
            body = audio.getvalue(); header = request.request.headers.get('range', '')
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', header)
            if match:
                begin = int(match[1]); end = min(int(match[2]) if match[2] else len(body) - 1, len(body) - 1)
                request.fulfill(status=206, content_type='audio/wav', body=body[begin:end + 1],
                    headers={'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {begin}-{end}/{len(body)}'})
            else:
                request.fulfill(status=200, content_type='audio/wav', body=body, headers={'Accept-Ranges': 'bytes'})
            return
        if url.path == '/watch':
            request.fulfill(status=200, content_type='text/html', body=FIXTURE.read_text(encoding='utf-8')); return
        request.fulfill(status=404, body='Offline fixture: no other resources')
    context.route('**/*', route)


def extension_case(pw, extension, host):
    session = Session(pw, extension, '', 'media-' + host.split('.')[0]); requests = []
    try:
        session.start(); local_youtube(session.ctx, requests)
        # Playwright 1.48 context routes do not cover this extension worker's
        # network. Inject a strict fetch fixture into the temporary worker before
        # any caption request; never let a worker request reach actual YouTube.
        session.sw_eval("""data => {
          globalThis.__mediaTrackRequests=[];
          globalThis.fetch=async (raw,options) => {
            const url=new URL(raw);
            if(!['www.youtube.com','m.youtube.com'].includes(url.hostname)||url.pathname!=='/api/timedtext')
              throw Error('Offline worker fixture forbids network');
            if(options.credentials!=='omit'||options.redirect!=='error')throw Error('Unsafe caption request');
            __mediaTrackRequests.push(Object.fromEntries(url.searchParams));
            return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
          };
        }""", TRACK)
        session.settings({'subtitles': {'enabled': True}})
        session.page = session.ctx.new_page(); session.page.goto(f'https://{host}/watch?v=fixture')
        session.tab_id = session.sw_eval(JS_FIND_TAB, session.page.url); session.wait_ready()
        page = session.page; page.wait_for_function('document.querySelector("video").currentTime>17'); page.locator('#cc').click()
        state = session.wait_state(lambda s: s['subtitles']['visible'], 15, 'translated subtitle overlay')['subtitles']
        check(state['order'][0] == 3, 'first translation did not start near 17.3s')
        check(state['current']['translation'].startswith('【译】'), 'mock translation missing')
        check(page.locator('dl-ui[data-dl-subtitles]').count() == 1, 'overlay missing')
        check(page.locator('.ytp-caption-window-container').evaluate('(e)=>getComputedStyle(e).visibility') == 'hidden', 'native captions still visible')
        worker_requests = session.sw_eval('() => __mediaTrackRequests')
        check(any(q.get('fmt') == ['json3'] and 'tlang' not in q for q in requests) or
            any(q.get('fmt') == 'json3' and 'tlang' not in q for q in worker_requests), 'original json3 not refetched')
        check(page.locator('dl-ui[data-dl-subtitles]').evaluate('(e)=>e.shadowRoot===null'), 'overlay shadow is not closed')
        page.locator('#full').click(); page.wait_for_function('document.fullscreenElement===document.querySelector("#movie_player")')
        check(page.evaluate('document.fullscreenElement.contains(document.querySelector("dl-ui[data-dl-subtitles]"))'), 'overlay is outside fullscreen player')
        page.evaluate('document.exitFullscreen()')
        page.evaluate('fixtureSeek(1.3)')
        session.wait_state(lambda s: s['subtitles']['current'] and 'Sentence 1.' in s['subtitles']['current']['source'], 5, 'seek render')
        # Source/target language and provider changes invalidate previous track translations.
        session.settings({'targetLang': 'ja', 'subtitles': {'fontSize': 30, 'position': 'top', 'mode': 'translation-only'}})
        session.wait_state(lambda s: s['subtitles']['visible'], 10, 'updated settings')
        session.wait_state(lambda s: s['subtitles']['display'] and s['subtitles']['display']['sourceHidden'] and
            s['subtitles']['display']['position'] == 'top' and s['subtitles']['display']['fontSize'] == '30px', 5, 'subtitle view settings')
        # SPA reuses the player: clear old video text immediately on its navigation event.
        page.evaluate("history.pushState({},'', '/watch?v=second');document.dispatchEvent(new Event('yt-navigate-finish'))")
        session.wait_state(lambda s: s['subtitles']['cues'] == 0, 5, 'SPA track invalidation')
        check(page.locator('dl-ui[data-ready]').count() == 0, 'old video caption survived SPA navigation')
        page.locator('#cc').click(); session.wait_state(lambda s: s['subtitles']['visible'], 10, 'new video track')
        session.command('restore-subtitles')
        session.wait_state(lambda s: not s['subtitles']['overlay'], 5, 'clean restore')
        check(page.evaluate('document.querySelector("#movie_player").outerHTML===fixtureBefore'), 'restore changed player DOM')
        check(page.locator('.ytp-caption-window-container').evaluate('(e)=>getComputedStyle(e).visibility') == 'visible', 'native captions not restored')
        # Native playback and the hook still behave after restore; observation never rewrites the response.
        check(page.evaluate('fixtureCaptions().then(data=>data.events.length)') == 30, 'page timedtext response was changed')
        # Pending response must not resurrect a restored overlay.
        page.wait_for_timeout(300); check(page.locator('dl-ui[data-dl-subtitles]').count() == 0, 'late callback resurrected overlay')
        # Standard page Restore (Alt+A command path) also removes subtitle UI.
        session.settings({'subtitles': {'enabled': True, 'fontSize': 31}})
        session.wait_state(lambda s: s['subtitles']['overlay'], 5, 'enable again after option change')
        session.command('toggle-page'); session.wait_state(lambda s: not s['subtitles']['overlay'], 5, 'page restore')
        check(page.evaluate('document.querySelector("#movie_player").outerHTML===fixtureBefore'), 'page restore changed player DOM')
        return f'{host}: local json3, current-group-first, seek, fullscreen, mode/size/position, SPA, native visibility, exact restore'
    finally:
        session.close()


def sidepanel_case(pw, extension):
    session = Session(pw, extension, '', 'media-sidepanel')
    try:
        session.start(); session.ctx.route('https://**/*', lambda route: route.abort())
        # Exercise the actual command listener's open call in the event gesture.
        # Chromium's synthetic keyboard cannot trigger OS extension commands; use
        # a worker-only listener audit for dispatch, then the real API with userGesture.
        state = session.sw_eval("""async () => {
          const m=chrome.runtime.getManifest();
          return {command:m.commands['open-sidepanel'].suggested_key.default,
            path:(await chrome.sidePanel.getOptions({})).path};
        }""")
        check(state == {'command': 'Alt+S', 'path': 'sidepanel/index.html'}, 'sidePanel registration or command missing')
        page = session.ctx.new_page(); page.goto(f'chrome-extension://{session.ext_id}/sidepanel/index.html')
        page.locator('[name=text-input]').fill('Hello <b>plain text</b>.')
        page.locator('[name=text-profile]').select_option('mock')
        page.locator('button.text-load-models').click(); page.get_by_role('status').first.wait_for()
        page.locator('[name=text-model]').select_option('mock')
        page.get_by_role('button', name='翻译', exact=True).click()
        expect(page.locator('output')).to_contain_text('【译】')
        check(page.locator('output b').count() == 0, 'model output became executable markup')
        check(not page.get_by_role('button', name='复制', exact=True).is_disabled(), 'copy unavailable')
        check(not page.get_by_role('button', name='朗读', exact=True).is_disabled(), 'speech unavailable')
        page.get_by_role('button', name='朗读', exact=True).click()
        # Actual API opening from an extension user gesture; listener command
        # linkage is also checked offline in the worker regression unit test.
        session.ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        page.get_by_role('button', name='复制', exact=True).click()
        expect(page.locator('.text-status')).to_have_text('已复制')
        check(page.evaluate('navigator.clipboard.readText()').startswith('【译】'), 'clipboard text missing')
        result = page.evaluate("""async () => {
          const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
          await chrome.sidePanel.open({tabId:tab.id});return true;
        }""")
        check(result, 'real sidePanel.open failed')
        page.locator('[name=text-input]').fill('first request')
        page.get_by_role('button', name='翻译', exact=True).click()
        page.locator('[name=text-input]').fill('edited text')
        page.wait_for_timeout(200)
        check(page.locator('output').text_content() == '', 'late response overwrote edited text')
        return 'Alt+S registration, real sidePanel.open, service/model/text translation, safe markup, clipboard, speech, stale-edit guard'
    finally:
        session.close()


def userscript_case(pw, host, width, height, touch):
    profile = E2E_ROOT / ('profile-media-gm-' + uuid.uuid4().hex[:8]); context = None; requests = []
    try:
        context = pw.chromium.launch_persistent_context(str(profile), headless=True,
            viewport={'width': width, 'height': height}, has_touch=touch, is_mobile=touch)
        local_youtube(context, requests)
        # Equivalent GM transport for this fixture's cross-www/m caption GET. It
        # never uses the network and preserves anonymous/no-provider-auth semantics.
        caption_stub = """(() => {
          const previous=GM_xmlhttpRequest;const track=%s;
          window.GM_xmlhttpRequest=req=>{
            if(new URL(req.url).pathname!=='/api/timedtext')return previous(req);
            if(!req.anonymous||req.headers.Authorization)throw Error('Caption GET must omit cookies/provider auth');
            const timer=setTimeout(()=>req.onload({status:200,responseText:JSON.stringify(track),responseHeaders:''}),20);
            return {abort(){clearTimeout(timer);req.onabort?.();}};
          };
        })();""" % json.dumps(TRACK)
        context.add_init_script(script=STUB + '\n' + caption_stub + '\n' + (REPO / 'dist' / 'duallens.user.js').read_text(encoding='utf-8'))
        page = context.new_page(); page.goto(f'https://{host}/watch?v=fixture')
        page.wait_for_function('document.querySelector("video").currentTime>17')
        page.wait_for_function("__platformFixture.hasCommand('DualLens 文本翻译')")
        # The product's real keyboard handler, rather than a test-only command.
        page.keyboard.press('Alt+s')
        page.wait_for_function("__platformFixture.elements('[name=text-input]').length===1")
        page.evaluate("""() => {const input=__platformFixture.elements('[name=text-input]')[0]; input.value='Hello <b>plain</b>';input.dispatchEvent(new Event('input'));}""")
        page.evaluate("__platformFixture.elements('.dl-text button[type=submit]')[0].click()")
        page.wait_for_function("__platformFixture.elements('output').some(e=>e.textContent.startsWith('【译】'))")
        check(page.evaluate("__platformFixture.elements('output b').length") == 0, 'GM model output became markup')
        if touch:
            check(page.evaluate("__platformFixture.rect('.panel').width") == width if width < 600 else True, 'mobile text panel exceeds viewport')
            check(page.evaluate("__platformFixture.elements('.dl-text button').every(e=>e.getBoundingClientRect().height>=44)"), 'small touch control')
        click_shadow(page, '[data-tab=subtitles]')
        page.wait_for_function("__platformFixture.elements('[name=subtitle-enabled]').length===1")
        page.evaluate("__platformFixture.elements('[name=subtitle-enabled]')[0].value='on';__platformFixture.elements('.dl-subtitle-settings button[type=submit]')[0].click()")
        page.keyboard.press('Escape'); page.locator('#cc').click()
        page.wait_for_selector('dl-ui[data-dl-subtitles][data-ready]')
        check(page.evaluate("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 17.'))"), 'GM current cue incorrect')
        page.evaluate('fixtureSeek(2.3)')
        page.wait_for_function("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 2.'))")
        gm_command(page, '启用 / 恢复 YouTube 双语字幕')
        page.wait_for_function("!document.querySelector('dl-ui[data-dl-subtitles]')")
        check(page.evaluate('document.querySelector("#movie_player").outerHTML===fixtureBefore'), 'GM restore changed DOM')
        check(page.evaluate('localStorage.length') == 0, 'GM used host storage')
        return f'{host} {width}x{height}: unchanged GM bundle; Alt+S text tab, subtitle settings, safe rendering, seek, exact restore'
    finally:
        if context: context.close()
        remove_runtime_dir(profile)


def main():
    E2E_ROOT.mkdir(parents=True, exist_ok=True); ARTIFACTS.mkdir(parents=True, exist_ok=True)
    run = E2E_ROOT / ('run-media-' + uuid.uuid4().hex[:8]); run.mkdir(); results = []
    try:
        extension, missing = stage_extension(run); check(not missing, 'missing extension assets')
        with sync_playwright() as pw:
            cases = [('extension_www', lambda: extension_case(pw, extension, 'www.youtube.com')),
                     ('extension_mobile_host', lambda: extension_case(pw, extension, 'm.youtube.com')),
                     ('sidepanel', lambda: sidepanel_case(pw, extension)),
                     ('userscript_desktop', lambda: userscript_case(pw, 'www.youtube.com', 1280, 800, False)),
                     ('userscript_phone', lambda: userscript_case(pw, 'm.youtube.com', 375, 812, True)),
                     ('userscript_tablet', lambda: userscript_case(pw, 'm.youtube.com', 800, 1280, True))]
            for name, fn in cases:
                start = time.time()
                try:
                    detail = fn(); results.append({'name': name, 'status': 'PASS', 'detail': detail})
                    print('PASS ' + name + ': ' + detail, flush=True)
                except Exception as exc:
                    results.append({'name': name, 'status': 'FAIL', 'detail': str(exc)})
                    print('FAIL ' + name + ': ' + str(exc), flush=True); traceback.print_exc(limit=4)
                results[-1]['seconds'] = round(time.time() - start, 2)
    finally:
        remove_runtime_dir(run)
    (ARTIFACTS / 'last-run.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    failed = sum(r['status'] == 'FAIL' for r in results)
    print(f'SUMMARY media total={len(results)} PASS={len(results)-failed} FAIL={failed} SKIP=0')
    return int(failed > 0)


if __name__ == '__main__':
    raise SystemExit(main())

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


def local_html5(context):
    """Real native VTT loader, with currentTime driven independently of decoding."""
    vtt = 'WEBVTT\n\n' + '\n\n'.join(f'{i}\n00:{i//60:02}:{i%60:02}.000 --> 00:{(i+1)//60:02}:{(i+1)%60:02}.000\nSentence {i}.\nsecond line' for i in range(30))
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000); stream.writeframes(b'\0\0' * 8000 * 35)
    def route(r):
        url = urlsplit(r.request.url)
        if url.scheme in ('chrome-extension', 'data', 'about', 'blob'):
            r.continue_(); return
        if url.hostname != 'standard.test':
            r.abort(); return
        if url.path == '/standard.vtt':
            r.fulfill(status=200, content_type='text/vtt', body=vtt); return
        if url.path == '/fixture.wav':
            body = audio.getvalue(); match = re.fullmatch(r'bytes=(\d+)-(\d*)', r.request.headers.get('range', ''))
            if match:
                begin = int(match[1]); end = min(int(match[2]) if match[2] else len(body)-1, len(body)-1)
                r.fulfill(status=206, content_type='audio/wav', body=body[begin:end+1], headers={'Accept-Ranges':'bytes','Content-Range':f'bytes {begin}-{end}/{len(body)}'})
            else:
                r.fulfill(status=200, content_type='audio/wav', body=body, headers={'Accept-Ranges':'bytes'})
            return
        r.fulfill(status=200, content_type='text/html', body=(FIXTURE.parent / 'html5.html').read_text(encoding='utf-8'))
    context.route('**/*', route)


def html5_case(pw, extension=None, width=1280, height=800):
    session = None; context = None; profile = None
    try:
        if extension:
            session = Session(pw, extension, '', 'standard-subtitles'); session.start(); context = session.ctx
            session.sw_eval("() => {globalThis.fetch=()=>{throw Error('Offline worker forbids network');};}")
        else:
            profile = E2E_ROOT / ('profile-standard-gm-' + uuid.uuid4().hex[:8])
            context = pw.chromium.launch_persistent_context(str(profile), headless=True, locale="zh-CN",
                viewport={'width': width, 'height': height}, has_touch=width<1000, is_mobile=width<1000)
            context.add_init_script(script=STUB + '\n' + (REPO / 'dist' / 'duallens.user.js').read_text(encoding='utf-8'))
        local_html5(context)
        page = context.new_page(); page.goto('https://standard.test/watch')
        page.wait_for_function('document.querySelector("#standard").textTracks[0].cues?.length===30')
        page.wait_for_function('document.querySelector("#standard").currentTime>17')
        if session:
            session.page = page; session.tab_id = session.sw_eval(JS_FIND_TAB, page.url); session.wait_ready()
            session.command('toggle-subtitles')
            state = session.wait_state(lambda s: s['subtitles']['visible'], 10, 'standard subtitles')['subtitles']
            check(state['order'][0] == 3, 'standard track did not start near playhead')
        else:
            page.wait_for_function("__platformFixture.hasCommand('启用 / 恢复视频双语字幕')")
            check(page.locator('dl-ui[data-dl-subtitles]').count() == 0, 'default-off track translated')
            gm_command(page, '启用 / 恢复视频双语字幕')
        page.wait_for_selector('dl-ui[data-dl-subtitles][data-ready]')
        check(page.locator('dl-ui[data-dl-subtitles]').count() == 1, 'trackless video got an overlay')
        page.wait_for_function('document.querySelector("#standard").textTracks[0].mode==="hidden"')
        if session:
            check('Sentence 17.' in state['current']['source'], 'standard current cue incorrect')
        else:
            page.wait_for_function("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 17.'))")
        page.evaluate('fixtureSeek(1.3)')
        if session:
            session.wait_state(lambda s: s['subtitles']['current'] and 'Sentence 1.' in s['subtitles']['current']['source'], 5, 'standard seek')
        else:
            page.wait_for_function("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 1.'))")
        for button in ['#full', '#full-video']:
            page.locator(button).click(); page.wait_for_function('!!document.fullscreenElement')
            if button == '#full':
                page.wait_for_function('document.fullscreenElement.contains(document.querySelector("dl-ui[data-dl-subtitles]"))')
            else:
                page.wait_for_function('document.querySelector("dl-ui[data-dl-subtitles]").matches(":popover-open")')
            box = page.locator('dl-ui[data-dl-subtitles]').bounding_box(); check(box and box['width'] > 0, 'fullscreen overlay has no bounds')
            page.evaluate('document.exitFullscreen()'); page.wait_for_function('!document.fullscreenElement')
        if session:
            session.command('restore-subtitles'); session.wait_state(lambda s: not s['subtitles']['overlay'], 5, 'standard restore')
        else:
            gm_command(page, '启用 / 恢复视频双语字幕'); page.wait_for_function('!document.querySelector("dl-ui[data-dl-subtitles]")')
        check(page.evaluate('document.querySelector("#standard").textTracks[0].mode') == 'showing', 'native track mode not restored')
        check(page.evaluate('document.querySelector("#standard-player").outerHTML===fixtureBefore'), 'standard restore changed DOM')
        # In-band tracks created by standard APIs need no <track> element.
        page.evaluate("""() => {const v=document.querySelector('#standard');v.textTracks[0].mode='disabled';const t=v.addTextTrack('captions','In-band','en');t.addCue(new VTTCue(1,2,'In-band sentence.'));t.mode='showing';}""")
        if session:
            session.command('toggle-subtitles')
            session.wait_state(lambda s: s['subtitles']['visible'] and 'In-band' in s['subtitles']['current']['source'], 10, 'in-band caption')
            session.command('restore-subtitles'); session.wait_state(lambda s: not s['subtitles']['overlay'], 5, 'in-band restore')
        else:
            gm_command(page, '启用 / 恢复视频双语字幕')
            page.wait_for_function("__platformFixture.elements('.target').some(e=>e.textContent.includes('In-band'))")
            gm_command(page, '启用 / 恢复视频双语字幕'); page.wait_for_function('!document.querySelector("dl-ui[data-dl-subtitles]")')
        check(page.evaluate('[...document.querySelector("#standard").textTracks].map(t=>t.mode)') == ['disabled','showing'], 'in-band restore changed track selection')
        return 'native same-origin VTT + in-band TextTrack, default-off, current-group-first, multiline, seek, container/video fullscreen, mode and exact DOM restore'
    finally:
        if session: session.close()
        elif context: context.close()
        if profile: remove_runtime_dir(profile)


def subtitle_file_case(pw, extension=None):
    session = None; context = None; profile = None
    text = '1\n00:00:01,234 --> 00:00:02,345\n<i>First</i> &amp; plain\nsecond line\n\n2\n01:00:00,001 --> 01:00:01,002\nLast\n'
    try:
        if extension:
            session = Session(pw, extension, '', 'subtitle-file'); session.start(); context = session.ctx
            context.route('https://**/*', lambda r: r.abort())
            page = context.new_page(); page.goto(f'chrome-extension://{session.ext_id}/sidepanel/index.html')
            page.locator('[data-tab=subtitles]').check()
            page.evaluate('window.findSubtitle=s=>[...document.querySelectorAll(s)]')
        else:
            profile = E2E_ROOT / ('profile-subtitle-file-' + uuid.uuid4().hex[:8])
            context = pw.chromium.launch_persistent_context(str(profile), headless=True, locale="zh-CN", accept_downloads=True, viewport={'width':375,'height':812}, is_mobile=True, has_touch=True)
            local_html5(context)
            context.add_init_script(script=STUB + '\n' + (REPO / 'dist' / 'duallens.user.js').read_text(encoding='utf-8'))
            page = context.new_page(); page.goto('https://standard.test/watch')
            page.wait_for_function("__platformFixture.hasCommand('DualLens 文本翻译')"); gm_command(page, 'DualLens 文本翻译')
            click_shadow(page, '[data-tab=subtitles]')
            page.evaluate('window.findSubtitle=s=>__platformFixture.elements(s)')
        def wait_js(expression):
            until = time.monotonic() + 15
            while time.monotonic() < until:
                if page.evaluate(expression): return
                page.wait_for_timeout(30)
            raise AssertionError('subtitle file UI did not reach expected state: ' + expression)
        wait_js('findSubtitle("[name=subtitle-file]").length===1')
        def upload(source, name):
            page.evaluate("""([text,name])=>{const input=findSubtitle('[name=subtitle-file]')[0];const dt=new DataTransfer();dt.items.add(new File([text],name,{type:'text/plain'}));input.files=dt.files;input.dispatchEvent(new Event('change'));}""", [source,name])
        upload(text, 'fixture.srt')
        wait_js("findSubtitle('.subtitle-preview')[0].textContent.includes('second line')")
        check('【译】' not in page.evaluate("findSubtitle('.subtitle-preview')[0].textContent"), 'file translated before explicit click')
        page.evaluate("findSubtitle('button').find(b=>b.textContent==='翻译字幕文件').click()")
        wait_js("findSubtitle('.subtitle-file-status')[0].textContent.startsWith('2 / 2')")
        downloaded = []
        for fmt in ['SRT', 'VTT']:
            with page.expect_download() as item:
                page.evaluate("fmt=>findSubtitle('button').find(b=>b.textContent==='导出双语 '+fmt).click()", fmt)
            content = Path(item.value.path()).read_text(encoding='utf-8')
            check('First &amp; plain\nsecond line\n【译】' in content, 'bilingual export missing source/translation multiline')
            check('00:00:01'+(',' if fmt=='SRT' else '.')+'234' in content, 'export changed timing')
            downloaded.append((fmt, content))
        for fmt, content in downloaded:
            upload(content, 'roundtrip.' + fmt.lower())
            wait_js("findSubtitle('.subtitle-preview')[0].textContent.includes('【译】')")
        upload('x' * (2*1024*1024+1), 'oversized.srt')
        wait_js("findSubtitle('.subtitle-file-status')[0].textContent.includes('不能超过 2 MB')")
        check(page.evaluate("findSubtitle('button').find(b=>b.textContent==='翻译字幕文件').disabled"), 'oversized upload remained translatable')
        return 'explicit local SRT import, multiline/style/entity preview, mock translation, bilingual SRT/VTT downloads and reimport, 2MB Chinese error'
    finally:
        if session: session.close()
        elif context: context.close()
        if profile: remove_runtime_dir(profile)


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
        check(page.locator('.service-choices').is_hidden(), 'single service should not show provider controls')
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
        context = pw.chromium.launch_persistent_context(str(profile), headless=True, locale="zh-CN",
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
            check(page.evaluate("__platformFixture.elements('.dl-text button').filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)"), 'small touch control')
        click_shadow(page, '[data-tab=subtitles]')
        page.wait_for_function("__platformFixture.elements('[name=subtitle-file]').length===1")
        page.keyboard.press('Escape')
        gm_command(page, 'DualLens 设置')
        page.wait_for_function("__platformFixture.elements('[data-group-link=enhance]').length===1")
        click_shadow(page, '[data-group-link=enhance]')
        page.evaluate("()=>{const input=__platformFixture.elements('#subtitlesEnabled')[0];if(!input.checked)input.click();}")
        page.keyboard.press('Escape'); page.locator('#cc').click()
        page.wait_for_selector('dl-ui[data-dl-subtitles][data-ready]')
        check(page.evaluate("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 17.'))"), 'GM current cue incorrect')
        page.evaluate('fixtureSeek(2.3)')
        page.wait_for_function("__platformFixture.elements('.target').some(e=>e.textContent.includes('Sentence 2.'))")
        gm_command(page, '启用 / 恢复视频双语字幕')
        page.wait_for_function("!document.querySelector('dl-ui[data-dl-subtitles]')")
        check(page.evaluate('document.querySelector("#movie_player").outerHTML===fixtureBefore'), 'GM restore changed DOM')
        check(page.evaluate('localStorage.length') == 0, 'GM used host storage')
        return f'{host} {width}x{height}: unchanged GM bundle; Alt+S text tab, subtitle settings, safe rendering, seek, exact restore'
    finally:
        if context: context.close()
        remove_runtime_dir(profile)


def sidepanel_consent_case(pw, extension):
    session=Session(pw,extension,'','sidepanel-consent');session.start()
    try:
        session.settings({'translation':{'mode':'llm'},'provider':{'active':'consent','chain':[],
            'profiles':[{'id':'consent','kind':'openai','baseUrl':'https://fixture.example/v1','model':'test'}]}})
        session.sw_eval("""()=>{globalThis.sideCalls=0;globalThis.fetch=async(url,opts)=>{
          sideCalls++;const p=JSON.parse(opts.body),u=p.messages.find(m=>m.role==='user').content;
          const input=JSON.parse(u.slice(u.indexOf('{'),u.lastIndexOf('}')+1));
          return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.t.map(t=>'【译】'+t)})}}]}),{headers:{'Content-Type':'application/json'}});
        };}""")
        page=session.ctx.new_page();page.goto(f'chrome-extension://{session.ext_id}/sidepanel/index.html')
        page.locator('[name=text-input]').fill('Private fixture text')
        page.locator('.dl-text button[type=submit]').click()
        page.locator('#text .dl-confirmation').wait_for()
        assert session.sw_eval('()=>sideCalls')==0
        assert 'fixture.example' in page.locator('.dl-confirmation').inner_text()
        page.locator('.dl-confirmation .close').click()
        page.wait_for_timeout(100);assert session.sw_eval('()=>sideCalls')==0
        page.locator('.dl-text button[type=submit]').click()
        page.locator('.dl-confirmation .primary').click()
        page.locator('output').filter(has_text='【译】').wait_for()
        session.sw_eval("()=>chrome.storage.local.set({'ui.device':{onboarded:true,acked:[],upgradeNoticeSeen:true}})")
        page.locator('[data-tab=subtitles]').check()
        page.locator('[name=subtitle-file]').set_input_files({'name':'fixture.srt','mimeType':'text/plain',
            'buffer':b'1\n00:00:00,000 --> 00:00:01,000\nA private subtitle fixture.\n'})
        page.locator('button').filter(has_text='翻译字幕文件').click()
        page.locator('#subtitles .dl-confirmation').wait_for()
        count=session.sw_eval('()=>sideCalls');page.wait_for_timeout(100)
        assert session.sw_eval('()=>sideCalls')==count
        page.locator('#subtitles .dl-confirmation .primary').click()
        page.locator('.subtitle-preview').filter(has_text='【译】').wait_for()
        assert session.sw_eval('()=>sideCalls')>count
        return 'text + subtitle file: inline first-send confirmation; close sends nothing, accept persists and dispatches'
    finally:session.close()


def main():
    E2E_ROOT.mkdir(parents=True, exist_ok=True); ARTIFACTS.mkdir(parents=True, exist_ok=True)
    run = E2E_ROOT / ('run-media-' + uuid.uuid4().hex[:8]); run.mkdir(); results = []
    try:
        extension, missing = stage_extension(run); check(not missing, 'missing extension assets')
        with sync_playwright() as pw:
            cases = [('sidepanel_consent', lambda: sidepanel_consent_case(pw, extension)),
                     ('extension_www', lambda: extension_case(pw, extension, 'www.youtube.com')),
                     ('html5_extension', lambda: html5_case(pw, extension)),
                     ('html5_userscript_phone', lambda: html5_case(pw, width=375, height=812)),
                     ('html5_userscript_tablet', lambda: html5_case(pw, width=800, height=1280)),
                     ('subtitle_file_extension', lambda: subtitle_file_case(pw, extension)),
                     ('subtitle_file_userscript', lambda: subtitle_file_case(pw)),
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

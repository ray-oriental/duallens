"""Mock-only translation ink acceptance with isolated extension and shared GM form."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import sys
import uuid
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_ui_v1_browser import e2e, MOCK

PROJECT = Path(__file__).resolve().parents[2]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def wait(page, expression, arg=None):
    # Evaluate through CDP directly: extension CSP forbids the driver's eval poller.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if page.evaluate(expression, arg):
            return
        time.sleep(.05)
    raise AssertionError('timed out waiting for ' + expression)


def settings_cases(page, readback, review):
    page.locator('#translation-color-row').wait_for()
    assert page.locator('[name=translation-color]').count() == 7
    assert page.locator('[name=translation-color][value=auto]').is_checked()
    page.locator('[name=translation-color][value=blue]').check()
    wait(page, readback, arg='blue')
    for theme, expected in [('light', 'rgb(52, 106, 172)'), ('dark', 'rgb(151, 193, 247)')]:
        page.emulate_media(color_scheme=theme)
        wait(page, "color=>getComputedStyle(document.querySelector('#style-preview')).color===color", arg=expected)
        page.locator('#translation-color-row').evaluate("n=>n.parentElement.id='color-review'")
        page.locator('#color-review').screenshot(path=str(review / f'settings-color-{theme}.png'))
    page.locator('[name=translation-color][value=custom]').check()
    assert page.locator('#customTranslationColor').is_visible()
    page.locator('#customTranslationColor').fill('#a8500a')
    page.locator('#customTranslationColor').dispatch_event('change')
    wait(page, readback, arg='#a8500a')
    page.locator('#color-review').screenshot(path=str(review / 'settings-color-custom.png'))
    page.locator('[name=translation-color][value=blue]').focus()
    page.keyboard.press('ArrowRight')
    wait(page, readback, arg='purple')
    assert page.locator('[name=translation-color][value=purple]').is_checked()
    page.keyboard.press('Tab')
    assert page.evaluate("document.activeElement.name!=='translation-color'")
    page.set_viewport_size({'width': 375, 'height': 800})
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    page.locator('#color-review').screenshot(path=str(review / 'settings-color-narrow.png'))
    for box in page.locator('.color-choice').all():
        bounds = box.bounding_box()
        assert bounds['width'] >= 44 and bounds['height'] >= 44, bounds
    page.locator('[name=translation-color][value=auto]').check()
    wait(page, readback, arg='auto')
    assert page.locator('#customTranslationColor').is_hidden()


def main():
    review = e2e.E2E_ROOT / 'review'
    review.mkdir(parents=True, exist_ok=True)
    run = e2e.E2E_ROOT / ('run-trans-color-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run)
    assert not missing
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(PROJECT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    passed = 0
    try:
        with e2e.sync_playwright() as pw:
            h = e2e.Session(pw, ext, base, 'translation-color')
            errors = []
            try:
                h.start()
                h.settings({'translationColor': 'auto', **{f: {'enabled': False} for f in ['floatBall', 'selection', 'hover', 'input', 'comics']}})
                options = h.ctx.new_page()
                options.on('pageerror', lambda e: errors.append(str(e)))
                options.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
                settings_cases(options, "async color=>(await chrome.storage.local.get('settings')).settings?.translationColor===color", review)
                passed += 1
                print('PASS translation_color_settings: presets/custom, live theme preview, native keyboard, 44px touch targets, storage', flush=True)
                h.open('tests/fixtures/article.html')
                h.page.on('pageerror', lambda e: errors.append(str(e)))
                h.page.evaluate("document.documentElement.style.backgroundColor='#ffffff'")
                original = h.page.locator('#p-plain').evaluate('n=>n.outerHTML')
                h.command('toggle-page')
                h.wait_units(['#p-plain'])
                h.page.evaluate("window.inkNode=document.querySelector('#p-plain dl-t')")
                text = h.page.locator('#p-plain dl-t').inner_text()
                for style in ['muted', 'plain', 'dashed', 'highlight', 'quote', 'blur']:
                    h.settings({'style': style, 'translationColor': 'blue'})
                    wait(h.page, "style=>{const t=document.querySelector('#p-plain dl-t');return t.classList.contains('dl-s-'+style)&&getComputedStyle(t).color==='rgb(52, 106, 172)'}", arg=style)
                    assert h.page.evaluate("inkNode===document.querySelector('#p-plain dl-t')")
                    assert h.page.locator('#p-plain dl-t').inner_text() == text
                h.settings({'style': 'plain'})
                h.page.locator('#p-plain').screenshot(path=str(review / 'page-blue-light.png'))
                h.settings({'translationColor': '#ffffff'})
                wait(h.page, "getComputedStyle(document.querySelector('#p-plain dl-t')).color!=='rgb(255, 255, 255)'")
                cdp = h.ctx.new_cdp_session(h.page)
                cdp.send('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-contrast', 'value': 'more'}]})
                wait(h.page, "getComputedStyle(inkNode).color===getComputedStyle(inkNode.parentElement).color")
                cdp.send('Emulation.setEmulatedMedia', {'features': [], 'media': 'print'})
                wait(h.page, "getComputedStyle(inkNode).color===getComputedStyle(inkNode.parentElement).color")
                h.page.emulate_media(media='screen')
                h.settings({'translationColor': 'auto'})
                wait(h.page, "!inkNode.hasAttribute('data-dl-color')")
                assert h.page.evaluate("getComputedStyle(inkNode).color===getComputedStyle(inkNode.parentElement).color")
                h.command('toggle-page')
                wait(h.page, "!document.querySelector('#p-plain dl-t')")
                assert h.page.locator('#p-plain').evaluate('n=>n.outerHTML') == original
                passed += 1
                print('PASS translation_color_live: all six styles, stable node/text, custom contrast, auto restoration, high contrast and print', flush=True)
                h.page.evaluate("document.documentElement.style.backgroundColor='#121212';document.body.style.color='#ececee'")
                h.settings({'translationColor': 'blue', 'style': 'plain'})
                h.command('toggle-page')
                h.wait_units(['#p-plain'])
                wait(h.page, "getComputedStyle(document.querySelector('#p-plain dl-t')).color==='rgb(151, 193, 247)'")
                h.page.locator('#p-plain').screenshot(path=str(review / 'page-blue-dark.png'))
                # Verify ancestor alpha composition rather than OS color preference.
                h.page.evaluate("document.querySelector('#p-plain').style.backgroundColor='rgba(255,255,255,.9)'")
                h.settings({'translationColor': 'green'})
                wait(h.page, "getComputedStyle(document.querySelector('#p-plain dl-t')).color==='rgb(40, 124, 66)'")
                assert not errors, errors
                passed += 1
                print('PASS translation_color_background: dark page shade and composited light panel independent of OS theme', flush=True)
                h.page.evaluate("""url=>new Promise(resolve=>{const f=document.createElement('iframe');f.id='color-frame';f.src=url;f.style.cssText='width:700px;height:300px';f.onload=resolve;document.body.prepend(f);})""", base.replace('127.0.0.1', 'localhost') + '/tests/fixtures/article.html')
                h.sw_eval("async id=>chrome.scripting.insertCSS({target:{tabId:id,allFrames:true},files:['styles/content.css']})", h.tab_id)
                h.sw_eval("async id=>chrome.scripting.executeScript({target:{tabId:id,allFrames:true},files:['content/loader.js']})", h.tab_id)
                frame = h.page.locator('#color-frame').element_handle().content_frame()
                wait(frame, "!!document.querySelector('#p-plain dl-t[data-dl-state=done]')")
                frame.evaluate("window.frameInkNode=document.querySelector('#p-plain dl-t')")
                h.settings({'translationColor': 'purple'})
                wait(frame, "getComputedStyle(document.querySelector('#p-plain dl-t')).color==='rgb(121, 85, 160)'")
                assert frame.evaluate("frameInkNode===document.querySelector('#p-plain dl-t')"), 'color change retranslated cross-origin frame'
                passed += 1
                print('PASS translation_color_frame: cross-origin snapshot updates ink without replacing the translated node', flush=True)
                options.close()
                browser = pw.chromium.launch(headless=True)
                ctx = browser.new_context(viewport={'width': 375, 'height': 800}, is_mobile=True, has_touch=True)
                try:
                    page = ctx.new_page()
                    page.add_init_script(MOCK)
                    page.goto(base + '/tests/dom/form-fixture.html')
                    page.evaluate("""async()=>{
                      const {createSettingsStore}=await import('/extension/shared/settings.js');
                      const {mountSettingsForm}=await import('/extension/ui/forms/index.js');
                      const store=createSettingsStore({localArea:chrome.storage.local,syncArea:chrome.storage.local});
                      window.colorForm=await mountSettingsForm(document.body,{store,platform:{kind:'userscript',coarse:true,localArea:chrome.storage.local}});
                    }""")
                    # The same form mounts without extension APIs and persists to the GM-style local area.
                    page.locator('[name=translation-color][value=purple]').check()
                    wait(page, "uiData.settings?.translationColor==='purple'")
                    page.locator('[name=translation-color][value=custom]').check()
                    page.locator('#customTranslationColor').fill('#123456')
                    page.locator('#customTranslationColor').dispatch_event('change')
                    wait(page, "uiData.settings?.translationColor==='#123456'")
                    page.evaluate('colorForm.destroy()')
                    passed += 1
                    print('PASS translation_color_userscript: shared form preset/custom persistence in local-only storage', flush=True)
                finally:
                    ctx.close()
                    browser.close()
            finally:
                h.close()
    finally:
        server.shutdown()
        server.server_close()
        e2e.remove_runtime_dir(run)
        print(f'SUMMARY translation-color-browser total=5 PASS={passed} FAIL={5-passed} mock-only', flush=True)
    return int(passed != 5)


if __name__ == '__main__':
    sys.exit(main())

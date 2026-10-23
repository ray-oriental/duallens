"""Offline endpoint completion and repeated async feedback in the real options UI."""
import json
import uuid
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/e2e'))
import run_e2e as e2e


def main():
    run = e2e.E2E_ROOT / ('run-endpoint-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run)
    assert not missing
    checks = 0
    with e2e.sync_playwright() as pw:
        h = e2e.Session(pw, ext, '', 'endpoint')
        try:
            h.start()
            h.sw_eval('async()=>{await chrome.storage.local.clear();await chrome.storage.sync.clear()}')
            page = h.ctx.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script("""const nativeFetch=window.fetch.bind(window);
              window.fetch=async(...args)=>{if(['https://example.com/','https://example.net/'].some(p=>String(args[0]).startsWith(p)))
                await new Promise(r=>setTimeout(r,1100));return nativeFetch(...args);};
              const send=chrome.runtime.sendMessage.bind(chrome.runtime);
              chrome.runtime.sendMessage=async(msg,...args)=>{if(msg.type==='cache-clear')
                await new Promise(r=>setTimeout(r,900));return send(msg,...args);};""")
            calls = []
            mode = ['success']

            def reply(route):
                calls.append(route.request.url)
                if mode[0] == 'html' or route.request.url == 'https://example.com/models':
                    route.fulfill(status=200, content_type='text/html', body='<html>Demo home page</html>')
                elif route.request.url.endswith('/models'):
                    route.fulfill(status=200, content_type='application/json', body='{"data":[{"id":"fixture-model"}]}')
                else:
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({
                        'choices':[{'message':{'content':'{"t":["你好。","图书馆很安静。"]}'}}]}))

            h.ctx.route('https://example.com/**', reply)
            h.ctx.route('https://example.net/**', reply)
            page.goto(f'chrome-extension://{h.ext_id}/ui/options.html#ai')
            page.click('[data-preset="custom"]')
            page.locator('#baseUrl').fill('https://example.com')
            page.locator('#apiKey').fill('sk-test-not-real')
            page.click('#test')
            page.locator('#result-test').filter(has_text='请先点').wait_for()
            assert not calls, 'missing model guidance must precede HTTP'
            page.evaluate("document.querySelector('#load-models').click()")
            assert page.locator('#load-models').is_disabled()
            assert page.locator('#load-models').inner_text() == '正在获取…'
            assert page.locator('#status').inner_text() == ''
            page.locator('#result-load-models').filter(has_text='已自动补全为 https://example.com/v1').wait_for()
            assert page.locator('#baseUrl').input_value() == 'https://example.com/v1'
            assert calls == ['https://example.com/models','https://example.com/v1/models']
            assert page.locator('#load-models').is_enabled()
            assert page.locator('#load-models').inner_text() == '获取模型'
            checks += 1
            print('PASS endpoint_form: root HTML -> /v1 discovery; input and notice updated; missing-model guidance before HTTP')

            mode[0] = 'html'
            stamps = []
            for attempt in range(2):
                page.evaluate("document.querySelector('#load-models').click()")
                assert page.locator('#load-models').is_disabled()
                assert page.locator('#result-load-models').inner_text() == ''
                assert page.locator('#status').inner_text() == ''
                page.locator('#result-load-models').filter(has_text='返回的是网页').wait_for()
                text = page.locator('#result-load-models').inner_text()
                assert text[8:11] == ' · '
                stamps.append(text[:8])
                assert page.locator('#result-load-models').get_attribute('aria-live') == 'polite'
                assert page.locator('#load-models').is_enabled()
                assert page.locator('#load-models').inner_text() == '获取模型'
                assert 'sk-test-not-real' not in text
            assert stamps[0] != stamps[1], stamps
            checks += 1
            print('PASS repeated_error: disabled and cleared during each request; restored label; distinct HH:MM:SS; polite result')

            mode[0] = 'success'
            page.locator('#model').fill('fixture-model')
            # example.com's root was proven to be a webpage above and is now remembered; a fresh root that
            # serves the API itself must keep working without /v1.
            calls.clear()
            page.locator('#baseUrl').fill('https://example.net/')
            page.evaluate("document.querySelector('#test').click()")
            assert page.locator('#test').is_disabled()
            assert page.locator('#test').inner_text() == '正在测试…'
            page.locator('#result-test').filter(has_text='连接正常').wait_for()
            assert page.locator('#test').is_enabled()
            assert calls == ['https://example.net/chat/completions'], calls
            page.click('#save')
            page.locator('#saved-toast.show').wait_for()
            # Save only trims the slash; it must not break a working root by adding /v1 unprobed.
            assert page.locator('#baseUrl').input_value() == 'https://example.net'
            assert h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.provider.profiles.find(p=>p.id==='custom').baseUrl") == 'https://example.net'
            checks += 1
            print('PASS test_and_save: test busy state restored; Save trims a working root without adding /v1')

            page.emulate_media(reduced_motion='reduce')
            mode[0] = 'html'
            page.click('#load-models')
            page.locator('#result-load-models').filter(has_text='返回的是网页').wait_for()
            assert page.locator('#result-load-models').evaluate('(n)=>n.getAnimations().length') == 0
            assert not errors, errors
            checks += 1
            print('PASS reduced_motion: result has no animation; no page errors')

            page.click('nav a[href="#data"]')
            button = page.locator('#cache-clear')
            label = button.inner_text()
            page.evaluate("document.querySelector('#cache-clear').click()")
            assert button.is_disabled() and button.inner_text() == '正在处理…'
            assert page.locator('#status').inner_text() == ''
            page.locator('#status:not(:empty)').wait_for()
            assert page.locator('#status').inner_text()[8:11] == ' · '
            assert button.is_enabled() and button.inner_text() == label
            checks += 1
            print('PASS data_action: clear-cache shares disabled/working/cleared/timestamp/restored feedback')
        finally:
            h.close()
            e2e.remove_runtime_dir(run)
    print(f'SUMMARY endpoint-browser total={checks} PASS={checks} FAIL=0 mock-only')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Mock-only gateway configuration/pairing transfer checks. No real listener, key or provider."""
import base64
import json
from pathlib import Path
import uuid
import run_e2e as e2e
import run_userscript_e2e as userscript

TOKEN = 'A' * 43
MODELS = ['sjtu/deepseek-chat', 'hermes/upstage/solar-mini4:free', 'ollama/qwen3:4b', 'claude/haiku', 'codex/default']
PAIR = 'duallens-pair:v1:' + base64.urlsafe_b64encode(json.dumps({
    'urls': ['http://127.0.0.1:18790/v1', 'http://100.100.2.3:18791/v1'], 'token': TOKEN
}).encode()).decode().rstrip('=')
PASSWORD = 'offline test backup passphrase'


def extension_case(pw, run):
    ext, missing = e2e.stage_extension(run, e2e.REPO / 'extension')
    assert not missing
    h = e2e.Session(pw, ext, 'http://127.0.0.1', 'config-center')
    calls = []
    try:
        h.start()
        h.sw_eval('async () => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); }')
        page = h.ctx.new_page()
        h.page = page
        page.set_viewport_size({'width': 375, 'height': 812})

        def mocked(route):
            req = route.request
            calls.append((req.url, req.headers.get('authorization')))
            if req.url.endswith('/health'):
                route.fulfill(status=200, content_type='application/json', body='{"ok":true,"name":"DualLens"}')
            elif req.url.endswith('/v1/models'):
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': [{'id': m} for m in MODELS]}))
            else:
                raise AssertionError('Unexpected provider request; discovery must not call a model')

        h.ctx.route('http://127.0.0.1:18790/**', mocked)
        h.ctx.route('http://100.100.2.3:18791/**', mocked)
        page.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        page.locator('#status').filter(has_text='修改后').wait_for()
        assert not calls
        page.click('#connect-gateway')
        page.locator('#status').filter(has_text='已建立').wait_for()
        chain = json.loads(page.locator('#providerChain').input_value())
        assert [c['model'] for c in chain] == MODELS[:3]
        page.click('#save')
        page.locator('#status').filter(has_text='已保存').wait_for()
        page.locator('#pairingText').fill(PAIR)
        page.click('#import-pairing')
        page.locator('#status').filter(has_text='已导入网关地址').wait_for()
        assert page.locator('#pairingText').input_value() == ''
        assert page.locator('#profile').input_value() == 'gateway-tailscale'
        page.click('#save')
        page.locator('#status').filter(has_text='已保存').wait_for()
        state = h.sw_eval('async () => ({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null)})')
        assert state['local']['secrets']['gateway-tailscale']['apiKey'] == TOKEN
        assert state['local']['secrets']['gateway-usb']['apiKey'] == TOKEN
        assert TOKEN not in json.dumps(state['sync'])
        assert TOKEN not in json.dumps(state['local']['settings'])
        page.click('#load-models')
        page.locator('#status').filter(has_text='获取到').wait_for()
        assert calls[-1] == ('http://100.100.2.3:18791/v1/models', 'Bearer ' + TOKEN)
        # Compact mobile transfer must have a usable local QR, including both pairing secrets.
        page.locator('#backupPassword').fill(PASSWORD)
        page.click('#export-phone')
        page.locator('#status').filter(has_text='加密配置已生成').wait_for()
        assert page.locator('#backup-qr').is_visible()
        assert page.locator('#backup-qr').evaluate('c => c.width >= 21*4')
        encrypted = page.locator('#backupText').input_value()
        assert encrypted.startswith('duallens-config:v1:') and TOKEN not in encrypted
        assert page.locator('#backupPassword').input_value() == ''
        page.select_option('#profile', 'mock')
        page.locator('#targetLang').select_option('ja')
        page.click('#save')
        page.locator('#status').filter(has_text='已保存').wait_for()
        page.locator('#backupText').fill(encrypted)
        page.locator('#backupPassword').fill(PASSWORD)
        page.click('#import-button')
        page.locator('#status').filter(has_text='设置已导入').wait_for()
        assert page.locator('#targetLang').input_value() == 'zh-CN'
        assert page.locator('#profile').input_value() == 'gateway-tailscale'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        print('PASS extension_config_center: mock discovery chain, paired profiles, local-only Bearer, encrypted QR and import roundtrip', flush=True)
        return encrypted
    finally:
        h.close()


GM_MOCK = r"""(() => {
  window.__configCalls = [];
  window.GM_xmlhttpRequest = req => {
    __configCalls.push({url:req.url,paired:req.headers.Authorization==='Bearer '+ 'A'.repeat(43),anonymous:req.anonymous});
    const timer=setTimeout(()=>req.onload({status:200,responseHeaders:'',responseText:JSON.stringify(req.url.endsWith('/health')
      ? {ok:true,name:'DualLens'} : {data:['sjtu/deepseek-chat','hermes/upstage/solar-mini4:free','ollama/qwen3:4b','claude/haiku','codex/default'].map(id=>({id}))})}),10);
    return {abort(){clearTimeout(timer);req.onabort?.();}};
  };
})();"""


def userscript_case(pw, base, encrypted):
    profile = e2e.E2E_ROOT / ('profile-config-center-' + uuid.uuid4().hex[:8])
    context = None
    try:
        context = pw.chromium.launch_persistent_context(str(profile), headless=True,
            viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
        context.add_init_script(script=userscript.STUB)
        context.add_init_script(script=GM_MOCK)
        context.add_init_script(path=str(e2e.REPO / 'dist/duallens.user.js'))
        page = context.new_page()
        userscript.ready(page, base)
        userscript.command(page, 'DualLens 设置')
        page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('修改后'))")
        assert page.evaluate("__platformFixture.elements('input[type=password],#pairingText,#apiKey,#backupPassword').length") == 0
        page.evaluate("() => {window.__poisonCount=0;window.prompt=()=>{__poisonCount++;throw new Error('host prompt called')};}")
        userscript.secret_prompt(page, '#import-pairing', None)
        userscript.secret_prompt(page, '#import-pairing', PAIR)
        page.wait_for_function("__platformFixture.elements('#profile')[0].value==='gateway-tailscale'")
        assert not page.evaluate("!!__platformFixture.data('duallens:local')?.secrets?.['gateway-tailscale']")
        userscript.click_shadow(page, '#save')
        page.wait_for_function("!!__platformFixture.data('duallens:local')?.secrets?.['gateway-tailscale']")
        assert page.evaluate("JSON.stringify(__platformFixture.data('duallens:local')['settings.core']).includes('A'.repeat(43))") is False
        assert page.evaluate("__platformFixture.elements('#key-row')[0].textContent.includes('A'.repeat(43))") is False
        userscript.click_shadow(page, '#load-models')
        page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('获取到'))")
        assert page.evaluate('__configCalls.at(-1).paired && __configCalls.at(-1).anonymous')
        page.evaluate("text => {const e=__platformFixture.elements('#backupText')[0];e.value=text;e.dispatchEvent(new Event('input',{bubbles:true}))}", encrypted)
        userscript.secret_prompt(page, '#import-computer', PASSWORD)
        page.wait_for_function("__platformFixture.elements('#status').some(e=>e.textContent.includes('设置已导入'))")
        assert page.evaluate("__platformFixture.data('duallens:local').secrets['gateway-usb'].apiKey === 'A'.repeat(43)")
        userscript.secret_prompt(page, '#export-phone', PASSWORD)
        page.wait_for_function("__platformFixture.elements('#backup-qr').some(e=>!e.hidden)")
        assert page.evaluate('window.__poisonCount') == 0
        assert page.evaluate('localStorage.length') == 0
        print('PASS userscript_config_center: native secret pairing/cancel, anonymous GM Bearer, computer import and encrypted QR at 375px', flush=True)
    finally:
        if context:
            context.close()
        e2e.remove_runtime_dir(profile)


def main():
    run = e2e.E2E_ROOT / ('run-config-center-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    server, base = e2e.start_fixtures()
    try:
        with e2e.sync_playwright() as pw:
            encrypted = extension_case(pw, run)
            userscript_case(pw, base, encrypted)
    finally:
        server.shutdown()
        server.server_close()
        e2e.remove_runtime_dir(run)
    print('SUMMARY config-center total=2 PASS=2 FAIL=0 mock-only')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Mock-only UI acceptance, theme screenshots and permission/storage readback."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import importlib.util
import json
import sys
import uuid

PROJECT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ui_e2e', PROJECT / 'tests/e2e/run_e2e.py')
e2e = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = e2e
spec.loader.exec_module(e2e)

MOCK = r"""(() => {
 const data={},listeners=new Set(); window.uiData=data;window.uiMessages=[];
 const area={async get(keys){return keys===null?structuredClone(data):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(items){Object.assign(data,structuredClone(items));for(const cb of listeners)cb(Object.fromEntries(Object.keys(items).map(k=>[k,{}])),'local')},async remove(keys){for(const k of keys)delete data[k]}};
 window.chrome={storage:{local:area,sync:area,onChanged:{addListener:cb=>listeners.add(cb),removeListener:cb=>listeners.delete(cb)}},commands:{async getAll(){return[{name:'toggle-page',shortcut:'Alt+A'}]}},tabs:{async query(){return[{id:7,url:'https://docs.example.com/guide/intro'}]},async sendMessage(id,msg){uiMessages.push(msg.type);if(msg.type==='get-state')return window.uiState;if(msg.type==='command'){uiState={...uiState,translated:!uiState.translated};return{ok:true}}},async create(){}},permissions:{async request(){return window.allowPermission},async contains(){return false}},runtime:{async sendMessage(msg){uiMessages.push(msg.type);throw Error('old worker')},getURL:p=>'/extension/'+p}};
 window.uiState={translated:false,done:0,pending:0,failed:0};window.allowPermission=false;
})();"""

def main():
    artifact = e2e.E2E_ROOT / 'v1' / 'ui'
    artifact.mkdir(parents=True, exist_ok=True)
    run = e2e.E2E_ROOT / ('run-ui-v1-' + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run, PROJECT / 'extension')
    assert not missing
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(PROJECT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    checks = 0
    with e2e.sync_playwright() as p:
        h = e2e.Session(p, ext, base, 'ui-v1')
        errors = []
        try:
            h.start()
            h.sw_eval('async()=>{await chrome.storage.local.clear();await chrome.storage.sync.clear()}')
            page = h.ctx.new_page()
            h.page = page
            page.set_viewport_size({'width': 1100, 'height': 900})
            page.on('pageerror', lambda err: errors.append(str(err)))
            calls = []
            fixture = json.loads((PROJECT / 'tests/unit/fixtures/openrouter-models.json').read_text(encoding='utf-8'))
            probes = []

            def provider(route):
                calls.append(route.request.url)
                if route.request.url.endswith('/models'):
                    assert 'authorization' not in route.request.headers
                    route.fulfill(status=200, content_type='application/json', body=json.dumps(fixture))
                elif route.request.url.endswith('/chat/completions'):
                    assert route.request.headers.get('authorization') == 'Bearer sk-test-not-real'
                    assert 'The library is quiet.' in route.request.post_data
                    probes.append(route.request.url)
                    content = '{"t":["你好，世界。"]}' if len(probes)==1 else '{"t":["你好，世界。","图书馆很安静。"]}'
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':content}}]}))
                else:
                    route.abort()

            h.ctx.route('https://**/*', provider)
            page.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
            page.locator('#status').filter(has_text='修改后').wait_for()
            assert page.locator('nav a').count() == 7
            assert calls == []
            for feature in ['floatEnabled','selectionEnabled','hoverEnabled','inputEnabled','subtitlesEnabled','comicsEnabled']:
                assert not page.locator('#'+feature).is_checked()
            for theme in ['light','dark']:
                page.emulate_media(color_scheme=theme)
                for group in ['common','ai','enhance','sites','glossary','data','about']:
                    page.locator(f'nav a[href="#{group}"]').click()
                    assert page.locator(f'[data-group="{group}"]').is_visible()
                    assert page.locator('[data-group]:visible').count() == 1
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    page.screenshot(path=str(artifact/f'settings-{group}-{theme}.png'), full_page=True)
            checks += 1
            print('PASS seven_groups: hash routing, one visible group, light/dark, fresh enhancements off, no network')
            page.locator('nav a[href="#common"]').click()
            page.select_option('#targetLang','ja')
            page.wait_for_function("async()=> (await chrome.storage.local.get('settings')).settings?.targetLang==='ja'")
            page.locator('input[name="style-tile"][value="quote"]').check()
            page.wait_for_function("async()=> (await chrome.storage.local.get('settings')).settings?.style==='quote'")
            page.locator('nav a[href="#enhance"]').click()
            page.locator('#floatEnabled').check()
            page.wait_for_function("async()=> (await chrome.storage.local.get('settings')).settings?.floatBall.enabled")
            page.locator('#floatAutoHide').uncheck()
            page.wait_for_function("async()=> !(await chrome.storage.local.get('settings')).settings?.floatBall.autoHide")
            page.locator('#floatEnabled').uncheck()
            page.wait_for_function("async()=> !(await chrome.storage.local.get('settings')).settings?.floatBall.enabled")
            checks += 1
            print('PASS instant_settings: language, style tile, enhancement and autoHide persisted without Save')
            page.locator('nav a[href="#ai"]').click()
            page.locator('[data-preset="openrouter"]').click()
            page.locator('#apiKey').fill('sk-test-not-real')
            page.click('#show-key')
            assert page.locator('#apiKey').get_attribute('type') == 'text'
            page.click('#show-key')
            assert page.locator('#apiKey').get_attribute('type') == 'password'
            page.click('#load-models')
            page.locator('#status').filter(has_text='获取到 4').wait_for()
            page.click('#test')
            page.locator('#status').filter(has_text='JSON').wait_for()
            page.click('#test')
            page.locator('#status').filter(has_text='连接正常').wait_for()
            assert not h.sw_eval("async()=> (await chrome.storage.local.get('secrets')).secrets")
            page.click('#save')
            page.locator('#status').filter(has_text='已保存').wait_for()
            result = h.sw_eval("async()=>({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null)})")
            assert result['local']['secrets']['openrouter']['apiKey'] == 'sk-test-not-real'
            assert 'sk-test-not-real' not in json.dumps(result['sync'])
            assert 'llm:https://openrouter.ai' in result['local']['ui.device']['acked']
            chain = page.locator('#providerChain').input_value()
            assert len(json.loads(chain)) == 3
            assert page.locator('#chain-list button').first.is_disabled()
            page.locator('nav a[href="#data"]').click()
            # Clicking a disabled move button must not mark the form dirty.
            page.locator('#backupPassword').fill('ui fixture passphrase')
            with page.expect_download():
                page.click('#export')
            encrypted = page.locator('#backupText').input_value()
            assert encrypted.startswith('duallens-config:v1:') and 'sk-test-not-real' not in encrypted
            page.locator('#backupPassword').fill('incorrect')
            page.click('#import-button')
            page.locator('#status').filter(has_text='口令错误').wait_for()
            page.locator('#backupPassword').fill('ui fixture passphrase')
            page.click('#import-button')
            page.locator('#status').filter(has_text='已导入').wait_for()
            assert h.sw_eval("async()=> (await chrome.storage.local.get('secrets')).secrets.openrouter.apiKey") == 'sk-test-not-real'
            with page.expect_download():
                page.click('#export')
            public = page.locator('#backupText').input_value()
            assert 'sk-test-not-real' not in public and 'ui.device' not in public and 'acked' not in public
            checks += 1
            print('PASS provider_backup: mocked discovery/test, local key, acknowledgement, encrypted roundtrip, wrong password, public redaction')
            for theme in ['light','dark']:
                page.set_viewport_size({'width':375,'height':812})
                page.emulate_media(color_scheme=theme)
                for group in ['common','ai','enhance','sites','glossary','data','about']:
                    page.locator(f'nav a[href="#{group}"]').click()
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    for node in page.locator('button:visible,select:visible,input:visible:not([type=checkbox]):not([type=radio]),textarea:visible').all():
                        rect = node.bounding_box()
                        assert rect['height'] >= 44, (group, node.get_attribute('id'), rect)
                    page.screenshot(path=str(artifact/f'settings-{group}-375-{theme}.png'),full_page=True)
            checks += 1
            print('PASS mobile_settings: seven groups at 375px, controls >=44px, no horizontal overflow, light/dark')
            popup = h.ctx.new_page()
            popup.set_viewport_size({'width':360,'height':600})
            popup.on('pageerror',lambda err:errors.append(str(err)))
            popup.add_init_script(MOCK)
            for theme in ['light','dark']:
                popup.emulate_media(color_scheme=theme)
                popup.goto(base+'/extension/ui/popup.html')
                popup.locator('#onboard-next').wait_for()
                popup.screenshot(path=str(artifact/f'popup-onboarding-{theme}.png'))
                popup.click('#onboard-next')
                popup.screenshot(path=str(artifact/f'popup-onboarding-engine-{theme}.png'))
                popup.click('#onboard-next')
                assert 'mt:microsoft' in popup.evaluate("uiData['ui.device'].acked")
                popup.click('#onboard-next')
                popup.locator('#toggle:not([disabled])').wait_for()
                assert popup.evaluate('uiMessages.indexOf("tab-ensure")<uiMessages.indexOf("get-state")')
                assert popup.locator('#feature-floatBall').is_checked() is False
                assert popup.locator('.dl-popup').bounding_box()['height'] <= 600
                popup.screenshot(path=str(artifact/f'popup-default-{theme}.png'))
                popup.click('#toggle')
                popup.locator('#toggle').filter(has_text='显示原文').wait_for()
                popup.screenshot(path=str(artifact/f'popup-translated-{theme}.png'))
                popup.locator('#feature-selection').click()
                assert not popup.locator('#feature-selection').is_checked()
                assert '权限' in popup.locator('#status').inner_text()
                assert not popup.evaluate("uiData.settings?.selection?.enabled||false")
                popup.evaluate('allowPermission=true')
                popup.locator('input[name="本站"][value="always"]').check()
                popup.locator('#site-path').wait_for()
                assert popup.locator('.dl-popup').bounding_box()['height'] <= 600
                popup.screenshot(path=str(artifact/f'popup-path-{theme}.png'))
            checks += 1
            print('PASS popup_states: onboarding/default/translated/path, <=600px, tab-ensure fallback, denied permission remains off')
            # Exercise the owned mobile integration seam with native modules; the release
            # entry-point menu binding is deliberately left to its owner.
            mobile_context = p.chromium.launch_persistent_context(str(run/'mobile'),headless=True,
                viewport={'width':375,'height':812},has_touch=True,is_mobile=True)
            try:
                mobile = mobile_context.new_page()
                mobile.add_init_script(MOCK + r"""
                  window.uiRoots=[];const original=Element.prototype.attachShadow;
                  Element.prototype.attachShadow=function(options){const root=original.call(this,options);uiRoots.push(root);return root;};
                """)
                mobile.goto(base+'/tests/dom/form-fixture.html')
                mobile.evaluate(r"""async()=>{
                  const {createSettingsStore}=await import('/extension/shared/settings.js');
                  const {mountSettingsForm}=await import('/extension/ui/forms/index.js');
                  const {registerPopupMenu,createSettingsPanel}=await import('/extension/userscript/panel.js');
                  uiData['ui.device']={onboarded:true,acked:[],upgradeNoticeSeen:true};
                  const area=chrome.storage.local,store=createSettingsStore({localArea:area,syncArea:area});
                  const platform={kind:'userscript',coarse:true,localArea:area,settingsStore:store,registerCommand(id,label,fn){window.menuLabel=label;window.menuOpen=fn;},openSettings(){window.settingsPanel=createSettingsPanel({store,platform,mountForm:mountSettingsForm});void settingsPanel.open();}};
                  window.mobilePanel=registerPopupMenu({platform,loadSettingsForm:async()=>mountSettingsForm,pageMessage:async msg=>msg.type==='get-state'?uiState:{ok:true}});
                  menuOpen();
                }""")
                mobile.wait_for_function("uiRoots.some(r=>r.querySelector('#feature-floatBall'))")
                assert mobile.evaluate('menuLabel') == 'DualLens'
                assert mobile.evaluate("matchMedia('(pointer:coarse)').matches")
                for theme in ['light','dark']:
                    mobile.emulate_media(color_scheme=theme)
                    geometry=mobile.evaluate("""()=>{const r=uiRoots.find(r=>r.querySelector('.popup-panel')),p=r.querySelector('.popup-panel').getBoundingClientRect();return {x:p.x,y:p.y,w:p.width,bottom:p.bottom,overflow:r.querySelector('.dl-popup').scrollWidth>375};}""")
                    assert geometry['x']==0 and geometry['w']==375 and abs(geometry['bottom']-812)<2 and not geometry['overflow'],geometry
                    assert mobile.evaluate("uiRoots.flatMap(r=>[...r.querySelectorAll('.feature-row')]).every(n=>n.getBoundingClientRect().height>=44)")
                    mobile.screenshot(path=str(artifact/f'mobile-bottom-panel-{theme}.png'))
                mobile.evaluate("uiRoots.find(r=>r.querySelector('#options')).querySelector('#options').click()")
                mobile.wait_for_function("uiRoots.some(r=>r.querySelector('.dl-settings'))")
                for theme in ['light','dark']:
                    mobile.emulate_media(color_scheme=theme)
                    assert mobile.evaluate("""()=>{const root=uiRoots.find(r=>r.querySelector('.dl-settings')),p=root.querySelector('.panel').getBoundingClientRect();return p.x===0&&p.y===0&&p.width===375&&p.height===812;}""")
                    mobile.screenshot(path=str(artifact/f'mobile-fullscreen-settings-{theme}.png'))
                mobile.evaluate("""()=>{const root=uiRoots.find(r=>r.querySelector('.dl-settings'));root.querySelector('nav a[href="#glossary"]').click();const field=root.querySelector('#glossary');field.value='kernel → 内核';field.dispatchEvent(new Event('input',{bubbles:true}));}""")
                mobile.keyboard.press('Escape')
                mobile.wait_for_function("uiRoots.some(r=>r.querySelector('.confirmation'))")
                mobile.evaluate("uiRoots.find(r=>r.querySelector('.confirmation')).querySelector('.confirmation button').click()")
                assert mobile.evaluate("uiRoots.some(r=>r.querySelector('#glossary')?.value==='kernel → 内核')")
                mobile.keyboard.press('Escape')
                mobile.wait_for_function("uiRoots.some(r=>r.querySelector('.confirmation'))")
                mobile.evaluate("uiRoots.find(r=>r.querySelector('.confirmation')).querySelector('.confirmation button:last-child').click()")
                mobile.wait_for_function("!document.querySelector('dl-ui')")
                checks += 1
                print('PASS mobile_panel: menu seam, bottom sheet at 375px, >=44px rows, fullscreen lazy settings, light/dark')
            finally:
                mobile_context.close()
            assert not errors, errors
        finally:
            h.close()
            server.shutdown()
            server.server_close()
            e2e.remove_runtime_dir(run)
    print(f'SUMMARY settings-browser total={checks} PASS={checks} FAIL=0 mock-only')
    print('ARTIFACTS '+str(artifact))
    return 0

if __name__=='__main__':
    sys.exit(main())

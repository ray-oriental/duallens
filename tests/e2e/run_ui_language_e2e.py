"""Offline UI preference regression in an English browser, including the lazy GM UI."""
import json
import os
import uuid
import time
from pathlib import Path
from run_e2e import Session, REPO, E2E_ROOT, stage_extension, start_fixtures, remove_runtime_dir, check, sync_playwright
from run_userscript_e2e import STUB, command, click_shadow

def wait(page, expression, timeout=12):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if page.evaluate(expression):return
        page.wait_for_timeout(100)
    raise AssertionError('condition timed out: '+expression+'; state='+str(page.evaluate("()=>({lang:document.documentElement.lang,common:document.querySelector('[data-group-link=common]')?.textContent,status:document.querySelector('#status')?.textContent})")))


OUT=Path(os.environ.get('DUALLENS_UILANG_ARTIFACTS',str(E2E_ROOT/'v1'/'uilang')))


def extension(pw,ext,base):
    h=Session(pw,ext,base,'ui-language',locale='en-US')
    errors=[]
    try:
        h.start()
        h.sw_eval('async()=>{await chrome.storage.local.clear();await chrome.storage.sync.clear()}')
        h.open('article.html?ui-language')
        options=h.ctx.new_page();options.on('pageerror',lambda e:errors.append(str(e)))
        options.set_viewport_size({'width':1100,'height':900});options.emulate_media(color_scheme='light')
        options.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        options.locator('#uiLanguage').wait_for()
        check(options.evaluate('chrome.i18n.getUILanguage()')=='en-US','not an English browser')
        check(options.locator('#uiLanguage').input_value()=='zh-CN','fresh UI must default to Chinese')
        wait(options,"()=>document.documentElement.lang==='zh-CN' && document.querySelector('[data-group-link=common]').textContent==='常用'")
        check(options.locator('.common-rows>.field').first.locator('select').get_attribute('id')=='uiLanguage','UI language is not the first common row')
        target=options.locator('#targetLang').input_value()
        options.screenshot(path=str(OUT/'settings-common-default-zh-CN.png'),full_page=True,caret='initial')

        popup=h.ctx.new_page();popup.on('pageerror',lambda e:errors.append(str(e)))
        popup.add_init_script('chrome.tabs.query=async()=>'+json.dumps([{'id':h.tab_id,'url':base+'/article.html'}])+';')
        popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html');popup.locator('#onboard-language').wait_for()
        check(popup.locator('#onboard-next').inner_text()=='下一步','default popup copy is not Chinese')
        check(popup.locator('#uiLanguage').count()==0,'onboarding must only choose translation target')
        side=h.ctx.new_page();side.on('pageerror',lambda e:errors.append(str(e)))
        side.goto(f'chrome-extension://{h.ext_id}/sidepanel/index.html');side.locator('textarea').fill('Unsaved source text')
        reader=h.ctx.new_page();reader.on('pageerror',lambda e:errors.append(str(e)))
        reader.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html')

        # Keep an unsaved AI draft in another settings window while switching.
        draft=h.ctx.new_page();draft.on('pageerror',lambda e:errors.append(str(e)))
        draft.goto(f'chrome-extension://{h.ext_id}/ui/options.html#ai')
        draft.locator('#preset-custom').click();draft.locator('#baseUrl').fill('https://example.org/v1')
        draft.locator('#apiKey').fill('sk-test-not-real')
        options.locator('#uiLanguage').select_option('en')
        wait(options,"()=>document.documentElement.lang==='en' && document.querySelector('[data-group-link=common]').textContent==='General'")
        wait(popup,"()=>document.querySelector('#onboard-next').textContent==='Next'")
        wait(side,"()=>document.querySelector('button[type=submit]').textContent==='Translate'")
        wait(reader,"()=>document.documentElement.lang==='en'")
        wait(draft,"()=>document.querySelector('[data-group-link=common]').textContent==='General'")
        check(draft.locator('#apiKey').input_value()=='sk-test-not-real','language change discarded secret draft')
        check(draft.locator('#baseUrl').input_value()=='https://example.org/v1','language change discarded service draft')
        check(side.locator('textarea').input_value()=='Unsaved source text','language change discarded source text')
        check(options.locator('#targetLang').input_value()==target,'UI switch changed translation target')
        check(popup.locator('#onboard-language').input_value()==target,'UI switch changed onboarding target')
        check(options.locator('#saved-toast').count()==1,'relocalization removed the appended saved indicator')
        check(options.evaluate('document.documentElement.scrollWidth<=innerWidth'),'settings overflow')
        options.screenshot(path=str(OUT/'settings-common-en.png'),full_page=True,caret='initial')
        synced=h.sw_eval("async()=> (await chrome.storage.sync.get('settings.core'))['settings.core'].uiLanguage")
        check(synced=='en','preference is not in sync core')
        options.locator('#uiLanguage').select_option('auto')
        wait(options,"()=>document.documentElement.lang==='en'")
        options.locator('#uiLanguage').select_option('zh-CN')
        wait(popup,"()=>document.querySelector('#onboard-next').textContent==='下一步'")
        check(not errors,'page error: '+str(errors))
        print('PASS extension: English browser defaults to Chinese; live popup/settings/sidebar/PDF; sync; drafts and target preserved',flush=True)
    finally:h.close()


def userscript(pw,base):
    browser=pw.chromium.launch(headless=True)
    ctx=browser.new_context(locale='en-US',viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    try:
        ctx.add_init_script(STUB+'\n'+(REPO/'dist/duallens.user.js').read_text('utf-8'))
        page=ctx.new_page();page.goto(base+'/article.html?ui-language-gm')
        wait(page,"()=>__platformFixture.hasCommand('DualLens 设置')")
        before=page.evaluate('document.documentElement.lang')
        command(page,'DualLens 设置')
        wait(page,"()=>__platformFixture.elements('#uiLanguage').length===1")
        check(page.evaluate("__platformFixture.elements('#uiLanguage')[0].value")=='zh-CN','GM default UI is not Chinese')
        page.evaluate("()=>{const n=__platformFixture.elements('#uiLanguage')[0];n.value='en';n.dispatchEvent(new Event('change',{bubbles:true}));}")
        wait(page,"()=>__platformFixture.elements('[data-group-link=common]')[0].textContent==='General'")
        check(page.evaluate('document.documentElement.lang')==before,'GM relocalization changed original page language')
        page.keyboard.press('Escape');command(page,'DualLens')
        wait(page,"()=>__platformFixture.elements('#onboard-next')[0]?.textContent==='Next'")
        page.keyboard.press('Escape')
        print('PASS userscript: lazy settings row; English live switch; popup preference; original page language preserved',flush=True)
    finally:ctx.close();browser.close()


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    run=E2E_ROOT/('run-ui-language-'+uuid.uuid4().hex[:8]);run.mkdir()
    ext,missing=stage_extension(run);check(not missing,'missing assets')
    server,base=start_fixtures()
    try:
        with sync_playwright() as pw:
            extension(pw,ext,base);userscript(pw,base)
        print('UI LANGUAGE E2E: 2 passed, 0 failed',flush=True)
    finally:server.shutdown();remove_runtime_dir(run)


if __name__=='__main__':main()

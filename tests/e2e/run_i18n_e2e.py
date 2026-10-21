"""Offline bilingual UI screenshots and real Chrome i18n/GM dictionary acceptance."""
import json
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
from run_e2e import Session, REPO, E2E_ROOT, stage_extension, start_fixtures, remove_runtime_dir, check
from run_userscript_e2e import STUB, command, click_shadow

OUT = Path(os.environ.get('DUALLENS_I18N_ARTIFACTS', str(E2E_ROOT/'v1'/'i18n')))

def geometry(page):
    return page.evaluate('''() => ({page:document.documentElement.scrollWidth<=innerWidth,
      clipped:[...document.querySelectorAll('button,nav a,.dl-segment span,.group-title,h2,.privacy,.engine-row strong,.feature-row>span')]
      .filter(n=>n.getClientRects().length && n.scrollWidth>n.clientWidth+2)
      .map(n=>n.textContent)})''')

def screenshot(page,name):
    page.bring_to_front()
    layout=geometry(page)
    check(layout['page'] and not layout['clipped'],f'{name}: overflow {layout}')
    page.screenshot(path=str(OUT/(name+'.png')),full_page=True)

def extension(pw,base,ext,locale):
    h=Session(pw,ext,base,'i18n-'+locale,locale=locale)
    try:
        h.start()
        h.settings({'targetLang':'ja',**{f:{'enabled':False} for f in ['selection','hover','input','floatBall','comics','subtitles']}})
        h.open('article.html?locale='+locale)
        popup=h.ctx.new_page()
        popup.set_viewport_size({'width':360,'height':900})
        popup.add_init_script('chrome.tabs.query = async () => '+json.dumps([{'id':h.tab_id,'url':base+'/article.html'}])+';')
        popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
        popup.locator('#onboard-language').wait_for()
        actual=popup.evaluate('chrome.i18n.getUILanguage()')
        check(actual.lower()==locale.lower(),f'Chrome UI locale {actual}, expected {locale}')
        check(popup.evaluate('chrome.i18n.getMessage("m7e",["12"])').find('12')>=0,'native substitutions were not expanded')
        expected='你想读哪种语言？' if locale=='zh-CN' else 'Which language do you want to read?'
        check(popup.locator('h2').inner_text()==expected,'onboarding language mismatch')
        check(popup.locator('#onboard-language').input_value()=='ja','UI locale changed translation target')
        screenshot(popup,locale+'-popup-onboarding')
        popup.locator('#onboard-next').click()
        screenshot(popup,locale+'-popup-destinations')
        popup.locator('#onboard-next').click()
        screenshot(popup,locale+'-popup-ready')
        popup.locator('#onboard-next').click()
        popup.locator('#toggle').wait_for()
        screenshot(popup,locale+'-popup')
        options=h.ctx.new_page()
        options.set_viewport_size({'width':1100,'height':900})
        options.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        options.locator('nav a').first.wait_for()
        check(options.evaluate('document.documentElement.lang')==('zh-CN' if locale=='zh-CN' else 'en'),'HTML lang mismatch')
        for group in ['common','ai','enhance','sites','glossary','data','about']:
            options.locator(f'nav a[href="#{group}"]').click()
            screenshot(options,locale+'-settings-'+group)
        options.locator('nav a[href="#ai"]').click()
        options.locator('[data-preset="ollama"]').click()
        screenshot(options,locale+'-settings-local')
        for path,name,width in [('sidepanel/index.html','sidepanel',390),('pdf/viewer.html','pdf-reader',1280)]:
            tool=h.ctx.new_page();tool.set_viewport_size({'width':width,'height':900})
            tool.goto(f'chrome-extension://{h.ext_id}/{path}')
            tool.locator('body').wait_for();tool.wait_for_timeout(250)
            screenshot(tool,locale+'-'+name)
        # A new remote destination must be disclosed before the page receives any markers.
        remote={'id':'remote','kind':'openai','name':'Fixture AI','baseUrl':'https://consent.duallens.invalid/v1','model':'test',
                'maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':5000,'fallbackModels':[]}
        h.settings({'provider':{'active':'remote','chain':[],'profiles':[remote]},'translation':{'mode':'llm'}})
        h.page.bring_to_front()
        original=h.page.locator('#p-plain').inner_html()
        h.command('toggle-page')
        cdp=h.ctx.new_cdp_session(h.page)
        title='确认发送' if locale=='zh-CN' else 'Confirm sending'
        nodes=[]
        for _ in range(80):
            nodes=cdp.send('Accessibility.getFullAXTree')['nodes']
            if any(n.get('name',{}).get('value')==title for n in nodes):break
            h.page.wait_for_timeout(100)
        check(any(n.get('name',{}).get('value')==title for n in nodes),'native confirmation language mismatch')
        check(h.page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'progress visible before consent')
        screenshot(h.page,locale+'-confirmation')
        h.page.keyboard.press('Escape')
        h.page.wait_for_timeout(200)
        check(h.page.locator('#p-plain').inner_html()==original,'dismissal changed source DOM')
        check(h.page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'dismissal left markers')
        return {'locale':locale,'nativeLocale':actual,'targetLang':'ja','screenshots':'popup, seven settings groups, local service and native confirmation'}
    finally:h.close()

def userscript(pw,base,locale):
    browser=pw.chromium.launch(headless=True)
    context=browser.new_context(locale=locale,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    try:
        context.add_init_script(STUB+'\n'+(REPO/'dist/duallens.user.js').read_text(encoding='utf-8'))
        page=context.new_page();page.goto(base+'/article.html?gm='+locale)
        label='翻译 / 恢复当前页面' if locale=='zh-CN' else 'Translate / Show original page'
        page.wait_for_function('label=>__platformFixture.hasCommand(label)',arg=label)
        check(page.evaluate('__platformFixture.resourceReads.length')==0,'startup read settings resource')
        command(page,'DualLens')
        page.wait_for_function("__platformFixture.elements('#onboard-skip').length>0")
        screenshot(page,locale+'-userscript-onboarding')
        click_shadow(page,'#onboard-skip')
        page.wait_for_function("__platformFixture.elements('#toggle').length>0")
        screenshot(page,locale+'-userscript-popup')
        check(page.evaluate('__platformFixture.resourceReads.length')>0,'popup did not load lazy resource')
        page.keyboard.press('Escape')
        command(page,'DualLens 设置' if locale=='zh-CN' else 'DualLens settings')
        page.wait_for_function("__platformFixture.elements('[data-group=common]').some(n=>!n.hidden)")
        screenshot(page,locale+'-userscript-settings')
        for group in ['ai','enhance','sites','glossary','about','data']:
            page.evaluate("g=>__platformFixture.elements('[data-group-link]').find(n=>n.dataset.groupLink===g).click()",group)
            page.wait_for_function("g=>__platformFixture.elements('[data-group='+g+']').some(n=>!n.hidden)",arg=group)
            overflow=page.evaluate("__platformFixture.elements('button,.dl-segment span,h2,.feature-top').filter(n=>n.getClientRects().length&&n.scrollWidth>n.clientWidth+2).map(n=>n.textContent)")
            check(not overflow,f'{locale} GM settings overflow: {overflow}')
        screenshot(page,locale+'-userscript-data')
        page.once('dialog',lambda dialog:dialog.dismiss())
        click_shadow(page,'#export-phone')
        # Cancel the native secret dialog; no key or passphrase enters the page.
        screenshot(page,locale+'-userscript-data-actions')
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        profile={'id':'remote','kind':'openai','name':'Fixture AI','baseUrl':'https://consent.duallens.invalid/v1','model':'test','maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':5000,'fallbackModels':[]}
        page.evaluate('p=>__platformFixture.settings({provider:{active:p.id,profiles:[p],chain:[]},translation:{mode:"llm"}})',profile)
        page.wait_for_timeout(200);command(page,label)
        page.wait_for_function("__platformFixture.elements('.confirm').length===1")
        title=page.evaluate("__platformFixture.elements('.confirm')[0].getAttribute('aria-label')")
        check(title==('确认发送' if locale=='zh-CN' else 'Confirm sending'),'GM confirmation locale mismatch')
        check(page.evaluate('__platformFixture.calls.length')==0,'GM sent text before consent')
        screenshot(page,locale+'-userscript-confirmation')
    finally:context.close();browser.close()

def chinese_alias(pw,base,ext):
    h=Session(pw,ext,base,'i18n-zh-TW',locale='zh-TW')
    try:
        h.start();page=h.ctx.new_page()
        page.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        page.locator('nav a').first.wait_for()
        result=page.evaluate('''()=>({locale:chrome.i18n.getUILanguage(),name:chrome.runtime.getManifest().name,
            heading:document.querySelector('.settings-heading').textContent,lang:document.documentElement.lang})''')
        check(result=={'locale':'zh-TW','name':'DualLens 双语对照翻译','heading':'DualLens 设置','lang':'zh-CN'},f'Chinese alias mismatch: {result}')
        print('PASS Chinese locale alias zh-TW',flush=True)
    finally:h.close()

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    run=E2E_ROOT/('run-i18n-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
    ext,missing=stage_extension(run,REPO/'extension');check(not missing,'missing assets')
    server,base=start_fixtures();rows=[]
    try:
        with sync_playwright() as pw:
            for locale in ['en-US','zh-CN']:
                rows.append(extension(pw,base,ext,locale));print('PASS extension i18n '+locale,flush=True)
                userscript(pw,base,locale);print('PASS userscript i18n '+locale,flush=True)
            chinese_alias(pw,base,ext)
        (OUT/'browser-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
        print('I18N E2E: 5 passed, 0 failed',flush=True);return 0
    finally:server.shutdown();remove_runtime_dir(run)

if __name__=='__main__':raise SystemExit(main())

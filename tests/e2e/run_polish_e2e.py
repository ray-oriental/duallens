"""Offline visual polish acceptance: bilingual, two themes, desktop and 375px."""
import json
import os
import uuid
from pathlib import Path
from run_e2e import Session, REPO, E2E_ROOT, stage_extension, start_fixtures, remove_runtime_dir, check, sync_playwright
from run_i18n_e2e import geometry
from run_userscript_e2e import STUB, command, click_shadow

OUT=Path(os.environ.get('DUALLENS_POLISH_ARTIFACTS',str(E2E_ROOT/'v1'/'polish')))
FEATURES=['floatBall','selection','hover','input','subtitles','comics']
GROUPS=['common','ai','enhance','sites','glossary','data','about']
metrics=[]

def shot(page,name):
    page.bring_to_front()
    result=geometry(page)
    check(result['page'] and not result['clipped'],f'{name}: {result}')
    page.screenshot(path=str(OUT/(name+'.png')),full_page='mobile' not in name)

def extension(pw,ext,base,locale):
    h=Session(pw,ext,base,'polish-'+locale,locale=locale)
    try:
        h.start();h.settings({'provider':{'active':'','chain':[]},'translation':{'mode':'mt+llm','mt':{'engine':'microsoft','fallback':True}},**{f:{'enabled':False} for f in FEATURES}})
        h.open('article.html?polish='+locale)
        popup=h.ctx.new_page();popup.set_viewport_size({'width':360,'height':600})
        popup.add_init_script('chrome.tabs.query=async()=>'+json.dumps([{'id':h.tab_id,'url':base+'/guide/intro'}])+';')
        popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
        popup.locator('#onboard-next').wait_for()
        for theme in ['light','dark']:
            popup.emulate_media(color_scheme=theme);shot(popup,f'{locale}-{theme}-onboarding')
            check(popup.locator('#onboard-next').bounding_box()['x']>180,'first Next must be on the right')
        for _ in range(3):popup.locator('#onboard-next').click()
        popup.locator('#toggle:not([disabled])').wait_for()
        for theme in ['light','dark']:
            popup.emulate_media(color_scheme=theme)
            height=popup.locator('.dl-popup').bounding_box()['height']
            check(height<=(580 if locale=='en-US' else 600),f'{locale} popup height {height}')
            metrics.append({'locale':locale,'theme':theme,'popupHeight':height})
            shot(popup,f'{locale}-{theme}-popup')
        options=h.ctx.new_page();options.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        options.locator('#translation-methods input').first.wait_for()
        check(options.locator('#translation-methods input').count()==3,'three primary translation methods required')
        options.locator('[name=translation-method][value=mt]').check()
        for _ in range(50):
            if h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.translation.mode")=='mt':break
            options.wait_for_timeout(50)
        else:raise AssertionError('method radio did not persist immediately')
        options.locator('[name=translation-method][value="mt+llm"]').check()
        initial_target=options.locator('#targetLang').input_value()
        options.select_option('#targetLang','ja')
        for _ in range(40):
            if options.locator('#style-preview').inner_text()=='図書館の静かな革命。':break
            options.wait_for_timeout(50)
        else:raise AssertionError('preview did not follow translation target')
        options.select_option('#targetLang',initial_target)
        options.locator('[href="#ai"]').click()
        check(options.locator('#provider-card').is_hidden(),'unused AI card must be hidden')
        check(options.locator('#provider-empty').is_visible(),'missing AI empty state')
        for theme in ['light','dark']:
            for width in [1100,375]:
                options.set_viewport_size({'width':width,'height':900});options.emulate_media(color_scheme=theme)
                for group in GROUPS:
                    options.locator(f'[href="#{group}"]').click()
                    check(options.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'{group} overflow at {width}')
                    if group in ['enhance','data','about']:check(options.locator('#status').inner_text()=='','stale autosave hint')
                    if group=='common':
                        check(all(row.bounding_box()['height']<150 for row in options.locator('#translation-methods label').all()),'translation methods have excessive height')
                    shot(options,f'{locale}-{theme}-{width}-settings-{group}')
        options.locator('[href="#sites"]').click();check(options.locator('#site-rule-editor').is_hidden(),'rule editor starts expanded')
        options.locator('#site-rule-new').click()
        options.locator('[data-group=sites] details').evaluate('(n)=>n.open=true')
        check(options.locator('[data-group=sites] button:visible').filter(has_text=('Save' if locale=='en-US' else '保存')).count()==1,'site rules show duplicate Save actions')
        options.locator('[data-group=sites] details').evaluate('(n)=>n.open=false')
        options.locator('#rule-match').fill('docs.example.com/guide/*');options.select_option('#rule-page','never')
        options.locator('#site-rule-add').click()
        options.locator('#site-rule-editor').wait_for(state='hidden')
        check('docs.example.com/guide/*' in options.locator('#site-rule-list').inner_text(),'saved rule missing')
        shot(options,f'{locale}-375-site-rule-saved')
        for preset in ['openrouter','ollama']:
            options.locator('[href="#ai"]').click();options.locator(f'[data-preset={preset}]').click()
            options.locator('#model').wait_for()
            check(options.locator('#provider-card').is_visible(),'chosen AI card hidden')
            check(options.locator('#key-row').is_hidden()==(preset=='ollama'),'local service key visibility')
            destination=options.locator('#ai-destination').inner_text()
            check('Microsoft' not in destination and '微软' not in destination,'AI destination includes unrelated machine translation')
            for theme in ['light','dark']:
                for width in [1100,375]:
                    options.set_viewport_size({'width':width,'height':900});options.emulate_media(color_scheme=theme)
                    shot(options,f'{locale}-{theme}-{width}-service-{preset}')
            options.locator('#cancel-ai').click()
        # All feature detail rows are part of the acceptance matrix, not only the fresh off state.
        h.settings({f:{'enabled':True} for f in FEATURES})
        options.reload();options.locator('[href="#enhance"]').click()
        for theme in ['light','dark']:
            for width in [1100,375]:
                options.set_viewport_size({'width':width,'height':900});options.emulate_media(color_scheme=theme)
                for feature in FEATURES:check(options.locator('#details-'+feature).is_visible(),'enabled details hidden: '+feature)
                shot(options,f'{locale}-{theme}-{width}-enhancements-all-on')
        for theme in ['light','dark']:
            popup.emulate_media(color_scheme=theme);popup.reload();popup.locator('#feature-comics:checked').wait_for()
            check(popup.locator('.dl-popup').bounding_box()['height']<=580,'all-on popup exceeds compact height')
            check(all(n.bounding_box()['height']<20 for n in popup.locator('.feature-row>span').all()),'desktop feature labels wrap')
            shot(popup,f'{locale}-{theme}-popup-all-on')
        h.settings({'siteRules':{'custom':[{'match':'127.0.0.1/guide/*','page':'never'}]}})
        popup.reload();popup.locator('#site-path').wait_for()
        check(popup.locator('.dl-popup').bounding_box()['height']<=600,'path hint exceeds 600px: '+str(popup.locator('.dl-popup').bounding_box()['height']))
        check(popup.locator('.path-row>span').inner_text()==('Only /guide/*' if locale=='en-US' else '仅 /guide/*'),'path scope must omit hostname and port')
        for theme in ['light','dark']:
            popup.emulate_media(color_scheme=theme);shot(popup,f'{locale}-{theme}-popup-path')
        # Service choice only appears with multiple configured AI services.
        sidebar=h.ctx.new_page();sidebar.set_viewport_size({'width':375,'height':900})
        sidebar.goto(f'chrome-extension://{h.ext_id}/sidepanel/index.html');sidebar.locator('.dl-text').wait_for()
        check(sidebar.locator('.service-choices').is_hidden(),'single-service sidebar is cluttered')
        for theme in ['light','dark']:
            sidebar.emulate_media(color_scheme=theme);shot(sidebar,f'{locale}-{theme}-sidebar-text')
            sidebar.locator('[data-tab=subtitles]').check();shot(sidebar,f'{locale}-{theme}-sidebar-subtitle-files');sidebar.locator('[data-tab=text]').check()
        choices=[{'id':name,'kind':'openai','name':'Fixture '+name,'baseUrl':'http://127.0.0.1:11434/v1','model':'fixture-model','maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':5000,'fallbackModels':[]} for name in ['A','B']]
        h.settings({'provider':{'active':'A','profiles':choices,'chain':[]},'translation':{'mode':'llm'}})
        sidebar.locator('.service-choices').wait_for();sidebar.locator('.service-choices>summary').click()
        sidebar.select_option('[name=text-profile]','B')
        check(sidebar.locator('[name=text-model]').input_value()=='fixture-model','sidebar service/model choice is not connected')
        check('Fixture B' in sidebar.locator('.engine-disclosure').inner_text(),'sidebar destination does not follow its selected service')
        for theme in ['light','dark']:
            sidebar.emulate_media(color_scheme=theme);shot(sidebar,f'{locale}-{theme}-sidebar-services')
        # Consent is a blocking dialog labelled by its message. Focus rests on the card itself, so Enter or Space
        # cannot consent until the user tabs to a button; no marker is inserted before consent.
        remote={'id':'remote','kind':'openai','name':'Fixture AI','baseUrl':'https://consent.duallens.invalid/v1','model':'test','maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':5000,'fallbackModels':[]}
        h.settings({'provider':{'active':'remote','chain':[],'profiles':[remote]},'translation':{'mode':'llm'},**{f:{'enabled':False} for f in FEATURES}})
        h.page.bring_to_front();original=h.page.locator('#p-plain').inner_html();h.command('toggle-page')
        cdp=h.ctx.new_cdp_session(h.page)
        for _ in range(80):
            tree=cdp.send('Accessibility.getFullAXTree')['nodes']
            if any(n.get('role',{}).get('value')=='dialog' for n in tree):break
            h.page.wait_for_timeout(50)
        else:raise AssertionError('consent is not a dialog')
        focused=lambda nodes:[n for n in nodes if any(p['name']=='focused' and p['value'].get('value') for p in n.get('properties',[]))]
        check(any(n.get('role',{}).get('value')=='dialog' for n in focused(tree)) and not any(n.get('role',{}).get('value')=='button' for n in focused(tree)),'consent card must hold focus, not a button')
        h.page.keyboard.press('Enter');h.page.keyboard.press('Space');h.page.wait_for_timeout(150)
        check(any(n.get('role',{}).get('value')=='dialog' for n in cdp.send('Accessibility.getFullAXTree')['nodes']),'Enter/Space on the card must not consent')
        h.page.keyboard.press('Tab')
        check(any(n.get('role',{}).get('value') in ('button','DisclosureTriangle') for n in focused(cdp.send('Accessibility.getFullAXTree')['nodes'])),'Tab does not reach a consent control')
        check(h.page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'progress before consent')
        for theme in ['light','dark']:
            h.page.emulate_media(color_scheme=theme);shot(h.page,f'{locale}-{theme}-confirmation')
        h.page.keyboard.press('Escape');h.page.wait_for_timeout(200)
        check(h.page.locator('#p-plain').inner_html()==original and h.page.locator('dl-t,dl-o,dl-w,dl-r').count()==0,'cancel consent changed page')
        # The popup's background-guard fallback must route Change service to the same AI group.
        popup.evaluate("""() => {window.polishOpened=[];chrome.tabs.create=async options=>polishOpened.push(options.url);
          chrome.tabs.sendMessage=async(id,msg)=>msg.type==='get-state'?{translated:false,done:0,pending:0,failed:0}:{ok:false,error:{code:'confirmation-required',destination:{id:'llm:https://consent.duallens.invalid',name:'Fixture AI',host:'consent.duallens.invalid'}}};} """)
        popup.locator('#toggle').click();popup.locator('.dl-confirmation').wait_for()
        popup.locator('.dl-confirmation .actions button:not(.primary)').click()
        check(popup.evaluate("polishOpened[0]?.endsWith('#ai')"),'popup consent did not open AI settings')
        print('PASS polish extension '+locale+': compact popup, seven groups, service states, all details, sidebar and blocking consent',flush=True)
    finally:h.close()

def mobile(pw,base,locale):
    browser=pw.chromium.launch(headless=True);ctx=browser.new_context(locale=locale,viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    try:
        ctx.add_init_script(STUB+'\n'+(REPO/'dist/duallens.user.js').read_text('utf-8'));page=ctx.new_page();page.goto(base+'/article.html?polish-mobile='+locale)
        page.wait_for_function("__platformFixture.hasCommand('DualLens')")
        command(page,'DualLens');page.wait_for_function("__platformFixture.elements('#onboard-skip').length>0");click_shadow(page,'#onboard-skip')
        page.wait_for_function("__platformFixture.elements('#target').length>0")
        for theme in ['light','dark']:
            page.emulate_media(color_scheme=theme)
            check(page.evaluate("()=>{const s=__platformFixture.elements('#target')[0],r=s.getBoundingClientRect();return r.width>200&&r.height>=44&&r.right<=375}"),'mobile language select clips its value')
            shot(page,f'{locale}-{theme}-375-mobile-popup')
        click_shadow(page,'#options');page.wait_for_function("__platformFixture.elements('[data-group=common]').some(n=>!n.hidden)")
        check(page.evaluate("__platformFixture.elements('.dl-media-tabs').length===0"),'duplicate legacy mobile tab bar')
        for theme in ['light','dark']:
            page.emulate_media(color_scheme=theme);shot(page,f'{locale}-{theme}-375-mobile-settings')
        page.keyboard.press('Escape')
        page.evaluate("__platformFixture.settings({selection:{enabled:true,showIcon:true}})")
        page.locator('#p-plain').scroll_into_view_if_needed()
        page.evaluate("()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#p-plain'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));}")
        page.wait_for_function("__platformFixture.elements('.icon.show').length===1");click_shadow(page,'.icon.show')
        page.wait_for_function("__platformFixture.elements('.dst').some(n=>n.textContent.includes('【译】'))")
        for theme in ['light','dark']:
            page.emulate_media(color_scheme=theme);shot(page,f'{locale}-{theme}-375-mobile-selection')
            click_shadow(page,'.card .tool[aria-expanded]');shot(page,f'{locale}-{theme}-375-mobile-selection-more')
            check(page.evaluate("__platformFixture.elements('.selection-menu')[0].getBoundingClientRect().width")<=200,'selection menu exceeds 200px')
            click_shadow(page,'.card .tool[aria-expanded]')
        print('PASS polish mobile '+locale+': full-width language and seven-group settings without legacy tabs',flush=True)
    finally:ctx.close();browser.close()

def main():
    OUT.mkdir(parents=True,exist_ok=True);run=E2E_ROOT/('run-polish-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
    ext,missing=stage_extension(run,REPO/'extension');check(not missing,'missing assets');server,base=start_fixtures()
    try:
        with sync_playwright() as pw:
            for locale in ['en-US','zh-CN']:extension(pw,ext,base,locale);mobile(pw,base,locale)
        (OUT/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),'utf-8')
        print('POLISH E2E: 4 passed, 0 failed',flush=True);return 0
    finally:server.shutdown();remove_runtime_dir(run)

if __name__=='__main__':raise SystemExit(main())

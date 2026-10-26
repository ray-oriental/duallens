"""Mock-only v1.1 UX flows and bilingual screenshots; profiles stay in the E2E cache."""
import json
import importlib.util
import os
import re
import sys
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from run_ui_v1_browser import e2e, MOCK, PROJECT


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


OUT = Path(os.environ.get('DUALLENS_UX_SHOTS', str(e2e.E2E_ROOT.parent / 'ux-shots')))


def wait_readback(page, predicate):
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if page.evaluate(predicate):return
        page.wait_for_timeout(50)
    raise AssertionError('storage readback timed out: '+predicate)


def popup_case(ctx, base, language, bound):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_viewport_size({'width': 360, 'height': 650})
    page.emulate_media(reduced_motion='reduce')
    init=MOCK + '\n' + f"uiData.settings={{version:3,uiLanguage:{json.dumps(language)}}};"
    init+=r"""(() => {
      chrome.commands.getAll=async()=>window.boundCommands;
      window.commandCalls=0;window.pdfCalls=0;
      const send=chrome.tabs.sendMessage;
      chrome.tabs.sendMessage=async(id,msg)=>{
        if(msg.type==='command'){commandCalls++;await new Promise(resolve=>window.finishCommand=resolve);if(window.commandFailure)return {ok:false,error:window.commandFailure};}
        return send(id,msg);
      };
      const runtime=chrome.runtime.sendMessage;
      chrome.runtime.sendMessage=async msg=>{
        if(msg.type==='pdf-status')return {ok:true,available:true};
        if(msg.type==='pdf-open'){pdfCalls++;await new Promise(resolve=>window.finishPDF=resolve);return {ok:true};}
        return runtime(msg);
      };
      if(sessionStorage.getItem('pdfCase')){
        uiData['ui.device']={onboarded:true,upgradeNoticeSeen:true,acked:[]};
        chrome.tabs.query=async()=>[{id:7,url:'https://example.com/test.pdf'}];
      }
    })();""" + f"window.boundCommands={json.dumps(bound)};"
    page.add_init_script(init)
    page.goto(base + '/extension/ui/popup.html')
    page.locator('#onboard-next').wait_for()
    for step in range(1, 4):
        page.screenshot(path=str(OUT / f'{language}-onboard-{step}.png'))
        if step == 3:
            tips = page.locator('.dl-tips').inner_text()
            assert ('Ctrl+Shift+Y' in tips) == bool(bound)
            assert 'Alt+A' not in tips
        page.click('#onboard-next')
    page.locator('#toggle:not([disabled])').wait_for()
    assert ('Ctrl+Shift+Y' in (page.locator('#toggle').get_attribute('title') or '')) == bool(bound)
    page.click('#toggle')
    assert page.locator('#toggle').is_disabled()
    assert page.locator('#toggle').get_attribute('aria-busy') == 'true'
    page.evaluate("document.querySelector('#toggle').click()")
    assert page.evaluate('commandCalls') == 1
    page.evaluate('finishCommand()')
    page.locator('#toggle').filter(has_text='Show original' if language=='en' else '显示原文').wait_for()
    assert re.match(r'\d\d:\d\d:\d\d · ', page.locator('#status').inner_text())
    page.select_option('#target', 'ja')
    page.locator('#status').filter(has_text='translated again' if language == 'en' else '重新翻译').wait_for()
    page.evaluate('allowPermission=true')
    page.select_option('#site-mode', 'always')
    page.locator('#site-path').wait_for()
    page.locator('#status').filter(has_text='applied' if language == 'en' else '即时生效').wait_for()
    page.screenshot(path=str(OUT / f'{language}-popup.png'))
    # Classified errors retain actions and refresh while retries share the async guard.
    page.evaluate("commandFailure={code:'network_error',message:'fixture server prose'}")
    page.click('#toggle');page.evaluate('finishCommand()')
    retry=page.locator('#status').get_by_role('button',name='Retry' if language=='en' else '重试',exact=True)
    retry.wait_for();revision=page.locator('#status').get_attribute('data-error-revision')
    assert 'fixture server prose' not in page.locator('#status').inner_text()
    before=page.evaluate('commandCalls');retry.click()
    page.evaluate("document.querySelector('#toggle').click()")
    assert page.evaluate('commandCalls')==before+1
    page.evaluate("commandFailure={status:401,service:'OpenAI'};finishCommand()")
    page.locator('#status').get_by_role('button',name='Open Settings' if language=='en' else '打开设置',exact=True).wait_for()
    assert page.locator('#status').get_attribute('data-error-revision')!=revision
    page.locator('#status').get_by_role('button',name='Details' if language=='en' else '详情',exact=True).click()
    assert page.locator('#status small').inner_text()=='OpenAI · HTTP 401'
    page.evaluate('commandFailure=null');page.click('#toggle');page.evaluate('finishCommand()')
    page.locator('#toggle:not([disabled])').wait_for()
    assert page.locator('#status button').count()==0
    assert page.locator('#toggle').evaluate('el=>document.activeElement===el')
    # A PDF tab uses the same guarded async button.
    page.evaluate("sessionStorage.setItem('pdfCase','true')")
    page.reload()
    page.locator('#pdf-open').wait_for()
    page.click('#pdf-open')
    assert page.locator('#pdf-open').is_disabled()
    page.evaluate("document.querySelector('#pdf-open').click()")
    assert page.evaluate('pdfCalls') == 1
    page.evaluate('finishPDF()')
    page.locator('#pdf-open:not([disabled])').wait_for()
    page.locator('#status').filter(has_text='PDF').wait_for()
    assert not errors, errors
    page.close()


def settings_case(h, language):
    h.settings({'uiLanguage': language})
    page = h.ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_viewport_size({'width': 1100, 'height': 900})
    page.emulate_media(reduced_motion='reduce')
    page.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
    page.locator('#uiLanguage').wait_for()
    for group in ['common', 'ai', 'enhance', 'sites', 'glossary', 'data', 'about']:
        page.click(f'nav a[href="#{group}"]')
        page.screenshot(path=str(OUT / f'{language}-settings-{group}.png'), full_page=True)
    page.click('nav a[href="#sites"]')
    page.click('#site-rule-new');page.fill('#rule-match', 'example.com/guide/*')
    page.select_option('#rule-page', 'never');page.click('#site-rule-add')
    page.locator('.rule-row').filter(has_text='example.com/guide/*').wait_for()
    page.locator('.rule-row button').first.click();page.fill('#rule-match', 'example.com/docs/*')
    page.click('#site-rule-add')
    page.locator('.rule-row').filter(has_text='example.com/docs/*').wait_for()
    assert page.locator('.rule-row').count()==1
    page.locator('.rule-row button').first.click();page.click('#site-rule-delete')
    page.locator('.rule-row').wait_for(state='detached')
    assert h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.siteRules.custom") == []
    page.click('nav a[href="#glossary"]')
    assert page.locator('#glossary-empty').is_visible()
    page.locator('#glossary-file').set_input_files({'name': 'terms.tsv', 'mimeType': 'text/plain', 'buffer': 'kernel\t内核\nAPI\t接口'.encode()})
    page.locator('#status').filter(has_text='2').wait_for()
    assert h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.glossary") == []
    assert page.locator('#glossary-empty').is_hidden()
    draft = page.locator('#glossary').input_value()
    page.locator('#glossary-file').set_input_files({'name': 'invalid.txt', 'mimeType': 'text/plain', 'buffer': b'invalid'})
    page.locator('#status.error').wait_for()
    assert page.locator('#glossary').input_value() == draft
    with page.expect_download() as download:
        page.click('#glossary-export')
    assert download.value.suggested_filename == 'duallens-glossary.tsv'
    assert Path(download.value.path()).read_text('utf-8') == draft
    page.click('#save-glossary')
    page.locator('#saved-toast.show').wait_for()
    assert len(h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.glossary")) == 2
    page.screenshot(path=str(OUT / f'{language}-glossary-saved.png'), full_page=True)
    # Model overrides are ordinary immediate settings; the image-site list has an explicit save.
    page.click('nav a[href="#enhance"]')
    page.locator('#hoverEnabled').check()
    page.locator('#details-hover').wait_for(state='visible')
    page.fill('#hoverModel','fixture-model');page.locator('#hoverModel').press('Tab')
    wait_readback(page,"async()=> (await chrome.storage.local.get('settings')).settings.hover.model==='fixture-model'")
    assert h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.hover.model")=='fixture-model'
    # Ordinary input options save on change/blur in both UI languages, without
    # using the AI-service submit button. Wait for each persisted change.
    page.locator('#inputEnabled').check()
    page.locator('#details-input').wait_for(state='visible')
    for field, value, path in [
        ('inputMode', 'bilingual', 'input.mode'),
        ('inputOrder', 'translation-first', 'input.order'),
        ('inputProfile', 'mock', 'input.profileId'),
    ]:
        page.select_option('#'+field, value)
        wait_readback(page,f"async()=> (await chrome.storage.local.get('settings')).settings.{path}==={json.dumps(value)}")
    page.fill('#inputModel','fixture-input');page.locator('#inputModel').press('Tab')
    wait_readback(page,"async()=> (await chrome.storage.local.get('settings')).settings.input.model==='fixture-input'")
    page.locator('#comicsEnabled').check();page.locator('#details-comics').wait_for(state='visible');page.fill('#comicsSites','example.com')
    page.click('#save-enhance');wait_readback(page,"async()=> (await chrome.storage.local.get('settings')).settings.comics.canvasSites[0]==='example.com'")
    assert h.sw_eval("async()=> (await chrome.storage.local.get('settings')).settings.comics.canvasSites")==['example.com']
    # Leave the next locale a fresh glossary.
    h.settings({'glossary': []})
    assert not errors, errors
    page.close()


def tools_and_mobile_case(h, pw, base, language):
    # Sidebar and PDF are inspected without changing their implementations.
    h.settings({'uiLanguage':language,'hover':{'enabled':False},'comics':{'enabled':False}})
    for name, path in [('sidebar','sidepanel/index.html'),('pdf','pdf/viewer.html')]:
        page=h.ctx.new_page();page.set_viewport_size({'width':420 if name=='sidebar' else 1100,'height':850})
        page.goto(f'chrome-extension://{h.ext_id}/{path}')
        page.locator('textarea' if name=='sidebar' else '#status').wait_for(state='attached')
        if name=='pdf':
            spec=importlib.util.spec_from_file_location('ux_pdf_fixture',PROJECT/'tests/fixtures/generate_pdf.py')
            fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
            page.locator('#local-file').set_input_files({'name':'fixture.pdf','mimeType':'application/pdf','buffer':fixture.make_pdf(pages=1)})
            page.locator('.pdf-page[data-rendered=true]').first.wait_for()
        page.screenshot(path=str(OUT/f'{language}-{name}.png'),full_page=True);page.close()
    browser=pw.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':375,'height':812},has_touch=True,is_mobile=True,reduced_motion='reduce')
    try:
        page=ctx.new_page()
        page.add_init_script(MOCK+f"uiData.settings={{version:3,uiLanguage:{json.dumps(language)}}};"+r"""
          window.uiRoots=[];const original=Element.prototype.attachShadow;
          Element.prototype.attachShadow=function(options){const root=original.call(this,options);uiRoots.push(root);return root;};
        """)
        page.goto(base+'/tests/dom/form-fixture.html')
        page.evaluate(r"""async()=>{
          const {createSettingsStore}=await import('/extension/shared/settings.js');
          const {mountSettingsForm}=await import('/extension/ui/forms/index.js');
          const {createPopupPanel,createSettingsPanel}=await import('/extension/userscript/panel.js');
          uiData['ui.device']={onboarded:true,acked:[],upgradeNoticeSeen:true};
          const area=chrome.storage.local,store=createSettingsStore({localArea:area,syncArea:area});
          const save=store.save;store.save=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,80));return save(...args);};
          const platform={kind:'userscript',coarse:true,localArea:area,settingsStore:store,
            openSettings(){window.settingsPanel=createSettingsPanel({store,platform,mountForm:mountSettingsForm});void settingsPanel.open();}};
          window.mobilePanel=createPopupPanel({store,platform,loadSettingsForm:async()=>mountSettingsForm,pageMessage:async()=>uiState});
          await mobilePanel.open();
        }""")
        page.screenshot(path=str(OUT/f'{language}-mobile-popup.png'))
        page.evaluate("uiRoots.find(r=>r.querySelector('#options')).querySelector('#options').click()")
        page.wait_for_function("()=>uiRoots.some(r=>r.querySelector('.dl-settings'))")
        page.screenshot(path=str(OUT/f'{language}-mobile-settings.png'))
        page.evaluate("uiRoots.find(r=>r.querySelector('.dl-settings')).querySelector('nav a').focus()")
        page.keyboard.press('Tab')
        assert page.evaluate("uiRoots.find(r=>r.querySelector('.dl-settings')).activeElement.getAttribute('href')")=='#ai'
        page.wait_for_function("()=>uiRoots.some(r=>r.querySelector('#save')?.disabled===false)")
        # Overlapping immediate writes must settle before Escape, without creating
        # a draft-discard prompt. Delayed storage makes the overlap deterministic.
        page.evaluate(r"""()=>{const r=uiRoots.find(r=>r.querySelector('.dl-settings'));r.querySelector('a[href="#enhance"]').click();
          const enabled=r.querySelector('#hoverEnabled');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));
          for(const value of ['pending-first','pending-last']){const n=r.querySelector('#hoverModel');n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}}""")
        page.keyboard.press('Escape')
        page.wait_for_function("()=>!document.querySelector('dl-ui')")
        assert page.evaluate("uiData.settings.hover.model==='pending-last'&&uiData.settings.hover.enabled===true")
        page.evaluate("async()=>{await settingsPanel.open();}")
        page.wait_for_function("()=>uiRoots.some(r=>r.querySelector('#save')?.disabled===false)")
        page.evaluate(r"""()=>{const r=uiRoots.find(r=>r.querySelector('.dl-settings'));r.querySelector('a[href="#glossary"]').click();const n=r.querySelector('#glossary');n.value='kernel → 内核';n.dispatchEvent(new Event('input',{bubbles:true}));}""")
        page.evaluate(r"""()=>{const n=uiRoots.find(r=>r.querySelector('.dl-settings')).querySelector('#hoverModel');n.value='saved-with-draft';n.dispatchEvent(new Event('change',{bubbles:true}));}""")
        page.keyboard.press('Escape');page.wait_for_function("()=>uiRoots.some(r=>r.querySelector('.confirmation'))")
        assert page.evaluate("uiData.settings.hover.model==='saved-with-draft'")
        page.keyboard.press('Escape');page.wait_for_function("()=>!uiRoots.some(r=>r.querySelector('.confirmation'))")
        assert page.evaluate("uiRoots.some(r=>r.querySelector('#glossary')?.value==='kernel → 内核')")
        page.keyboard.press('Escape');page.wait_for_function("()=>uiRoots.some(r=>r.querySelector('.confirmation'))")
        page.evaluate("uiRoots.find(r=>r.querySelector('.confirmation')).querySelector('.confirmation button:last-child').click()")
        page.wait_for_function("()=>!document.querySelector('dl-ui')")
    finally:
        ctx.close();browser.close()
    component_shots(pw,base,language)


def component_shots(pw,base,language):
    # These are mock component states for visual review, not provider/OCR acceptance.
    browser=pw.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':1100,'height':780},reduced_motion='reduce')
    try:
        page=ctx.new_page();page.goto(base+'/tests/dom/form-fixture.html')
        page.evaluate(r"""async language=>{
          const {setUiLanguage}=await import('/extension/shared/i18n.js');setUiLanguage(language);
          const {DEFAULT_SETTINGS}=await import('/extension/shared/settings.js');window.captureSettings=structuredClone(DEFAULT_SETTINGS);
          document.body.style.cssText='margin:32px;font:16px system-ui';window.captureRoot=document.querySelector('#form-root');
          captureRoot.style.maxWidth='800px';
          const field=document.createElement('textarea');field.id='capture-input';field.value='Hello, world.';field.style.cssText='width:100%;height:120px';captureRoot.append(field);field.focus();
          const {InputBox}=await import('/extension/content/inputbox.js');captureSettings.input.enabled=true;captureSettings.input.mode='bilingual';
          window.captureInput=new InputBox({getSettings:()=>captureSettings,platform:{settingsStore:{save:async()=>{}},translator:()=>({translateText:()=>new Promise(resolve=>window.finishInput=resolve)})}});
          window.pendingInput=captureInput.run(field,true);
        }""",language)
        page.screenshot(path=str(OUT/f'{language}-input-pending.png'))
        page.evaluate("async()=>{finishInput({ok:true,text:'你好，世界。'});await pendingInput;captureInput.disable();}")
        page.screenshot(path=str(OUT/f'{language}-input-bilingual.png'))
        page.evaluate(r"""async()=>{
          captureRoot.replaceChildren();const p=document.createElement('p');p.id='capture-hover';p.textContent='A short paragraph for an explicit hover gesture.';captureRoot.append(p);
          const {HoverTranslate}=await import('/extension/content/hover.js');captureSettings.hover.enabled=true;
          window.captureHover=new HoverTranslate({getSettings:()=>captureSettings,platform:{settingsStore:{save:async()=>{}}},controller:{hoverToggle(){}}});captureHover.enable();
        }""")
        page.locator('#capture-hover').hover();page.keyboard.down('Shift');page.wait_for_timeout(180)
        page.screenshot(path=str(OUT/f'{language}-hover.png'))
        page.keyboard.up('Shift');page.evaluate('captureHover.disable()')
        page.evaluate(r"""async()=>{
          captureRoot.replaceChildren();const image=document.createElement('img');image.src='/tests/fixtures/comics/eng.png';image.style.width='240px';captureRoot.append(image);
          const {createPanel}=await import('/extension/content/comics/panel.js');
          window.captureComics=createPanel({element:image},{lang:'eng',onRun(){},onClose(){},onLanguages:async()=>({ok:true,languages:[]})});
          const regions=[{text:'HELLO WORLD',bbox:{x0:0,y0:0,x1:1,y1:1}}];captureComics.render(regions,false);regions[0].show('你好，世界。',false);
        }""")
        page.locator('img').wait_for();page.screenshot(path=str(OUT/f'{language}-image-text.png'))
        page.evaluate(r"""async()=>{
          captureComics.destroy();captureRoot.replaceChildren();const player=document.createElement('div');player.style.cssText='position:relative;height:360px;background:#1b1b1d';captureRoot.append(player);
          const {SubtitleOverlay}=await import('/extension/content/subtitles/overlay.js');window.captureSubtitles=new SubtitleOverlay(player);
          captureSubtitles.render({text:'A quiet place to read.',translation:'安静的阅读空间。'},{mode:'bilingual',fontSize:22});
        }""")
        page.screenshot(path=str(OUT/f'{language}-video-subtitles.png'))
    finally:
        ctx.close();browser.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    run = e2e.E2E_ROOT / ('run-ux-' + uuid.uuid4().hex[:8]);run.mkdir(parents=True)
    ext, missing = e2e.stage_extension(run, PROJECT / 'extension');assert not missing
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(PROJECT)))
    Thread(target=server.serve_forever, daemon=True).start();base = f'http://127.0.0.1:{server.server_port}'
    passed = 0
    try:
        with e2e.sync_playwright() as pw:
            h = e2e.Session(pw, ext, base, 'ux')
            h.start()
            h.sw_eval('async()=>{await chrome.storage.local.clear();await chrome.storage.sync.clear()}')
            try:
                for language in ['zh-CN', 'en']:
                    popup_case(h.ctx, base, language, [{'name': 'toggle-page', 'shortcut': 'Ctrl+Shift+Y'}] if language == 'en' else [])
                    passed += 1;print('PASS ux popup ' + language + ': actual shortcuts, onboarding, guarded translate/PDF, rule and target feedback', flush=True)
                    settings_case(h, language)
                    passed += 1;print('PASS ux settings ' + language + ': rename/delete readback, glossary draft validation/export/save, seven screenshots', flush=True)
                    tools_and_mobile_case(h,pw,base,language)
                    passed += 1;print('PASS ux tools/mobile ' + language + ': sidebar/PDF read-only shots, mobile sheets, Tab navigation, nested Escape and draft retention',flush=True)
            finally:
                h.close()
    finally:
        server.shutdown();server.server_close();e2e.remove_runtime_dir(run)
        print(f'SUMMARY ux-browser total=6 PASS={passed} FAIL={6-passed} mock-only', flush=True)
        print('ARTIFACTS ' + str(OUT), flush=True)
    return int(passed != 6)


if __name__ == '__main__':
    sys.exit(main())

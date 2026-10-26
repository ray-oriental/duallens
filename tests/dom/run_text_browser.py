"""Bilingual mock-only text translation flows, cancellation and visual evidence."""
import json
import re
import sys
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from run_ux_browser import e2e, PROJECT, OUT, QuietHandler

SETUP=r"""async language=>{
  const {DEFAULT_SETTINGS}=await import('/extension/shared/settings.js');
  const {mountTextForm}=await import('/extension/sidepanel/text-form.js');
  const {t}=await import('/extension/shared/i18n.js');
  const settings=structuredClone(DEFAULT_SETTINGS);settings.uiLanguage=language;settings.targetLang='ja';settings.sourceLang='auto';settings.provider.active='mock';settings.translation.mode='llm';
  const listeners=new Set(),calls=[],copies=[],detections=[],animations=[],roots=[],groups=[];
  const animate=Element.prototype.animate;Element.prototype.animate=function(...args){animations.push(this.id);return animate.apply(this,args);};
  const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
  window.textFixture={settings,calls,copies,detections,animations,roots,groups,t,language:{lang:'en-US',reliable:true},deferDetection:false};
  const area={async get(){return{};},async set(){}};
  const store={async load(){return structuredClone(settings);},onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const service={translateText(req){return new Promise((resolve,reject)=>calls.push({req,resolve,reject}));},async listModels(){return{ok:true,models:[]};}};
  const platform={kind:'extension',settingsStore:store,localArea:area,translator:()=>service,openSettings:group=>groups.push(group),
    detectLanguage(text){return new Promise(resolve=>{detections.push({text,resolve});if(!textFixture.deferDetection)resolve(textFixture.language);});}};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){return new Promise((resolve,reject)=>copies.push({text,resolve,reject}));}}});
  textFixture.platform=platform;textFixture.reload=async patch=>{Object.assign(settings,patch);for(const fn of listeners)fn();};
  textFixture.view=await mountTextForm(document.querySelector('#form-root'),{platform});
}"""


def shot(page,language,name):
    page.screenshot(path=str(OUT/f'{language}-sidebar-{name}.png'),full_page=True)


def run(pw,base,language):
    profile=e2e.E2E_ROOT/('profile-text-'+uuid.uuid4().hex[:8])
    ctx=pw.chromium.launch_persistent_context(str(profile),headless=True,viewport={'width':420,'height':1000},reduced_motion='no-preference')
    errors=[];passed=0
    try:
        ctx.route('https://**/*',lambda route:route.abort())
        page=ctx.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/tests/dom/form-fixture.html');page.evaluate(SETUP,language)
        source=page.locator('[name=text-from]');target=page.locator('[name=text-to]');field=page.locator('[name=text-input]')
        submit=page.locator('.dl-text button[type=submit]');swap=page.locator('[name=text-swap]');clear=page.locator('[name=text-clear]')
        copy=page.locator('[name=text-copy]');output=page.locator('output');status=page.locator('.text-status')
        assert target.input_value()=='ja' and source.input_value()=='auto'
        assert submit.is_disabled() and swap.is_disabled() and clear.is_disabled()
        assert page.evaluate("()=>!document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
        assert page.locator('#text-swap-hint').is_visible();shot(page,language,'empty')
        source.select_option('en');assert swap.is_enabled();swap.click()
        assert source.input_value()=='ja' and target.input_value()=='en'
        source.select_option('auto');target.select_option('zh-CN');field.fill('Hello <b>plain</b>.')
        assert swap.is_disabled();passed+=1
        submit.click();page.wait_for_function('()=>textFixture.calls.length===1')
        assert submit.is_disabled() and submit.get_attribute('aria-busy')=='true'
        assert submit.inner_text()==page.evaluate("textFixture.t('m4x')")
        assert swap.is_enabled() and 'English' in page.locator('#text-swap-hint').inner_text()
        page.evaluate("document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}))")
        assert page.evaluate('textFixture.calls.length')==1;shot(page,language,'working')
        field.focus();page.keyboard.press('Escape');submit.wait_for(state='visible')
        page.wait_for_function("()=>!document.querySelector('button[type=submit]').disabled")
        assert status.inner_text().endswith(page.evaluate("textFixture.t('uxTextCancelled')"))
        assert page.locator('form').is_visible();shot(page,language,'cancelled')
        submit.click();page.wait_for_function('()=>textFixture.calls.length===2')
        page.evaluate("textFixture.calls[0].resolve({ok:true,text:'late old result'})")
        page.wait_for_timeout(40);assert output.inner_text()==''
        page.evaluate("textFixture.calls[1].resolve({ok:true,text:'<b>安全文本</b>'})")
        output.filter(has_text='安全文本').wait_for();assert output.locator('b').count()==0
        assert re.match(r'\d\d:\d\d:\d\d · ',status.inner_text())
        assert status.get_attribute('aria-live')=='polite' and status.get_attribute('aria-atomic')=='true'
        assert page.evaluate("textFixture.animations.includes('status')")
        assert page.evaluate('textFixture.detections.length')==1;passed+=1
        page.emulate_media(reduced_motion='reduce');animations=page.evaluate('textFixture.animations.length')
        copy.click();assert copy.is_disabled() and copy.get_attribute('aria-busy')=='true'
        assert copy.inner_text()==page.evaluate("textFixture.t('actionWorking')")
        page.evaluate("document.querySelector('[name=text-copy]').click()")
        assert page.evaluate('textFixture.copies.length')==1
        page.evaluate('textFixture.copies[0].resolve()')
        status.filter(has_text='已复制' if language=='zh-CN' else 'Copied').wait_for()
        assert page.evaluate('textFixture.copies[0].text')==output.inner_text()
        assert page.evaluate('textFixture.animations.length')==animations;shot(page,language,'complete')
        copy.click();page.evaluate("textFixture.copies[1].reject(Error('fixture clipboard denied'))")
        status.filter(has_text=page.evaluate("textFixture.t('mak')")).wait_for()
        assert status.get_attribute('class')=='text-status error';passed+=1
        translated=output.inner_text();count=page.evaluate('textFixture.calls.length');swap.click()
        assert source.input_value()=='zh-CN' and target.input_value()=='en'
        assert field.input_value()==translated and output.inner_text()=='' and copy.is_disabled()
        assert page.evaluate('textFixture.calls.length')==count
        clear.click();assert field.input_value()=='' and output.inner_text()==''
        assert source.input_value()=='zh-CN' and target.input_value()=='en' and submit.is_disabled()
        source.select_option('auto');assert swap.is_disabled();shot(page,language,'cleared');passed+=1
        # A cancelled detection must neither enable swapping nor launch translation for edited text.
        page.evaluate('textFixture.deferDetection=true');field.fill('old source');submit.click()
        page.wait_for_function('()=>textFixture.detections.length===2');field.fill('new source')
        page.evaluate("textFixture.detections[1].resolve({lang:'fr',reliable:true})")
        page.wait_for_timeout(40);assert swap.is_disabled() and page.evaluate('textFixture.calls.length')==count
        page.evaluate("textFixture.deferDetection=false;textFixture.language={lang:'en',reliable:false}")
        submit.click();page.wait_for_function('()=>textFixture.calls.length===3')
        page.evaluate("textFixture.calls[2].resolve({ok:false,error:{code:'network_error',message:'fixture provider message'}})")
        status.filter(has_text=page.evaluate("textFixture.t('errNetwork')")).wait_for();assert swap.is_disabled()
        assert 'fixture provider message' not in status.inner_text()
        revision=status.get_attribute('data-error-revision')
        status.get_by_role('button',name=page.evaluate("textFixture.t('errRetry')"),exact=True).click()
        page.wait_for_function('()=>textFixture.calls.length===4')
        assert submit.is_disabled() and submit.get_attribute('aria-busy')=='true'
        page.evaluate("textFixture.calls[3].reject(Object.assign(Error('fixture exception'),{status:401,service:'OpenAI'}))")
        status.filter(has_text=page.evaluate("textFixture.t('errAuth')")).wait_for()
        assert status.get_attribute('data-error-revision')!=revision
        status.get_by_role('button',name=page.evaluate("textFixture.t('errDetails')"),exact=True).click()
        assert status.locator('small').inner_text()=='OpenAI · HTTP 401'
        status.get_by_role('button',name=page.evaluate("textFixture.t('errSettings')"),exact=True).click()
        assert page.evaluate('textFixture.groups')==['ai'];passed+=1
        # Locale changes retain an in-flight input; labels restore in the current locale.
        submit.click();page.wait_for_function('()=>textFixture.calls.length===5')
        other='en' if language=='zh-CN' else 'zh-CN'
        page.evaluate('language=>textFixture.reload({uiLanguage:language})',other)
        assert field.input_value()=='new source'
        page.evaluate("textFixture.calls[4].resolve({ok:true,text:'current result'})")
        output.filter(has_text='current result').wait_for()
        page.wait_for_function("()=>document.querySelector('button[type=submit]').textContent===textFixture.t('m6v')")
        copy.click();clear.click();page.evaluate('textFixture.copies[2].resolve()')
        page.wait_for_function("()=>document.querySelector('[name=text-copy]').disabled")
        assert status.inner_text().endswith(page.evaluate("textFixture.t('uxTextCleared')"))
        page.evaluate('language=>textFixture.reload({uiLanguage:language})',language)
        # Cancel the consent card before it can dispatch to the mocked remote service.
        page.evaluate(r"""async()=>{const s=textFixture.settings;s.provider.active='openai';s.provider.profiles.find(p=>p.id==='openai').baseUrl='https://example.com/v1';s.provider.profiles.find(p=>p.id==='openai').model='fixture';await textFixture.reload({});}""")
        field.fill('Consent fixture');submit.click();page.locator('.dl-confirmation').wait_for()
        count=page.evaluate('textFixture.calls.length');page.keyboard.press('Escape')
        page.locator('.dl-confirmation').wait_for(state='detached')
        assert page.locator('form').is_visible() and page.evaluate('textFixture.calls.length')==count;passed+=1
        # In the userscript tool, the same Escape cancels before the outer panel can close.
        page.evaluate(r"""async()=>{
          textFixture.view.destroy();textFixture.settings.provider.active='mock';textFixture.platform.kind='userscript';
          const {createSettingsPanel}=await import('/extension/userscript/panel.js');
          const {mountMediaTabs}=await import('/extension/sidepanel/media-tabs.js');
          textFixture.panel=createSettingsPanel({store:textFixture.platform.settingsStore,platform:textFixture.platform,mountForm:mountMediaTabs});await textFixture.panel.open();
          const root=textFixture.roots.find(r=>r.querySelector('.panel')?.isConnected);textFixture.mobileRoot=root;
          const n=root.querySelector('[name=text-input]');n.value='mobile pending';n.dispatchEvent(new Event('input'));root.querySelector('form').requestSubmit();
        }""")
        page.wait_for_function('count=>textFixture.calls.length===count+1',arg=count)
        page.keyboard.press('Escape')
        page.wait_for_function("()=>!textFixture.mobileRoot.querySelector('form').hasAttribute('aria-busy')")
        assert page.locator('dl-ui').count()==1
        page.evaluate("async()=>{textFixture.settings.provider.active='openai';await textFixture.reload({});}")
        page.evaluate("textFixture.mobileRoot.querySelector('form').requestSubmit()")
        page.wait_for_function("()=>textFixture.mobileRoot.querySelector('.dl-confirmation')")
        page.keyboard.press('Tab')
        assert page.evaluate("!!textFixture.mobileRoot.activeElement.closest('.dl-confirmation')")
        count=page.evaluate('textFixture.calls.length');page.keyboard.press('Escape')
        page.wait_for_function("()=>!textFixture.mobileRoot.querySelector('.dl-confirmation')")
        assert page.locator('dl-ui').count()==1 and page.evaluate('textFixture.calls.length')==count
        page.keyboard.press('Escape');page.locator('dl-ui').wait_for(state='detached')
        assert not errors,errors;passed+=1
        print(f'PASS text {language}: empty/swap, async guards, detection, cancel/stale, clipboard, consent, locale and mobile Escape',flush=True)
    finally:
        ctx.close();e2e.remove_runtime_dir(profile)
    return passed


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    e2e.E2E_ROOT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(PROJECT)))
    Thread(target=server.serve_forever,daemon=True).start();passed=0
    try:
        with e2e.sync_playwright() as pw:
            for language in ['zh-CN','en']:passed+=run(pw,f'http://127.0.0.1:{server.server_port}',language)
    finally:
        server.shutdown();server.server_close()
        print(f'SUMMARY text-browser total=14 PASS={passed} FAIL={14-passed} mock-only',flush=True)
        print('ARTIFACTS '+str(OUT),flush=True)
    return int(passed!=14)


if __name__=='__main__':sys.exit(main())

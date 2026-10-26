"""Offline error actions using the real controller/renderer with injected transports."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from run_e2e import REPO, sync_playwright


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(REPO)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    passed = 0
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                for language in ['zh-CN', 'en']:
                    page = browser.new_page(reduced_motion='reduce')
                    page.add_init_script("""window.roots=[];const attach=Element.prototype.attachShadow;
                    Element.prototype.attachShadow=function(o){const r=attach.call(this,o);if(this.localName==='dl-ui')roots.push(r);return r;};
                    window.nodes=s=>roots.filter(r=>r.host.isConnected).flatMap(r=>[...r.querySelectorAll(s)]);
                    const later=window.setTimeout,clear=window.clearTimeout;let seq=0;const timers=new Map();
                    window.setTimeout=(fn,ms,...args)=>ms>=16000&&ms<=120000?(timers.set(--seq,()=>fn(...args)),seq):later(fn,ms,...args);
                    window.clearTimeout=id=>{timers.delete(id);clear(id);};
                    window.retryClock=()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());};""")
                    page.goto(base + '/tests/fixtures/article.html')
                    page.evaluate("""async language=>{
                      const {setUiLanguage,t}=await import('/extension/shared/i18n.js');setUiLanguage(language);window.copy=t;
                      const {errorToast,clearToast}=await import('/extension/content/overlay.js');window.notify=errorToast;window.clearNotice=clearToast;
                      window.retries=0;window.groups=[];
                      errorToast({code:'network_error'},{retry:()=>retries++});
                    }""", language)
                    page.wait_for_function("nodes('.toast button').some(n=>n.textContent===copy('errRetry'))")
                    revision = page.evaluate("nodes('.toast')[0].dataset.errorRevision")
                    text = page.evaluate("nodes('.toast')[0].textContent")
                    page.evaluate("notify({code:'network_error'},{retry:()=>retries++})")
                    assert page.evaluate("nodes('.toast')[0].dataset.errorRevision") != revision
                    assert page.evaluate("nodes('.toast')[0].textContent") != text
                    assert page.evaluate("nodes('.toast').length") == 1
                    page.evaluate("nodes('.toast button').find(n=>n.textContent===copy('errRetry')).click()")
                    assert page.evaluate('retries') == 1
                    page.evaluate("notify({status:401,service:'OpenAI'},{openSettings:g=>groups.push(g)})")
                    page.evaluate("nodes('.toast button').find(n=>n.textContent===copy('errSettings')).click()")
                    assert page.evaluate('groups') == ['ai']
                    page.evaluate("nodes('.toast button').find(n=>n.textContent===copy('errDetails')).click()")
                    assert page.evaluate("nodes('.toast small')[0].textContent") == 'OpenAI · HTTP 401'
                    assert page.evaluate("nodes('.toast small')[0].hidden") is False
                    page.evaluate("clearNotice()")
                    page.evaluate("""async()=>{
                      const {createFeedback}=await import('/extension/ui/forms/feedback.js');
                      const root=document.createElement('div'),status=document.createElement('span'),button=document.createElement('button'),nav=document.createElement('nav'),link=document.createElement('a');
                      status.id='status';button.id='storage-save';link.href='#data';link.onclick=e=>{e.preventDefault();groups.push('data');};nav.append(link);root.append(status,button,nav);document.body.append(root);
                      const feedback=createFeedback(root);await feedback.run(button,async()=>{throw new DOMException('Quota exceeded','QuotaExceededError');});
                      if(!status.textContent.includes(copy('errStorage')))throw Error('Missing storage recovery copy');
                      [...status.querySelectorAll('button')].find(b=>b.textContent===copy('errSettings')).click();feedback.destroy();root.remove();
                    }""")
                    assert page.evaluate('groups') == ['ai', 'data']
                    print(f'PASS errors {language}: retry/settings/details, single toast and repeated refresh', flush=True)
                    passed += 1

                    page.evaluate("""async()=>{
                      const {PageTranslator}=await import('/extension/content/controller.js');
                      const {DEFAULT_SETTINGS}=await import('/extension/shared/settings.js');
                      window.settings=structuredClone(DEFAULT_SETTINGS);settings.translation.mode='llm';settings.provider.active='mock';
                      window.calls=[];window.fail=true;window.failure={code:'config_error'};
                      const area={get:async()=>({}),set:async()=>{}};
                      const platform={kind:'userscript',localArea:area,openSettings:g=>groups.push(g),detectLanguage:async()=>null,
                        translator:()=>({translateBatch(req,receive){calls.push(req.items.map(i=>i.id));
                          const done=Promise.resolve().then(()=>receive(req.items.map(i=> fail && i.text.includes('Good translation tools') ?
                            {id:i.id,error:failure}:{id:i.id,text:'translated '+i.text})));
                          return {done,cancel(){}};}})};
                      window.errorPlatform=platform;window.controller=new PageTranslator({getSettings:()=>settings,platform});
                      window.original=document.querySelector('#p-plain').innerHTML;controller.start();
                    }""")
                    page.wait_for_function("controller.getState().failed===1 && nodes('.toast').length===1")
                    assert page.evaluate("nodes('.toast')[0].textContent.includes(copy('errPartial',[1]))")
                    assert page.evaluate("controller.getState().done") > 0
                    page.evaluate("nodes('.toast button').find(n=>n.textContent===copy('errSettings')).click()")
                    assert page.evaluate('groups') == ['ai', 'data', 'ai']
                    page.evaluate("window.before=calls.length;window.failedIds=[...controller.units.values()].filter(u=>u.state==='error').map(u=>u.id);fail=false;nodes('.toast button').find(n=>n.textContent===copy('errRetryPartial')).click()")
                    page.wait_for_function("controller.getState().failed===0")
                    assert page.evaluate("JSON.stringify(calls.slice(before).flat())===JSON.stringify(failedIds)")
                    page.evaluate('controller.stop()')
                    assert page.evaluate("document.querySelector('#p-plain').innerHTML===original")
                    assert page.evaluate("nodes('.toast').length") == 0
                    page.evaluate('controller.destroy()')
                    page.evaluate("""async()=>{
                      const {PageTranslator}=await import('/extension/content/controller.js');fail=true;errorPlatform.frameAgent=true;
                      window.controller=new PageTranslator({getSettings:()=>settings,platform:errorPlatform});controller.start();
                    }""")
                    page.wait_for_function("controller.getState().failed===1")
                    page.wait_for_timeout(300)
                    assert page.evaluate("nodes('.toast').length") == 0
                    page.evaluate('controller.destroy()')
                    page.evaluate("""async()=>{
                      const {InputBox}=await import('/extension/content/inputbox.js');
                      const input=document.createElement('textarea');input.value='Synthetic input text.';document.body.append(input);
                      const platform={translator:()=>({translateText:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))})};
                      const box=new InputBox({getSettings:()=>settings,platform});const done=box.run(input,true);box.disable();await done;input.remove();
                    }""")
                    assert page.evaluate("nodes('.toast').length") == 0
                    print(f'PASS errors {language}: partial count/retry only failed units, Settings group and exact restore', flush=True)
                    passed += 1

                    page.evaluate("""async()=>{
                      const {PageTranslator}=await import('/extension/content/controller.js');
                      window.beginRetry=()=>{fail=true;failure={code:'network_error'};errorPlatform.frameAgent=false;calls=[];
                        window.controller=new PageTranslator({getSettings:()=>settings,platform:errorPlatform});controller.start();};beginRetry();
                    }""")
                    page.wait_for_function("[...controller.units.values()].some(u=>u.autoRetry)")
                    page.wait_for_timeout(300)
                    assert page.evaluate("controller.getState().failed===0 && nodes('.toast').length===0")
                    page.evaluate('fail=false;retryClock()')
                    page.wait_for_function("[...controller.units.values()].some(u=>u.retryCount===1&&u.state==='done')")
                    assert page.evaluate("controller.getState().failed===0 && nodes('.toast').length===0")
                    page.evaluate('controller.destroy()')
                    print(f'PASS errors {language}: temporary failure automatically recovers without a toast', flush=True)
                    passed += 1

                    page.evaluate("beginRetry();failure={code:'rate_limited',status:429,retryAfterMs:60000}")
                    page.wait_for_function("[...controller.units.values()].some(u=>u.autoRetry)")
                    for attempt in [1, 2]:
                        page.evaluate('retryClock()')
                        page.wait_for_function("n=>[...controller.units.values()].some(u=>u.retryCount===n&&u.state==='error')", arg=attempt)
                    page.wait_for_function("controller.getState().failed===1 && nodes('.toast').length===1")
                    assert page.evaluate("nodes('.toast')[0].textContent.includes(copy('errPartial',[1]))")
                    assert page.evaluate("nodes('.toast')[0].textContent.includes(copy('errRateWait',[60]))")
                    page.evaluate("window.before=calls.length;fail=false;nodes('.toast button').find(n=>n.textContent===copy('errRetryPartial')).click()")
                    page.wait_for_function("controller.getState().failed===0 && [...controller.units.values()].every(u=>u.state!=='pending')")
                    assert page.evaluate('calls.length===before+1')
                    page.evaluate('controller.destroy()')
                    print(f'PASS errors {language}: two automatic retries exhaust, then manual partial retry succeeds', flush=True)
                    passed += 1

                    page.evaluate('beginRetry()')
                    page.wait_for_function("[...controller.units.values()].some(u=>u.autoRetry)")
                    page.evaluate("window.before=calls.length;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});fail=false;retryClock()")
                    page.wait_for_timeout(250)
                    assert page.evaluate('calls.length===before')
                    page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'))")
                    assert page.evaluate('calls.length===before')
                    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window.badUnit=[...controller.units.values()].find(u=>u.autoRetry);window.inView=controller.lazy.isVisible.bind(controller.lazy);controller.lazy.isVisible=()=>false;document.dispatchEvent(new Event('visibilitychange'))")
                    assert page.evaluate('calls.length===before')
                    page.evaluate("controller.lazy.isVisible=inView;window.dispatchEvent(new Event('scroll'))")
                    page.wait_for_function("badUnit.state==='done'")
                    assert page.evaluate("nodes('.toast').length===0")
                    page.evaluate("controller.destroy();beginRetry()")
                    page.wait_for_function("[...controller.units.values()].some(u=>u.autoRetry)")
                    page.evaluate('controller.destroy();window.before=calls.length;retryClock();window.dispatchEvent(new Event("online"))')
                    page.wait_for_timeout(250)
                    assert page.evaluate('calls.length===before')
                    print(f'PASS errors {language}: offline/hidden/offscreen waits, visibility resumes, stop cancels retries', flush=True)
                    passed += 1

                    page.evaluate("""async()=>{
                      const {mountPopup}=await import('/extension/ui/popup-view.js');
                      const localArea={get:async()=>({'ui.device':{onboarded:true,upgradeNoticeSeen:true,acked:[]}}),set:async()=>{},remove:async()=>{}};
                      const store={load:async()=>settings,onChange:()=>()=>{}};
                      window.popup=await mountPopup(document.body,{store,localArea,platform:{kind:'userscript',localArea},restricted:true,pageMessage:async()=>null});
                    }""")
                    assert page.locator('#page-status').inner_text().find(page.evaluate("copy('errRestricted')")) >= 0
                    page.evaluate("popup.destroy()")
                    page.evaluate("""async()=>{
                      const {mountPopup}=await import('/extension/ui/popup-view.js');
                      const localArea={get:async()=>({'ui.device':{onboarded:true,upgradeNoticeSeen:true,acked:[]}}),set:async()=>{},remove:async()=>{}};
                      window.popup=await mountPopup(document.body,{store:{load:async()=>settings,onChange:()=>()=>{}},localArea,
                        platform:{kind:'userscript',localArea},restricted:true,accessError:'permission_denied',pageMessage:async()=>null});
                    }""")
                    assert page.locator('#page-status').inner_text().find(page.evaluate("copy('errPermission')")) >= 0
                    assert page.locator('#toggle').is_disabled()
                    page.evaluate('popup.destroy()')
                    print(f'PASS errors {language}: popup distinguishes restricted page from denied access', flush=True)
                    passed += 1
                    page.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        print(f'SUMMARY errors total=12 PASS={passed} FAIL={12-passed} SKIP=0 mock-only', flush=True)
    return int(passed != 12)


if __name__ == '__main__':
    raise SystemExit(main())

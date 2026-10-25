"""Mock-only iframe/open-shadow regressions, using canonical staging and GM transport."""
import json
import subprocess
import uuid
import traceback
import time
import argparse
from playwright.sync_api import sync_playwright
import run_e2e as e
from run_userscript_e2e import STUB, command


def child(page, selector):
    return page.locator(selector).element_handle().content_frame()


def wait(frame, predicate):
    # Hidden frames do not paint; rAF polling would never observe their successful restore.
    frame.wait_for_function(predicate, polling=100, timeout=15000)


def translated(frame):
    wait(frame, "!!document.querySelector('dl-t[data-dl-state=done]')")
    assert frame.locator('dl-t').first.inner_text().startswith('【译】')
    assert frame.locator('dl-t dl-t').count() == 0


def exercise(page, toggle, mode, extension, idle_check=None, request_count=None):
    ids = ['mail', 'srcdoc', 'blank', 'cross', 'small', 'small-cross', 'hidden-cross']
    frames = {key: child(page, '#' + key) for key in ids}
    originals = {key: f.evaluate('document.body.outerHTML') for key, f in frames.items()}
    toggle()
    for key in ['mail', 'srcdoc', 'blank'] + (['cross'] if extension else []):
        try: translated(frames[key])
        except Exception as exc: raise AssertionError('initial translation failed: ' + key) from exc
    page.wait_for_timeout(800)
    for key in ['small', 'small-cross', 'hidden-cross'] + ([] if extension else ['cross']):
        assert frames[key].locator('dl-t').count() == 0, key + ' must be skipped'
    assert all(f.locator('dl-ui').count() == 0 for f in frames.values()), 'child frame created UI'
    if idle_check: idle_check()
    mode()
    for key in ['mail', 'srcdoc', 'blank'] + (['cross'] if extension else []):
        wait(frames[key], "!!document.querySelector('dl-o.dl-hide')")
        assert frames[key].locator('dl-o').first.evaluate('e=>getComputedStyle(e).display') == 'none'
    toggle()
    for key, f in frames.items():
        wait(f, "!document.querySelector('dl-t,dl-o,dl-w,dl-r')")
        assert f.evaluate('document.body.outerHTML') == originals[key], key + ' restore mismatch'
    for key in ['mail', 'srcdoc', 'blank']:
        assert frames[key].locator('style').count() == 0, key + ' leaked style'
    if idle_check: idle_check()
    mode()  # back to bilingual
    toggle(); translated(frames['mail'])
    page.evaluate('replaceMailLater()')
    wait(frames['mail'], "document.querySelector('#message')?.textContent.includes('second message')")
    translated(frames['mail'])
    wait(frames['mail'], "document.querySelector('#message')?.textContent.includes('second message') && document.querySelectorAll('dl-t').length===1 && !!document.querySelector('dl-t[data-dl-state=done]')")
    # document.write can emit a second lifecycle event after the first done node.
    # Require one terminal translation to remain stable across that event boundary.
    wait(frames['mail'], "() => {const ok=document.querySelector('#message')?.textContent.includes('second message')&&document.querySelectorAll('dl-t').length===1&&!!document.querySelector('dl-t[data-dl-state=done]');if(!ok){window.__frameStableSince=0;return false;}window.__frameStableSince||=performance.now();return performance.now()-window.__frameStableSince>400;}")
    assert frames['mail'].locator('dl-t').count() == 1, 'replaced document translated twice: '+frames['mail'].evaluate('document.body.outerHTML')
    if extension:
        frames['cross'].goto(frames['cross'].url + '?new-message=2')
        translated(frames['cross'])
        page.locator('#hidden-cross').evaluate("e=>e.style.display='block'")
        translated(frames['hidden-cross'])
        page.locator('#hidden-cross').evaluate("e=>e.style.display='none'")
        hidden=frames['hidden-cross']
        existing=hidden.locator('dl-t').count()
        requests=request_count()
        added=hidden.evaluate("""() => {const p=document.createElement('p');p.id='hidden-new';p.textContent='This new message must wait until the hidden frame becomes visible again.';document.body.append(p);return p.outerHTML;}""")
        originals['hidden-cross']=originals['hidden-cross'].replace('</body>',added+'</body>')
        page.wait_for_timeout(600)
        assert hidden.locator('dl-t').count()==existing, 'hiding removed existing translations or translated new text'
        assert request_count()==requests, 'hidden frame started a new translation request'
        mode()
        hidden.wait_for_function("!!document.querySelector('p.dl-only dl-o.dl-hide')",polling=50,timeout=1000)
        mode()
        hidden.wait_for_function("!document.querySelector('dl-o.dl-hide')",polling=50,timeout=1000)
        toggle()
        hidden.wait_for_function("!document.querySelector('dl-t,dl-o,dl-w,dl-r')",polling=50,timeout=1000)
        assert hidden.evaluate('document.body.outerHTML')==originals['hidden-cross'], 'top restore did not restore hidden frame exactly'
        toggle()
        page.wait_for_timeout(300)
        assert request_count()==requests, 'top activation translated a hidden frame'
        started=time.monotonic()
        page.locator('#hidden-cross').evaluate("e=>e.style.display='block'")
        hidden.wait_for_function("!!document.querySelector('#hidden-new dl-t')",polling=20,timeout=1000)
        resumed=time.monotonic()-started
        assert resumed<=1, f'visible frame took {resumed:.3f}s to resume'
        assert request_count()>requests, 'visible frame did not submit its queued translation'
        translated(hidden)
        page.locator('#hidden-cross').evaluate("e=>e.style.display='none'")
    # Late iframe insertion, visibility changes and document navigation are independent discoveries.
    page.evaluate("""() => {const f=document.createElement('iframe');f.id='late';f.srcdoc='<p>A newly inserted frame needs translation after the initial scan.</p>';document.querySelector('.frames').prepend(f);} """)
    late = child(page, '#late'); translated(late)
    toggle()
    for key, f in frames.items():
        wait(f, "!document.querySelector('dl-t,dl-o,dl-w,dl-r')")
        expected = page.evaluate('mailOriginal') if key == 'mail' else originals[key]
        assert f.evaluate('document.body.outerHTML') == expected, key + ' second restore mismatch'
    wait(late, "!document.querySelector('dl-t')")
    assert late.evaluate('document.body.outerHTML') == '<body><p>A newly inserted frame needs translation after the initial scan.</p></body>'
    page.evaluate("""() => {
      const f=document.createElement('iframe');f.id='lazy-frame';
      f.srcdoc='<style>p{height:120px;margin:0}</style>'+Array.from({length:40},(_,i)=>'<p id="line-'+i+'">The distant letter paragraph contains an independent explanation number '+i+'.</p>').join('');
      document.querySelector('.frames').prepend(f);
    }""")
    lazy=child(page,'#lazy-frame'); wait(lazy,"document.querySelectorAll('p').length===40")
    before=lazy.evaluate('document.body.outerHTML')
    toggle(); translated(lazy); page.wait_for_timeout(300)
    assert lazy.locator('dl-t').count()<10, 'frame scrolled offscreen paragraphs were eagerly translated'
    lazy.locator('#line-30').scroll_into_view_if_needed()
    wait(lazy,"!!document.querySelector('#line-30 dl-t[data-dl-state=done]')")
    toggle(); wait(lazy,"!document.querySelector('dl-t')")
    assert lazy.evaluate('document.body.outerHTML')==before, 'scrolled frame restore mismatch'
    return 'blank/srcdoc/dynamic roots, 1s mail rewrite, child mode/navigation/visibility, tiny exclusion, frame scroll laziness, no child UI, exact restore'


def shadow_exercise(page,toggle,mode):
    before=page.evaluate('document.body.outerHTML')
    ready="shadowRoots.every(r=>r.querySelector('p dl-t[data-dl-state=done]')) && document.querySelector('#projected dl-t[data-dl-state=done]')"
    toggle(); wait(page,ready)
    wait(page,"shadowRoots[0].querySelectorAll('dl-t[data-dl-state=done]').length>=2")
    assert page.locator('#projected dl-t').count()==1, 'slot source translated more than once'
    assert page.evaluate("!shadowRoots[0].querySelector('#fallback dl-t')"), 'assigned slot fallback was translated'
    assert page.evaluate('closedNotice.innerHTML===closedExpected'), 'closed shadow root was accessed'
    assert page.evaluate("""()=>{const c=document.createElement('canvas').getContext('2d');
      return shadowRoots.every(root=>{c.fillStyle=getComputedStyle(root.querySelector('p dl-t')).color;c.fillRect(0,0,1,1);
        const rgb=[...c.getImageData(0,0,1,1).data].slice(0,3);
        return rgb.every(v=>v>=199&&v<=205);});}"""), '78% white on #111 shadow background was not preserved'
    mode(); wait(page,"shadowRoots.every(r=>r.querySelector('p.dl-only'))")
    toggle(); wait(page,"shadowRoots.every((r,i)=>r.innerHTML===shadowExpected[i])")
    assert page.evaluate('document.body.outerHTML')==before, 'light DOM restore mismatch'
    mode(); toggle(); wait(page,ready)
    page.evaluate('addShadowLater()')
    wait(page,"shadowRoots.length===3 && shadowRoots[0].querySelector('#dynamic dl-t[data-dl-state=done]') && shadowRoots[2].querySelector('dl-t[data-dl-state=done]')")
    assert page.locator('#projected dl-t').count()==1
    toggle(); wait(page,"shadowRoots.every((r,i)=>r.innerHTML===shadowExpected[i])")
    assert page.evaluate('document.body.outerHTML')==before
    assert page.evaluate('closedNotice.innerHTML===closedExpected')
    return 'open/nested/direct shadow text, projected slot once, 1s dynamic paragraph/new component, exact shadow/light restore'


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--only',action='append',default=[]);args=parser.parse_args()
    first, base = e.start_fixtures(); second, remote = e.start_fixtures()
    remote = remote.replace('127.0.0.1', 'localhost')
    run = e.E2E_ROOT / ('run-frames-' + uuid.uuid4().hex[:8]); run.mkdir(parents=True)
    results = []
    def record(name,action):
        if args.only and name not in args.only:return
        try:
            detail=action();results.append({'name':name,'status':'PASS','detail':detail})
            print('PASS '+name+': '+detail,flush=True)
        except Exception as exc:
            traceback.print_exc(limit=5)
            results.append({'name':name,'status':'FAIL','detail':str(exc)})
            print('FAIL '+name+': '+str(exc),flush=True)
    try:
        ext, missing = e.stage_extension(run); e.check(not missing, str(missing))
        bundle = run / 'duallens.user.js'
        subprocess.run(['node', str(e.REPO / 'scripts/build_userscript.mjs'), '--output', str(bundle)], check=True)
        with sync_playwright() as pw:
            h = e.Session(pw, ext, base, 'frames')
            try:
                h.start()
                h.sw_eval("""() => {globalThis.frameMessages={};globalThis.frameTranslationCounts={};chrome.runtime.onConnect.addListener(port=>{
                  if(port.name==='dl-translate')port.onMessage.addListener(msg=>{if(msg.type==='translate')frameTranslationCounts[port.sender.frameId]=(frameTranslationCounts[port.sender.frameId]||0)+1;});
                });chrome.runtime.onMessage.addListener(msg=>{
                  if(msg.type==='frame-snapshot'||msg.type==='frame-publish')frameMessages[msg.type]=(frameMessages[msg.type]||0)+1;return false;
                });}""")
                # A child-origin never rule must not override top-page consent/state.
                h.settings({'siteRules':{'never':['localhost']}})
                def idle_check():
                    counts=h.sw_eval('() => frameMessages')
                    h.page.wait_for_timeout(5000)
                    assert h.sw_eval('() => frameMessages')==counts, 'frame snapshot/publish messages grew during 5s idle'
                def frame_case():
                    h.open('frames.html?remote='+remote+'&baseline=1')
                    frame_id=h.sw_eval("""async tabId => {const rows=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>window.name});return rows.find(r=>r.result==='visibility-fixture').frameId;}""",h.tab_id)
                    return exercise(h.page,lambda:h.command('toggle-page'),lambda:h.command('toggle-translation-only'),True,idle_check,
                        lambda:h.sw_eval('(id)=>frameTranslationCounts[id]||0',frame_id))
                def shadow_case():
                    h.open('shadow.html')
                    return shadow_exercise(h.page,lambda:h.command('toggle-page'),lambda:h.command('toggle-translation-only'))
                record('frames-extension',frame_case)
                record('shadow-extension',shadow_case)
                def consent_case():
                    h.settings({'translation':{'mode':'llm'},'provider':{'active':'consent','chain':[],
                        'profiles':[{'id':'consent','kind':'openai','baseUrl':'https://fixture.example/v1','model':'test'}]}})
                    h.sw_eval("""() => {globalThis.consentCalls=0;globalThis.fetch=async(url,opts)=>{
                      consentCalls++;const payload=JSON.parse(opts.body),user=payload.messages.find(m=>m.role==='user').content;
                      const input=JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1));
                      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({t:input.t.map(t=>'【译】'+t)})}}]}),{headers:{'Content-Type':'application/json'}});
                    };}""")
                    h.open('frames.html?remote='+remote+'&consent=1')
                    cross=child(h.page,'#cross');before=cross.evaluate('document.body.outerHTML')
                    h.sw_eval("""async id=>chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:()=>{
                      globalThis.lastFramePush=null;chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='frame-state')lastFramePush=msg.state;return false;});
                    }})""",h.tab_id)
                    h.sw_eval("""async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{
                      globalThis.consentRoots=[];const original=Element.prototype.attachShadow;
                      Element.prototype.attachShadow=function(init){const r=original.call(this,init);consentRoots.push(r);return r;};
                    }})""",h.tab_id)
                    def ui(action):
                        return h.sw_eval("""async ([id,action])=>(await chrome.scripting.executeScript({target:{tabId:id},args:[action],func:action=>{
                          const root=consentRoots.find(r=>r.host.isConnected&&r.querySelector('.confirm'));
                          if(action==='accept')root.querySelector('.primary').click();
                          return !!root;
                        }}))[0].result""",[h.tab_id,action])
                    h.command('toggle-page')
                    deadline=time.monotonic()+10
                    while not ui('check') and time.monotonic()<deadline:h.page.wait_for_timeout(50)
                    assert ui('check'),'top confirmation missing'
                    h.page.wait_for_timeout(500)
                    assert h.sw_eval('()=>consentCalls')==0,'sent before top consent'
                    assert cross.locator('dl-t,dl-ui').count()==0,'child translated or created consent UI'
                    h.command('toggle-page')
                    deadline=time.monotonic()+5
                    while ui('check') and time.monotonic()<deadline:h.page.wait_for_timeout(50)
                    assert not ui('check'),'restore left a pending top confirmation'
                    h.command('toggle-page')
                    deadline=time.monotonic()+5
                    while not ui('check') and time.monotonic()<deadline:h.page.wait_for_timeout(50)
                    ui('accept')
                    try:translated(cross)
                    except Exception:
                        print('CONSENT DIAGNOSTIC',h.msg({'type':'frame-top-state'}),
                            h.sw_eval('()=>({calls:consentCalls,counts:frameTranslationCounts})'),cross.evaluate('document.body.innerHTML'),
                            h.sw_eval("""async id=>chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:()=>({url:location.href,
                              push:globalThis.lastFramePush,ready:!!globalThis[Symbol.for('duallens.loader.ready')],
                              size:[innerWidth,innerHeight],hidden:document.hidden})})""",h.tab_id),flush=True)
                        raise
                    assert cross.locator('dl-ui').count()==0
                    h.command('toggle-page');wait(cross,"!document.querySelector('dl-t')")
                    assert cross.evaluate('document.body.outerHTML')==before
                    return 'remote destination: no sends/child UI before top consent; pushed acknowledgement starts child; exact restore'
                record('frames-top-consent',consent_case)
            finally: h.close()
            browser = pw.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport=e.VIEWPORT, locale="zh-CN")
                context.add_init_script(script=STUB); context.add_init_script(path=str(bundle))
                def userscript_case(path,shadow=False):
                    page=context.new_page()
                    try:
                        page.goto(base+'/'+path);wait(page,"__platformFixture.hasCommand('翻译此页 / 显示原文')")
                        toggle=lambda:command(page,'翻译此页 / 显示原文')
                        mode=lambda:command(page,'切换显示方式')
                        return shadow_exercise(page,toggle,mode) if shadow else exercise(page,toggle,mode,False)
                    finally: page.close()
                record('frames-userscript',lambda:userscript_case('frames.html?remote='+remote))
                record('shadow-userscript',lambda:userscript_case('shadow.html',True))
            finally: browser.close()
    finally:
        first.shutdown(); second.shutdown(); e.remove_runtime_dir(run)
    artifact = e.E2E_ROOT / 'artifacts' / 'frames'; artifact.mkdir(parents=True,exist_ok=True)
    (artifact / 'last-run.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    fails = sum(r['status']=='FAIL' for r in results)
    print(f'SUMMARY frames total={len(results)} PASS={len(results)-fails} FAIL={fails} SKIP=0')
    return int(bool(fails))


if __name__ == '__main__':
    raise SystemExit(main())

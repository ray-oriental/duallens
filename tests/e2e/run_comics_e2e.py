"""Comic acceptance cases using the canonical isolated Session and mock-only runner."""
import json
import os
import statistics
import difflib
from pathlib import Path
from http.server import ThreadingHTTPServer
from functools import partial
import threading
import sys
import time
import run_e2e as runner

REQUESTS=[]

def wait_csp_safe(h, expression, timeout=15):
    # Playwright 1.48's wait_for_function polls through eval on CSP-restricted pages.
    # Evaluate the predicate directly; keep the tested page's CSP unchanged.
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if h.js(expression): return
        h.page.wait_for_timeout(50)
    raise AssertionError('CSP-safe condition timed out: '+expression)

class Handler(runner._QuietHandler):
    def do_GET(self):
        if self.path=='/comics/referer.png':
            if self.headers.get('Referer')!=f'http://{self.headers["Host"]}/':
                self.send_response(403);self.end_headers();return
            data=(runner.FIXTURES/'comics/eng.png').read_bytes()
            self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(data);return
        if self.path.startswith('/comics-runtime/'):
            name=self.path.rsplit('/',1)[1]
            if name not in ['worker.min.js','tesseract-core-simd-lstm.wasm.js']:
                self.send_response(404);self.end_headers();return
            data=(runner.E2E_ROOT/'comics-runtime'/name).read_bytes()
            self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(data);return
        if self.path=='/comics-bundle.js':
            data=(runner.REPO/'dist/duallens.user.js').read_bytes()
            self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(data);return
        if self.path=='/comics/blocked.html':
            data=(runner.FIXTURES/'comics/index.html').read_bytes()
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Security-Policy',"script-src 'self'; worker-src 'none'");self.end_headers();self.wfile.write(data);return
        if self.path.startswith('/comics-data/'):
            name=self.path.rsplit('/',1)[1]
            if name not in ['eng.traineddata','jpn.traineddata','jpn_vert.traineddata','kor.traineddata']:
                self.send_response(404);self.end_headers();return
            data=(runner.E2E_ROOT/'comics-data'/name).read_bytes()
            self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.end_headers();self.wfile.write(data);return
        if self.path=='/comics/403.html':
            body=b'<!doctype html><body><img style="width:340px;height:420px" src="/comics/guarded.png"></body>'
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body);return
        if self.path=='/comics/guarded.png':
            # The displayed image loads. A refetch must pass the simulated hotlink policy.
            displayed=self.headers.get('Sec-Fetch-Dest')=='image' and (self.headers.get('Referer') or '').endswith('/comics/403.html')
            if not displayed and self.headers.get('Referer')!='https://www.pixiv.net/':
                self.send_response(403);self.end_headers();return
            data=(runner.FIXTURES/'comics/eng.png').read_bytes()
            self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(data);return
        super().do_GET()
    def do_POST(self):
        body=self.rfile.read(int(self.headers.get('Content-Length','0')))
        REQUESTS.append(body.decode('utf-8'))
        request=json.loads(body)
        user=request['messages'][-1]['content']
        content=json.loads(user.split('<input>',1)[1].split('</input>',1)[0])
        # This recorder is a text transport fixture, not a Japanese translation model.
        translated=['【译】模拟中文' if any('\u3040'<=c<='\u309f' for c in text) else '【译】'+text for text in content['t']]
        response=json.dumps({'choices':[{'message':{'content':json.dumps({'t':translated},ensure_ascii=False)}}]},ensure_ascii=False).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)

def fixtures():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(runner.FIXTURES)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server,f'http://127.0.0.1:{server.server_port}'

def settings_v2(h,patch):
    page=h.ctx.new_page();page.goto('chrome-extension://'+h.ext_id+'/ui/options.html')
    page.locator('#save:enabled').wait_for()
    try:
        return page.evaluate("async patch => {const {saveSettings}=await import(chrome.runtime.getURL('shared/settings.js'));return saveSettings(patch)}",patch)
    finally:page.close()

def setup(h,lang):
    data=runner.E2E_ROOT/'comics-data'
    # Offline controlled data response; production still pins the upstream URL and checks its hash.
    h.ctx.route('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/**',lambda route:route.fulfill(path=str(data/route.request.url.rsplit('/',1)[1]),content_type='application/octet-stream'))
    settings_v2(h,{'comics':{'language':lang},'provider':{'active':'comic-test','chain':[], 'profiles':[{
      'id':'comic-test','kind':'openai','name':'Offline local text recorder','baseUrl':h.base+'/v1','model':'mock',
      'jsonMode':True,'maxItems':20,'maxChars':4000,'concurrency':2,'timeoutMs':10000,'fallbackModels':[]}]}})

runner.CASES.clear()
runner.start_fixtures=fixtures
@runner.case('comics_ocr','Real local Japanese/Korean/English OCR, text-only mock HTTP, exact restore')
def comics_ocr(h):
    REQUESTS.clear();metrics=[];quality=[]
    for image,lang,expected in [('jpn','jpn_vert',['こんにちは','ありがとう']),('kor','kor',['안녕하세요','감사합니다']),('eng','eng',['HELLO FRIEND','GOOD MORNING'])]:
        setup(h,lang)
        h.open('comics/index.html')
        # Show only one selected test image without changing the image itself.
        h.js("id=>document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!==id)f.style.display='none'})",image)
        before=h.js('() => document.body.outerHTML')
        images=h.js('() => [...document.images].map(i=>i.outerHTML)')
        h.command('translate-comics')
        state=h.wait_state(lambda s:len(s.get('comics',[]))==1 and (
          (len(s['comics'][0]['items'])>=2 and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items'])) or
          any(word in s['comics'][0]['status'] for word in ['失败','未就绪','无法','超时','connection','没有找到']) or
          (bool(s['comics'][0]['items']) and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items']))),90,'two real OCR translations')
        panel=state['comics'][0]
        runner.check(len(panel['items'])>=2,'OCR failed: '+panel['status'])
        texts=[i['original'] for i in panel['items']]
        runner.check(len(texts)==len(expected),f'{lang} text region count: {texts!r}')
        # Assert correspondence and reading order with real OCR, without hiding recognition errors.
        scores=[difflib.SequenceMatcher(None,a.replace(' ',''),b.replace(' ','')).ratio() for a,b in zip(texts,expected)]
        runner.check(min(scores)>=.8,f'{lang} OCR/order expected {expected!r}, got {texts!r}')
        quality.append({'lang':lang,'expected':expected,'recognized':texts,'similarities':scores})
        runner.check(h.js('() => [...document.images].map(i=>i.outerHTML)')==images,'source image DOM changed')
        metrics.append(panel['metrics'])
        h.command('restore-comics')
        runner.check(h.js('() => document.body.outerHTML')==before,'comic restore changed DOM')
        runner.check(h.js("() => document.querySelectorAll('dl-comic').length")==0,'panel remains after restore')
        h.page.close()
    settings=h.ctx.new_page();settings.goto('chrome-extension://'+h.ext_id+'/ui/options.html')
    packs=settings.evaluate("() => chrome.runtime.sendMessage({type:'comic-languages-list'})")
    runner.check(packs['ok'] and {p['lang'] for p in packs['languages']}=={'jpn_vert','kor','eng'},str(packs))
    row=settings.locator('#comics-languages p').filter(has_text='eng')
    row.locator('button').click();row.wait_for(state='hidden')
    deleted=settings.evaluate("() => chrome.runtime.sendMessage({type:'comic-languages-list'})")
    runner.check(deleted['ok'] and 'eng' not in {p['lang'] for p in deleted['languages']},str(deleted))
    settings.close()
    setup(h,'eng');h.open('comics/index.html')
    h.js("() => document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!=='eng')f.style.display='none'})")
    h.command('translate-comics')
    reloaded=h.wait_state(lambda s:bool(s.get('comics')) and len(s['comics'][0]['items'])==2 and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items']),30,'deleted language reload')
    runner.check(reloaded['comics'][0]['metrics']['language']['downloaded'],'deleted model was not downloaded again')
    h.command('restore-comics');h.command('translate-comics')
    cached=h.wait_state(lambda s:bool(s.get('comics')) and len(s['comics'][0]['items'])==2 and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items']),30,'cached language reuse')
    runner.check(not cached['comics'][0]['metrics']['language']['downloaded'],'verified model cache was not reused')
    h.command('restore-comics')
    runner.check(REQUESTS,'mock translation HTTP was not called')
    for raw in REQUESTS:
        request=json.loads(raw)
        runner.check(all(isinstance(m['content'],str) for m in request['messages']),'nontext model input')
        runner.check(not any(s in raw for s in ['data:image','base64','image_url','127.0.0.1','jpn.png','kor.png','eng.png']),'image or page URL escaped to translation service')
    return 'real OCR p50_ms='+str(round(statistics.median(m['ocrMs'] for m in metrics),2))+' metrics='+json.dumps(metrics)+' recognition='+json.dumps(quality,ensure_ascii=False)

@runner.case('page_source_language','Detected Japanese reaches prompt; edited short text does not keep a stale hint')
def page_source_language(h):
    setup(h,'eng');h.open('comics/index.html');REQUESTS.clear()
    h.js("() => {const p=document.createElement('p');p.id='ja-hint';p.textContent='今日はいい天気ですね。';document.body.prepend(p)}")
    settings_v2(h,{'sourceLang':'auto','siteRules':{'custom':[{'match':'127.0.0.1','include':['#ja-hint'],'exclude':[]}]}})
    h.page.wait_for_timeout(400);h.command('toggle-page')
    h.wait_js("() => !!document.querySelector('#ja-hint dl-t[data-dl-state=done]')")
    runner.check(any('源语言：Japanese' in json.loads(body)['messages'][0]['content'] for body in REQUESTS),'Japanese hint missing')
    h.command('toggle-page');REQUESTS.clear()
    h.js("() => document.querySelector('#ja-hint').textContent='One short phrase'")
    h.command('toggle-page');h.wait_js("() => !!document.querySelector('#ja-hint dl-t[data-dl-state=done]')")
    runner.check(any('源语言：自动识别' in json.loads(body)['messages'][0]['content'] for body in REQUESTS),'stale Japanese hint')
    h.command('toggle-page')
    return 'language hint forwarded and reset after edit; mock-only'

@runner.case('comics_403','Referer rejection preserves image and displays HTTP 403')
def comics_403(h):
    setup(h,'eng');h.open('comics/403.html');before=h.js('() => document.body.outerHTML')
    runner.check(h.js('() => document.images[0].naturalWidth')==680,'original guarded image did not load')
    requests_before=len(REQUESTS)
    h.command('translate-comics')
    h.wait_state(lambda s: bool(s.get('comics')) and '403' in s['comics'][0]['status'],30,'403 comic failure')
    h.command('restore-comics');runner.check(h.js('() => document.body.outerHTML')==before,'403 restore changed DOM')
    runner.check(len(REQUESTS)==requests_before,'403 still sent a translation request')

@runner.case('comics_referer_rules','Real DNR sets Referer only for extension initiator, follows remove/disable, floatball restores comics')
def comics_referer_rules(h):
    setup(h,'eng');h.open('comics/index.html')
    entry={'host':'127.0.0.1','imageHosts':['127.0.0.1'],'referer':h.base+'/'}
    settings_v2(h,{'comics':{'enabled':True,'canvasSites':[entry]}})
    options=h.ctx.new_page()
    try:
        options.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
        options.locator('#save:enabled').wait_for()
        runner.check(json.loads(options.locator('#comicsSites').input_value())==entry,'settings form dropped CDN metadata')
        options.click('#save')
        options.locator('#save:enabled').wait_for()
        saved=options.evaluate("async()=>{const {loadSettings}=await import('../shared/settings.js');return (await loadSettings()).comics.canvasSites}")
        runner.check(saved==[entry],'saving settings lost CDN metadata')
    finally:options.close()
    h.sw_eval("() => chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'})")
    rules=h.sw_eval('() => chrome.declarativeNetRequest.getSessionRules()')
    runner.check(len(rules)==1 and rules[0]['condition']['initiatorDomains']==[h.ext_id],str(rules))
    runner.check(rules[0]['condition']['resourceTypes']==['xmlhttprequest','other'],str(rules))
    url=h.base+'/comics/referer.png'
    probe="async url=>{const r=await fetch(url,{credentials:'omit',cache:'no-store'});await r.arrayBuffer();return r.status}"
    runner.check(h.sw_eval(probe,url)==200,'extension Referer was not set')
    runner.check(h.js(probe,url)==403,'website XHR was modified by extension rule')
    settings_v2(h,{'comics':{'canvasSites':[]}})
    h.sw_eval("() => chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'})")
    runner.check(h.sw_eval(probe,url)==403,'removed site left a rule active')
    settings_v2(h,{'comics':{'canvasSites':[entry],'enabled':False}})
    h.sw_eval("() => chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'})")
    runner.check(h.sw_eval('() => chrome.declarativeNetRequest.getSessionRules()')==[],'disabled comics left session rules')
    settings_v2(h,{'comics':{'enabled':True,'canvasSites':['*.pixiv.net']}})
    h.js("() => document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!=='eng')f.style.display='none'})")
    before=h.js('() => document.body.outerHTML')
    h.command('translate-comics')
    h.wait_state(lambda s: bool(s.get('comics')) and len(s['comics'][0]['items'])==2,30,'local OCR before floatball restore')
    width,height=h.page.viewport_size.values()
    h.page.mouse.click(width-28,round(.6*(height-44))+22)
    h.wait_state(lambda s: not s.get('comics') and not s.get('translated'),10,'floatball comic restore')
    runner.check(h.js('() => document.body.outerHTML')==before,'floatball restore changed original DOM')
    return 'scoped header set, website XHR untouched, rule removal/disable and floatball exact restore'

@runner.case('comics_userscript','Bundled local userscript OCR through anonymous GM blob/arraybuffer mocks')
def comics_userscript(h,blocked=False,fallback=False,allow_sites=False):
    h.open('comics/blocked.html' if blocked else 'comics/index.html')
    h.page.set_viewport_size({'width':375,'height':812})
    h.js("() => document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!=='eng')f.style.display='none'})")
    before=h.js('() => document.body.outerHTML')
    h.js("""() => {
      const settings={version:2,provider:{active:'mock',chain:[]},comics:{language:'eng'},floatBall:{enabled:false}};
      // The platform owner still has a v1 compatibility seam in this integration baseline.
      const values={'duallens:sync':{settings,'settings.core':settings}};
      window.fixtureStorage=values;
      const commands={};window.fixtureCommands=commands;window.fixtureRoots=[];window.fixtureRequests=[];
      window.fixtureResourceReads=[];
      window.GM_getResourceText=name=>{
        window.fixtureResourceReads.push(name);
        const file=name==='duallensOcrCore'?'tesseract-core-simd-lstm.wasm.js':'worker.min.js';
        return fetch('/comics-runtime/'+file).then(res=>res.text());
      };
      const attach=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(...args){const root=attach.apply(this,args);if(this.localName==='dl-comic')window.fixtureRoots.push(root);return root;};
      window.GM_getValue=(key,def)=>Promise.resolve(values[key]??def);
      window.GM_setValue=(key,val)=>{values[key]=val;};window.GM_deleteValue=key=>{delete values[key];};
      window.GM_addValueChangeListener=()=>{};window.GM_registerMenuCommand=(label,handler)=>{commands[label]=handler;};
      window.GM_xmlhttpRequest=req=>{
        window.fixtureRequests.push({url:req.url,anonymous:req.anonymous,type:req.responseType});
        const url=req.url.startsWith('https://raw.githubusercontent.com/')?'/comics-data/'+req.url.split('/').pop():req.url.startsWith('https://cdn.jsdelivr.net/')?'/comics-runtime/'+req.url.split('/').pop():req.url;
        const ctrl=new AbortController();fetch(url,{signal:ctrl.signal,credentials:'omit'}).then(async res=>{
          const response=req.responseType==='arraybuffer'?await res.arrayBuffer():req.responseType==='blob'?await res.blob():await res.text();
          req.onload({status:res.status,response,responseText:typeof response==='string'?response:'',responseHeaders:'content-type: '+res.headers.get('content-type')});
        }).catch(()=>req.onerror());return {abort:()=>ctrl.abort()};
      };
    }""")
    if allow_sites: h.js("() => {window.fixtureStorage['duallens:sync'].settings.comics.canvasSites=['127.0.0.1']}")
    if fallback: h.js("() => {window.GM_getResourceText=()=>{throw Error('Resource API unavailable')}}")
    h.page.add_script_tag(url=h.base+'/comics-bundle.js')
    wait_csp_safe(h,"() => !!window.fixtureCommands['翻译此页漫画']")
    runner.check(h.js('() => window.fixtureResourceReads.length')==0,'ordinary page parsed/read OCR resources at startup')
    native=h.js("() => CanvasRenderingContext2D.prototype.drawImage.toString().includes('[native code]')")
    runner.check(native!=allow_sites,'userscript canvas hook did not follow opt-in whitelist')
    h.js("() => window.fixtureCommands['翻译此页漫画']()")
    if blocked:
        wait_csp_safe(h,"() => window.fixtureRoots.length && /此页无法本地识别/.test(window.fixtureRoots[0].querySelector('[role=status]').textContent)",timeout=10)
        runner.check(h.js('() => window.fixtureRequests.length')==0,'CSP failure still downloaded or uploaded data')
        h.js("() => window.fixtureCommands['恢复漫画原文']()")
        runner.check(h.js('() => document.body.outerHTML')==before,'CSP failure restore changed DOM')
        return
    h.wait_js("() => window.fixtureRoots.length && (window.fixtureRoots[0].querySelectorAll('li').length>=2 || /失败|无法/.test(window.fixtureRoots[0].querySelector('[role=status]').textContent))",timeout=60)
    status=h.js("() => window.fixtureRoots[0].querySelector('[role=status]').textContent")
    h.wait_js("() => [...window.fixtureRoots[0].querySelectorAll('li')].length===2 && [...window.fixtureRoots[0].querySelectorAll('li')].every(i=>i.children[1].textContent!=='翻译中…')",timeout=20,what='userscript OCR translations, status='+status)
    translations=h.js("() => [...window.fixtureRoots[0].querySelectorAll('li')].map(i=>i.children[1].textContent)")
    runner.check(all(t.startswith('【译】') for t in translations),str(translations))
    texts=h.js("() => [...window.fixtureRoots[0].querySelectorAll('li')].map(i=>i.children[0].textContent)")
    runner.check(texts==['HELLO FRIEND','GOOD MORNING'],str(texts))
    runner.check(h.js("() => getComputedStyle(document.querySelector('dl-comic')).display")== 'block','narrow panel is not below image')
    h.js("() => window.fixtureRoots[0].querySelector('li button').click()")
    runner.check(h.js("() => [...document.querySelectorAll('dl-ui')].some(el=>el.style.pointerEvents==='none')"),'region click did not highlight')
    h.js("() => window.fixtureRoots[0].querySelectorAll('li')[1].querySelectorAll('button')[1].click()")
    runner.check(h.js("() => window.fixtureRoots[0].querySelector('li p').textContent")=='GOOD MORNING','manual reading-order adjustment failed')
    requests=h.js('() => window.fixtureRequests')
    runner.check(all(r['anonymous'] for r in requests),'GM image/model request is not anonymous')
    runner.check({r['type'] for r in requests}=={'blob','arraybuffer'},str(requests))
    h.js("() => window.fixtureCommands['恢复漫画原文']()")
    runner.check(h.js('() => document.body.outerHTML')==before,'userscript restore changed DOM')

@runner.case('comics_userscript_csp','CSP blocks local WASM: explicit failure and no GM requests')
def comics_userscript_csp(h):
    comics_userscript(h,blocked=True)

@runner.case('comics_userscript_fallback','Unavailable resource API uses verified private GM runtime downloads')
def comics_userscript_fallback(h):
    comics_userscript(h,fallback=True)

@runner.case('comics_userscript_sites','User script MAIN hook installs only on explicitly opted-in domains')
def comics_userscript_sites(h):
    comics_userscript(h,allow_sites=True)

@runner.case('comics_sites','Dynamic MAIN registration defaults to pixiv, follows setting changes, never all sites')
def comics_sites(h):
    setup(h,'eng');h.open('comics/index.html')
    runner.check(h.js("() => CanvasRenderingContext2D.prototype.drawImage.toString().includes('[native code]')"),'ordinary extension page has a canvas hook')
    scripts=h.sw_eval("() => chrome.scripting.getRegisteredContentScripts()")
    runner.check(len(scripts)==1 and set(scripts[0]['matches'])=={'http://*.pixiv.net/*','https://*.pixiv.net/*'},str(scripts))
    options=h.ctx.new_page();options.goto('chrome-extension://'+h.ext_id+'/ui/options.html')
    options.locator('#save:enabled').wait_for()
    options.locator('#comicsSites').fill('127.0.0.1');options.locator('#save').click()
    for _ in range(100):
        if options.locator('#status').inner_text()=='设置已保存': break
        time.sleep(.05)
    runner.check(options.locator('#status').inner_text()=='设置已保存','comic settings save failed: '+options.locator('#status').inner_text())
    scripts=h.sw_eval("() => chrome.scripting.getRegisteredContentScripts()")
    runner.check(set(scripts[0]['matches'])=={'http://127.0.0.1/*','https://127.0.0.1/*'},str(scripts))
    options.locator('#comicsEnabled').uncheck();options.locator('#save').click()
    for _ in range(100):
        if options.locator('#status').inner_text()=='设置已保存': break
        time.sleep(.05)
    runner.check(options.locator('#status').inner_text()=='设置已保存','comic disable save failed: '+options.locator('#status').inner_text())
    runner.check(h.sw_eval("() => chrome.scripting.getRegisteredContentScripts()")==[],'disabled comics kept registration')
    options.close()

@runner.case('comics_popup','Popup comic button sends the command and renders local bilingual results')
def comics_popup(h):
    setup(h,'eng');h.open('comics/index.html')
    h.js("() => document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!=='eng')f.style.display='none'})")
    before=h.js('() => document.body.outerHTML')
    popup=h.ctx.new_page()
    popup.add_init_script('if(globalThis.chrome?.tabs) chrome.tabs.query=async()=>[{id:'+str(h.tab_id)+',url:'+json.dumps(h.page.url)+'}];')
    popup.goto('chrome-extension://'+h.ext_id+'/ui/popup.html')
    popup.locator('#comics').click()
    h.wait_state(lambda s:bool(s.get('comics')) and len(s['comics'][0]['items'])==2 and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items']),30,'popup comic translations')
    popup.close();h.command('restore-comics')
    runner.check(h.js('() => document.body.outerHTML')==before,'popup comic restoration failed')

@runner.case('comics_canvas','MAIN canvas source/crop hooks, original pixels and exact DOM restoration')
def comics_canvas(h):
    setup(h,'eng');settings_v2(h,{'comics':{'canvasSites':['127.0.0.1']}})
    options=h.ctx.new_page();options.goto('chrome-extension://'+h.ext_id+'/ui/options.html')
    registration=options.evaluate("() => chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'})")
    runner.check(registration['ok'],'canvas registration failed');options.close()
    scripts=h.sw_eval("() => chrome.scripting.getRegisteredContentScripts()")
    runner.check(len(scripts)==1 and 'http://127.0.0.1/*' in scripts[0]['matches'],'registered site mismatch: '+str(scripts))
    h.open('comics/index.html')
    h.js("""async()=>{
      document.querySelectorAll('figure').forEach(f=>f.style.display='none');
      const image=document.querySelector('#eng');await image.decode();
      const bitmap=await createImageBitmap(image,0,0,680,840);
      const canvas=document.createElement('canvas');canvas.width=680;canvas.height=840;
      canvas.style.width='340px';canvas.style.height='420px';canvas.id='canvas-test';
      canvas.getContext('2d').drawImage(bitmap,0,0,680,420,0,0,680,420);
      canvas.getContext('2d').drawImage(bitmap,0,420,680,420,0,420,680,420);
      bitmap.close();document.body.append(canvas);
    }""")
    before=h.js('() => document.body.outerHTML');pixels=h.js("() => document.querySelector('#canvas-test').toDataURL()")
    metadata=h.js("""()=>{
      const canvas=document.querySelector('#canvas-test');let detail=null;
      const listener=e=>detail=e.detail;canvas.addEventListener('duallens-comic-source',listener);
      canvas.dispatchEvent(new Event('duallens-comic-query',{bubbles:true}));canvas.removeEventListener('duallens-comic-source',listener);return detail;
    }""")
    runner.check(metadata is not None,'MAIN hook did not record canvas; hook='+h.js('() => CanvasRenderingContext2D.prototype.drawImage.toString().slice(0,150)'))
    h.command('translate-comics')
    state=h.wait_state(lambda s: bool(s.get('comics')) and len(s['comics'][0]['items'])==2 and all(i['translation'].startswith('【译】') for i in s['comics'][0]['items']),30,'canvas source OCR')
    runner.check([i['original'] for i in state['comics'][0]['items']]==['HELLO FRIEND','GOOD MORNING'],str(state['comics']))
    runner.check(h.js("() => document.querySelector('#canvas-test').toDataURL()")==pixels,'canvas pixels were modified')
    h.command('restore-comics');runner.check(h.js('() => document.body.outerHTML')==before,'canvas DOM changed on restore')

if __name__=='__main__': raise SystemExit(runner.main(['--mock-only','--artifacts-dir',str(runner.E2E_ROOT/'artifacts-comics'),*sys.argv[1:]]))

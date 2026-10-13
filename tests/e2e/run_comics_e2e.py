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
import run_e2e as runner

REQUESTS=[]
class Handler(runner._QuietHandler):
    def do_GET(self):
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
            data=(Path(os.environ['USERPROFILE'])/'.cache/duallens-e2e/comics-data'/name).read_bytes()
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
        response=json.dumps({'choices':[{'message':{'content':json.dumps({'t':['【译】'+text for text in content['t']]},ensure_ascii=False)}}]},ensure_ascii=False).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)

def fixtures():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(runner.FIXTURES)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server,f'http://127.0.0.1:{server.server_port}'

def setup(h,lang):
    data=Path(os.environ['USERPROFILE'])/'.cache/duallens-e2e/comics-data'
    # Offline controlled data response; production still pins the upstream URL and checks its hash.
    h.ctx.route('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/**',lambda route:route.fulfill(path=str(data/route.request.url.rsplit('/',1)[1]),content_type='application/octet-stream'))
    h.settings({'comics':{'language':lang},'provider':{'active':'comic-test','chain':[], 'profiles':[{
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
          any(word in s['comics'][0]['status'] for word in ['失败','未就绪','无法','connection','没有找到']) or
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
    deleted=settings.evaluate("() => chrome.runtime.sendMessage({type:'comic-languages-delete',lang:'eng'})")
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

@runner.case('comics_403','Referer rejection preserves image and displays HTTP 403')
def comics_403(h):
    setup(h,'eng');h.open('comics/403.html');before=h.js('() => document.body.outerHTML')
    runner.check(h.js('() => document.images[0].naturalWidth')==680,'original guarded image did not load')
    requests_before=len(REQUESTS)
    h.command('translate-comics')
    h.wait_state(lambda s: bool(s.get('comics')) and '403' in s['comics'][0]['status'],30,'403 comic failure')
    h.command('restore-comics');runner.check(h.js('() => document.body.outerHTML')==before,'403 restore changed DOM')
    runner.check(len(REQUESTS)==requests_before,'403 still sent a translation request')

@runner.case('comics_userscript','Bundled local userscript OCR through anonymous GM blob/arraybuffer mocks')
def comics_userscript(h,blocked=False):
    h.open('comics/blocked.html' if blocked else 'comics/index.html')
    h.page.set_viewport_size({'width':375,'height':812})
    h.js("() => document.querySelectorAll('figure').forEach(f=>{if(f.firstElementChild.id!=='eng')f.style.display='none'})")
    before=h.js('() => document.body.outerHTML')
    h.js("""() => {
      const settings={version:2,provider:{active:'mock',chain:[]},comics:{language:'eng'},floatBall:{enabled:false}};
      // The platform owner still has a v1 compatibility seam in this integration baseline.
      const values={'duallens:sync':{settings,'settings.core':settings}};
      const commands={};window.fixtureCommands=commands;window.fixtureRoots=[];window.fixtureRequests=[];
      const attach=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(...args){const root=attach.apply(this,args);if(this.localName==='dl-comic')window.fixtureRoots.push(root);return root;};
      window.GM_getValue=(key,def)=>Promise.resolve(values[key]??def);
      window.GM_setValue=(key,val)=>{values[key]=val;};window.GM_deleteValue=key=>{delete values[key];};
      window.GM_addValueChangeListener=()=>{};window.GM_registerMenuCommand=(label,handler)=>{commands[label]=handler;};
      window.GM_xmlhttpRequest=req=>{
        window.fixtureRequests.push({url:req.url,anonymous:req.anonymous,type:req.responseType});
        const url=req.url.startsWith('https://raw.githubusercontent.com/')?'/comics-data/'+req.url.split('/').pop():req.url;
        const ctrl=new AbortController();fetch(url,{signal:ctrl.signal,credentials:'omit'}).then(async res=>{
          const response=req.responseType==='arraybuffer'?await res.arrayBuffer():req.responseType==='blob'?await res.blob():await res.text();
          req.onload({status:res.status,response,responseText:typeof response==='string'?response:'',responseHeaders:'content-type: '+res.headers.get('content-type')});
        }).catch(()=>req.onerror());return {abort:()=>ctrl.abort()};
      };
    }""")
    h.page.add_script_tag(url=h.base+'/comics-bundle.js')
    h.wait_js("() => !!window.fixtureCommands['翻译此页漫画']")
    h.js("() => window.fixtureCommands['翻译此页漫画']()")
    if blocked:
        h.wait_js("() => window.fixtureRoots.length && /此页无法本地识别/.test(window.fixtureRoots[0].querySelector('[role=status]').textContent)",timeout=10)
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

@runner.case('comics_canvas','MAIN canvas source/crop hooks, original pixels and exact DOM restoration')
def comics_canvas(h):
    setup(h,'eng');h.open('comics/index.html')
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

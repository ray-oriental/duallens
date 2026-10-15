"""Explicitly authorized real-page checks. No login, paid model or profile reuse.

Uses the user's existing loopback gateway and direct system connection, caps cumulative SJTU
forwarded attempts at 30, and keeps screenshots outside git. Only a verified
local streaming rejection is excluded from that conservative budget.
The model catalog is not itself evidence that a model works.
The real PDF reader check lives in `run_pdf_e2e.py --live MODEL` (layout-preserving viewer).
"""
import argparse
import json
import time
import uuid
import run_e2e as e
from playwright.sync_api import Error as BrowserError

URLS={
    'novel':'https://www.pixiv.net/novel/show.php?id=29352462#2',
    'artwork':'https://www.pixiv.net/artworks/140601819#1',
}
OUT=e.E2E_ROOT/'v031'

def read(page,operation,seconds=15):
    """Retry only reads across a document replacement; never replay commands/clicks."""
    end=time.monotonic()+seconds
    while True:
        try:return operation()
        except BrowserError as error:
            if page.is_closed() or time.monotonic()>=end or not any(word in str(error).lower() for word in
              ('execution context was destroyed','cannot find context','navigation','not attached')):raise
            page.wait_for_timeout(100)
e.JS_SEND="""async ({tabId,msg}) => Promise.race([
 chrome.tabs.sendMessage(tabId,msg).then(response=>({ok:true,response}),e=>({ok:false,error:String(e)})),
 new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'tab response timeout'}),10000))])"""

def wait(page,predicate,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=read(page,lambda:page.evaluate(f'() => Boolean(({predicate})())'),min(15,max(.1,end-time.monotonic())))
        if result:return result
        page.wait_for_timeout(100)
    raise AssertionError('Real-page condition timed out')

def chinese(text):
    # Katakana names may legitimately be retained inside Chinese prose.
    size=sum(c.isalpha() for c in text)
    return sum('\u4e00'<=c<='\u9fff' for c in text)>0 and sum('\u3040'<=c<='\u309f' for c in text)<=max(1,size*.05)

def comic_done(item):
    text=item['translation']
    return bool(text) and not text.startswith(('翻译中','文字翻译失败'))

def navigate(page,url):
    for attempt in range(5):
        try:
            res=page.goto(url,wait_until='domcontentloaded',timeout=60000)
            if res and res.status>=500:raise AssertionError('Page HTTP '+str(res.status))
            return res.status if res else None
        except Exception:
            if attempt==4:raise
            page.wait_for_timeout(min(6000,1500*(attempt+1)))

def click_ball(h):
    size=h.page.viewport_size
    y=round(.6*(size['height']-44))+22
    h.page.mouse.click(size['width']-28,y)

def restore_ball(h):
    click_ball(h)
    wait(h.page,'() => document.querySelectorAll("dl-t,dl-o,dl-w,dl-r,dl-comic").length===0',10)
    h.page.wait_for_timeout(1000)
    return read(h.page,lambda:h.page.locator('dl-t,dl-o,dl-w,dl-r,dl-comic').count())==0

def reader_snapshot(page):
    return read(page,lambda:page.evaluate('''()=>{
      const visible=r=>r.width>0 && r.height>0 && r.top<innerHeight && r.bottom>0;
      const spans=[...document.querySelectorAll('p > span.text-count')];
      const pairs=spans.filter(el=>el.textContent.trim().length>3 && visible(el.getBoundingClientRect())).map(el=>{
        let translation=null;
        for(let n=el.nextSibling;n;n=n.nextSibling){
          if(n.nodeType!==1)continue;
          if(n.matches('dl-t')){translation=n;break;}
          if(n.matches('span.text-count') && n.textContent.trim())break;
        }
        return {done:translation?.matches('[data-dl-state=done]')||false,text:translation?.textContent||''};
      });
      return {url:location.href,pairs,total:document.querySelectorAll('p:has(span.text-count) dl-t[data-dl-state=done]').length,
        aligned:[...document.querySelectorAll('p:has(span.text-count) dl-t')].every(t=>{
          const p=t.parentElement.getBoundingClientRect(),r=t.getBoundingClientRect();return r.left>=p.left-2 && r.right<=p.right+2;
        })};
    }'''))

def reader_original(page):
    return read(page,lambda:page.locator('p:has(span.text-count)').evaluate_all('els=>els.map(el=>el.outerHTML)'))

def novel(h,result):
    wait(h.page,'() => document.querySelectorAll("p > span.text-count").length>0',40)
    # Idempotent positioning is separate from translation commands. A navigation before
    # this baseline is harmless; one during translation must remain an explicit failure.
    read(h.page,lambda:h.page.locator('p:has(>span.text-count)').first.evaluate("el=>el.scrollIntoView({block:'start'})"))
    stable=None;end=time.monotonic()+15
    while time.monotonic()<end:
        baseline=reader_original(h.page)
        if baseline and baseline==stable:break
        stable=baseline;h.page.wait_for_timeout(800)
    else:raise AssertionError('Novel reader did not settle after navigation')
    before=baseline;initial=reader_snapshot(h.page)
    assert initial['pairs'],'No visible novel reader paragraphs'
    result['visibleParagraphs']=len(initial['pairs'])
    h.page.screenshot(path=str(OUT/'novel-original.png'))
    start=time.monotonic();click_ball(h)
    result['ballStarted']=True
    result['firstViewportParagraphMs']=None;filled=False;end=start+35
    while time.monotonic()<end:
        snapshot=reader_snapshot(h.page);pairs=snapshot['pairs']
        done=[p for p in pairs if p['done'] and chinese(p['text'])]
        if done and result['firstViewportParagraphMs'] is None:
            result['firstViewportParagraphMs']=round((time.monotonic()-start)*1000)
            h.page.screenshot(path=str(OUT/'novel-first.png'))
        filled=bool(pairs) and len(done)==len(pairs)
        if filled:break
        h.page.wait_for_timeout(50)
    result['viewportFilled']=filled
    if filled:result['viewportFilledMs']=round((time.monotonic()-start)*1000)
    result['translationCount']=snapshot['total'];result['visibleChineseTranslations']=len(done)
    result['visibleMissingTranslations']=len(pairs)-len(done);result['aligned']=snapshot['aligned']
    h.page.screenshot(path=str(OUT/'novel-bilingual.png'))
    if filled:
        h.command('toggle-translation-only')
        wait(h.page,"() => !!document.querySelector('p:has(span.text-count) dl-o.dl-hide')",10)
        result['translationOnly']=read(h.page,lambda:h.page.evaluate("() => [...document.querySelectorAll('p:has(span.text-count) dl-o.dl-hide')].every(el=>el.getClientRects().length===0)"))
        only_start=time.monotonic()
        wait(h.page,"""() => ![...document.querySelectorAll('p span.text-count')].some(el=>{
          const r=el.getBoundingClientRect();return !el.closest('dl-t') && el.textContent.trim().length>3 && r.width>0 && r.height>0 && r.top<innerHeight && r.bottom>0;
        })""",30)
        result['onlyViewportFilledMs']=round((time.monotonic()-only_start)*1000)
        h.page.screenshot(path=str(OUT/'novel-only.png'))
        h.command('toggle-translation-only')
        wait(h.page,"() => !document.querySelector('p:has(span.text-count) dl-o')",10)
        untouched=read(h.page,lambda:h.page.evaluate('''()=>{
          const spans=[...document.querySelectorAll('p > span.text-count')];
          return spans.findIndex(el=>{
            if(el.textContent.trim().length<6 || !/[ぁ-ヿ]/.test(el.textContent))return false;
            for(let n=el.nextSibling;n;n=n.nextSibling){
              if(n.nodeType!==1)continue;
              if(n.matches('dl-t'))return false;
              if(n.matches('span.text-count') && n.textContent.trim())break;
            }
            return true;
          });
        }'''))
        assert untouched>=0,'No untouched Japanese paragraph for lazy acceptance'
        result['lazyUntouchedIndex']=untouched
        read(h.page,lambda:h.page.locator('p > span.text-count').nth(untouched).evaluate("el=>el.scrollIntoView({block:'start'})"))
        h.page.wait_for_timeout(300)
        lazy_start=time.monotonic()
        while time.monotonic()-lazy_start<30:
            lazy=reader_snapshot(h.page)
            if lazy['pairs'] and all(p['done'] and chinese(p['text']) for p in lazy['pairs']):break
            h.page.wait_for_timeout(100)
        result['lazyScroll']=bool(lazy['pairs']) and all(p['done'] and chinese(p['text']) for p in lazy['pairs'])
        result['lazyScrollMs']=round((time.monotonic()-lazy_start)*1000)
        h.page.screenshot(path=str(OUT/'novel-scrolled.png'))
    result['ballRestored']=restore_ball(h)
    result['readerDOMRestored']=before==reader_original(h.page)
    h.page.screenshot(path=str(OUT/'novel-restored.png'))
    assert filled and result['firstViewportParagraphMs']<=3000 and result['viewportFilledMs']<=30000 and result['aligned'] and result['readerDOMRestored'] and result.get('translationOnly') and result.get('lazyScroll'), 'Novel timing/language/interaction acceptance failed'

def artwork(h,result):
    wait(h.page,'() => [...document.images].some(i=>i.naturalWidth>280 && i.getBoundingClientRect().width>280)',40)
    h.page.wait_for_timeout(1500)
    before=h.page.locator('img').evaluate_all('els=>els.map(i=>i.outerHTML)')
    h.page.screenshot(path=str(OUT/'artwork-original.png'))
    h.command('translate-comics')
    end=time.monotonic()+300;state=None;next_update=time.monotonic()+30
    while time.monotonic()<end:
        state=h.state() or {};panels=state.get('comics',[])
        if panels and any(p['items'] and all(comic_done(i) for i in p['items']) for p in panels):break
        if panels and any(any(s in p['status'] for s in ['失败','403','无法','超时']) for p in panels):break
        if time.monotonic()>next_update:
            print('REAL artwork progress',json.dumps({'ocrRegions':sum(len(p['items']) for p in panels),
              'completedTranslations':sum(comic_done(i) for p in panels for i in p['items'])}),flush=True)
            next_update=time.monotonic()+30
        h.page.wait_for_timeout(300)
    panels=(state or {}).get('comics',[]);items=[i for p in panels for i in p['items']]
    result['panels']=len(panels);result['ocrRegions']=len(items)
    result['pendingTranslations']=sum(i['translation'].startswith('翻译中') for i in items)
    result['failedTranslations']=sum(i['translation'].startswith('文字翻译失败') for i in items)
    result['japaneseRegions']=sum(any('\u3040'<=c<='\u30ff' for c in i['original']) for i in items)
    result['chineseTranslations']=sum(chinese(i['translation']) and comic_done(i) for i in items)
    result['status']=[p['status'] for p in panels];result['ocrMetrics']=[p.get('metrics') for p in panels]
    if h.page.locator('dl-comic').count():h.page.locator('dl-comic').first.evaluate("el=>el.scrollIntoView({block:'center'})")
    h.page.screenshot(path=str(OUT/'artwork-bilingual.png'))
    if h.page.locator('dl-comic').count():h.page.locator('dl-comic').first.evaluate("el=>el.scrollIntoView({block:'start'})")
    h.page.screenshot(path=str(OUT/'artwork-list.png'))
    result['ballRestored']=restore_ball(h)
    after=h.page.locator('img').evaluate_all('els=>els.map(i=>i.outerHTML)')
    result['imageDOMRestored']=before==after
    h.page.screenshot(path=str(OUT/'artwork-restored.png'))
    result['completedTranslations']=sum(comic_done(i) for i in items)
    assert result['ocrRegions']>0 and result['japaneseRegions']>0 and result['chineseTranslations']>0 and result['imageDOMRestored'] and result['completedTranslations']==len(items)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--only',choices=list(URLS),action='append')
    parser.add_argument('--max-items',type=int,choices=range(1,21),default=20,help='Temporary profile batch size; does not alter device configuration')
    parser.add_argument('--sjtu-limit',type=int,choices=range(0,31),default=6,help='Per-run cap within the new cumulative 30-call streaming round')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);run=e.E2E_ROOT/('run-v031-live-'+uuid.uuid4().hex[:8]);run.mkdir()
    ledger=OUT/'sjtu-budget-novel-stream.json'
    previous_budget=json.loads(ledger.read_text(encoding='utf-8')) if ledger.exists() else {}
    raw_used=previous_budget.get('gatewayRequests',0)
    local_rejections=previous_budget.get('verifiedLocalRejections',0)
    used=raw_used-local_rejections
    remaining=max(0,min(args.sjtu_limit,30-used))
    # Reserve before launching; a crashed runner cannot silently reset its allowance.
    ledger.write_text(json.dumps({'gatewayRequests':raw_used+remaining,'verifiedLocalRejections':local_rejections,'upstreamUpperBound':used+remaining,'reserved':True}),encoding='utf-8')
    ext,missing=e.stage_extension(run);assert not missing,missing
    results=[]
    try:
        with e.sync_playwright() as pw:
            h=e.Session(pw,ext,'','v031-live');h.profile.mkdir()
            try:
                h.ctx=pw.chromium.launch_persistent_context(str(h.profile),headless=False,
                    args=['--headless=new',f'--disable-extensions-except={ext}',f'--load-extension={ext}','--no-first-run','--no-proxy-server'],
                    ignore_default_args=['--disable-extensions'],viewport=e.VIEWPORT)
                h.ext_id=e.get_sw(h.ctx).url.split('/')[2]
                h.sw_eval('''limit=>{const original=globalThis.fetch;globalThis.liveCalls=[];globalThis.liveSJTU=0;
                  globalThis.liveForwarded=0;globalThis.liveLocalRejected=0;
                  setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),10000);
                  globalThis.fetch=async(url,init)=>{let model='',streaming=false;if(String(url)==='http://127.0.0.1:18790/v1/chat/completions'){
                    const payload=JSON.parse(init.body);model=payload.model;streaming=payload.stream===true;
                    if(!['sjtu/deepseek-chat','hermes/upstage/solar-mini4:free','ollama/qwen3:4b'].includes(model))throw Error('Forbidden model');
                    if(model.startsWith('sjtu/')) {if(globalThis.liveForwarded>=limit)throw Error('SJTU test budget exhausted');globalThis.liveSJTU++;globalThis.liveForwarded++;}}
                    const started=performance.now();const res=await original(url,init);if(model){const body=JSON.parse(init.body);const metric={model,status:res.status,headersMs:Math.round(performance.now()-started),stream:/text\\/event-stream/.test(res.headers.get('content-type')||''),japaneseHint:body.messages[0].content.includes('Japanese'),items:JSON.parse(body.messages.find(m=>m.role==='user').content.split('<input>')[1].split('</input>')[0]).t.length};
                      if(model.startsWith('sjtu/') && streaming && res.status===400) try {
                        const e=(await res.clone().json()).error;
                        if(e.code==='unsupported' && e.message==='Streaming is not supported') {
                          globalThis.liveForwarded--;globalThis.liveLocalRejected++;metric.localReject=true;
                        }
                      }catch{}
                      if(res.ok && /application\\/json/.test(res.headers.get('content-type')||'')) try {
                        const response=await res.clone().json();let t;
                        try {t=JSON.parse(response.choices[0].message.content.replace(/^```(?:json)?\\s*|\\s*```$/g,'')).t;}catch{}
                        const user=JSON.parse(init.body).messages.find(m=>m.role==='user').content;
                        const input=JSON.parse(user.split('<input>')[1].split('</input>')[0]).t;
                        metric.expectedItems=input.length;metric.returnedItems=Array.isArray(t)?t.length:null;
                        metric.unchangedItems=Array.isArray(t)?t.filter((x,i)=>x===input[i]).length:null;
                        metric.chineseItems=Array.isArray(t)?t.filter(x=>/[一-鿿]/.test(x)).length:null;
                      }catch{}globalThis.liveCalls.push(metric);}return res;};}''',remaining)
                bridge=h.ctx.new_page();bridge.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
                bridge.evaluate('''async opts=>{const {saveSettings}=await import('../shared/settings.js');
                  await saveSettings({targetLang:'zh-CN',sourceLang:'auto',cache:{enabled:false},provider:{active:'gateway',
                    chain:['sjtu/deepseek-chat','hermes/upstage/solar-mini4:free','ollama/qwen3:4b'].filter(model=>opts.remaining>0 || !model.startsWith('sjtu/')).map(model=>({profileId:'gateway',model})),
                    profiles:[{id:'gateway',kind:'gateway',name:'Real acceptance',baseUrl:'http://127.0.0.1:18790/v1',model:'sjtu/deepseek-chat',jsonMode:true,maxItems:opts.maxItems,maxChars:2000,concurrency:2,timeoutMs:90000,fallbackModels:[]}]},
                    comics:{enabled:true,language:'jpn_vert'},lazy:{rootMarginPx:50}});}''',{'remaining':remaining,'maxItems':args.max_items})
                for name,url in URLS.items():
                    if args.only and name not in args.only:continue
                    h.page=h.ctx.new_page();result={'page':name,'url':url,'batchMaxItems':args.max_items};print('REAL START',name,flush=True)
                    try:
                        result['http']=navigate(h.page,url)
                        h.page.wait_for_timeout(6000);h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
                        {'novel':novel,'artwork':artwork}[name](h,result)
                        result['outcome']='PASS'
                    except Exception as error:
                        result['outcome']='FAIL';result['error']=str(error)[:600]
                        try:result['visibleErrors']=read(h.page,lambda:h.page.locator('dl-r').evaluate_all('els=>els.map(el=>el.title || el.getAttribute("aria-label"))'))
                        except BrowserError:result['diagnosticUnavailable']=True
                        try:h.page.screenshot(path=str(OUT/f'{name}-failure.png'))
                        except BrowserError:pass
                    finally:h.page.close()
                    results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
                budget=h.sw_eval('() => ({sjtuGatewayRequests:globalThis.liveSJTU,forwardedUpperBound:globalThis.liveForwarded,localRejections:globalThis.liveLocalRejected,calls:globalThis.liveCalls})')
                budget['cumulativeSJTURequests']=used+budget['forwardedUpperBound']
                budget['cumulativeGatewayAttempts']=raw_used+budget['sjtuGatewayRequests']
                budget['verifiedLocalRejections']=local_rejections+budget['localRejections']
                ledger.write_text(json.dumps({'gatewayRequests':budget['cumulativeGatewayAttempts'],
                  'verifiedLocalRejections':budget['verifiedLocalRejections'],'upstreamUpperBound':budget['cumulativeSJTURequests']}),encoding='utf-8')
                result_file=OUT/'live-results.json'
                previous=json.loads(result_file.read_text(encoding='utf-8')).get('results',[]) if result_file.exists() else []
                merged={r['page']:r for r in previous}
                merged.update({r['page']:r for r in results})
                result_file.write_text(json.dumps({'results':list(merged.values()),'budget':budget},ensure_ascii=False,indent=2),encoding='utf-8')
                print('REAL BUDGET',json.dumps(budget),flush=True)
            finally:h.close()
    finally:e.remove_runtime_dir(run)
    failed=sum(r['outcome']=='FAIL' for r in results)
    print(f'SUMMARY real-v031 total={len(results)} PASS={len(results)-failed} FAIL={failed} screenshots={OUT}',flush=True)
    return bool(failed)

if __name__=='__main__':raise SystemExit(main())

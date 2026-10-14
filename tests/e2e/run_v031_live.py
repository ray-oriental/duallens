"""Explicitly authorized real-page checks. No login, paid model or profile reuse.

Uses the user's existing loopback gateway and proxy, caps cumulative SJTU
forwarded attempts at 30, and keeps screenshots outside git. Only a verified
local streaming rejection is excluded from that conservative budget.
The model catalog is not itself evidence that a model works.
"""
import argparse
import json
import time
import uuid
from pathlib import Path
from urllib.parse import quote
import run_e2e as e

URLS={
    'novel':'https://www.pixiv.net/novel/show.php?id=29352462#2',
    'artwork':'https://www.pixiv.net/artworks/140601819#1',
    'pdf':'https://math.berkeley.edu/~andrewshi/teaching/math1560j-fa26/lecture-notes/lecture-notes.pdf',
}
OUT=e.E2E_ROOT/'v031'
e.JS_SEND="""async ({tabId,msg}) => Promise.race([
 chrome.tabs.sendMessage(tabId,msg).then(response=>({ok:true,response}),e=>({ok:false,error:String(e)})),
 new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'tab response timeout'}),10000))])"""

def wait(page,predicate,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=page.evaluate(f'() => Boolean(({predicate})())')
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
    for attempt in range(3):
        try:
            res=page.goto(url,wait_until='domcontentloaded',timeout=60000)
            if res and res.status>=500:raise AssertionError('Page HTTP '+str(res.status))
            return res.status if res else None
        except Exception:
            if attempt==2:raise
            page.wait_for_timeout(1500)

def restore_ball(h,pdf=False):
    size=h.page.viewport_size
    y=.6*size['height']+22 if pdf else round(.6*(size['height']-44))+22
    h.page.mouse.click(size['width']-28,y)
    wait(h.page,'() => document.querySelectorAll("dl-t,dl-o,dl-w,dl-r,dl-comic").length===0',10)
    h.page.wait_for_timeout(1000)
    return h.page.locator('dl-t,dl-o,dl-w,dl-r,dl-comic').count()==0

def novel(h,result):
    wait(h.page,'() => document.querySelectorAll("p > span.text-count").length>0',40)
    h.page.locator('p:has(>span.text-count)').first.evaluate("el=>el.scrollIntoView({block:'start'})")
    h.page.wait_for_timeout(500)
    before=h.page.locator('p:has(>span.text-count)').evaluate_all('els=>els.map(el=>el.outerHTML)')
    visible=h.page.locator('p > span.text-count').evaluate_all('''els=>els.map((el,index)=>({index,r:el.getBoundingClientRect(),text:el.textContent.trim()}))
      .filter(x=>x.text.length>3 && x.r.top<innerHeight && x.r.bottom>0 && x.r.width>0).map(x=>x.index)''')
    assert visible,'No visible novel reader paragraphs'
    result['visibleParagraphs']=len(visible)
    h.page.screenshot(path=str(OUT/'novel-original.png'))
    start=time.monotonic();h.command('toggle-page')
    try:
        wait(h.page,'''() => [...document.querySelectorAll('p:has(>span.text-count) dl-t[data-dl-state=done]')]
          .some(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight && r.bottom>0 && r.width>0;})''',140)
        result['firstViewportParagraphMs']=round((time.monotonic()-start)*1000)
    except AssertionError:
        result['firstViewportParagraphMs']=None
        result['firstViewportTimedOut']=True
    h.page.screenshot(path=str(OUT/'novel-first.png'))
    filled=False;end=start+180
    while time.monotonic()<end:
        filled=h.page.evaluate('''()=>{const els=[...document.querySelectorAll('p > span.text-count')].filter(el=>{
          const r=el.getBoundingClientRect();return el.textContent.trim().length>3 && r.top<innerHeight && r.bottom>0 && r.width>0;});
          return els.length>0 && els.every(el=>{for(let n=el.nextSibling;n;n=n.nextSibling)
            if(n.nodeType===1 && n.matches('dl-t'))return n.matches('[data-dl-state=done]');
            return !!el.querySelector('dl-t[data-dl-state=done]');});}''')
        if filled:break
        h.page.wait_for_timeout(100)
    result['viewportFilled']=filled
    if filled:result['viewportFilledMs']=round((time.monotonic()-start)*1000)
    texts=h.page.locator('p:has(>span.text-count) dl-t[data-dl-state=done]').all_text_contents()
    result['translationCount']=len(texts);result['chineseTranslations']=sum(map(chinese,texts))
    result['aligned']=h.page.evaluate('''()=>[...document.querySelectorAll('p:has(>span.text-count) dl-t[data-dl-state=done]')].every(t=>{
      const p=t.parentElement.getBoundingClientRect(),r=t.getBoundingClientRect();
      return r.left>=p.left-2 && r.right<=p.right+2 && r.bottom<=p.bottom+2;})''')
    h.page.screenshot(path=str(OUT/'novel-bilingual.png'))
    result['ballRestored']=restore_ball(h)
    result['readerDOMRestored']=before==h.page.locator('p:has(>span.text-count)').evaluate_all('els=>els.map(el=>el.outerHTML)')
    assert filled and result['firstViewportParagraphMs'] is not None and texts and all(map(chinese,texts)) and result['aligned'] and result['readerDOMRestored'], 'Viewport translation incomplete'

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

def pdf(h,result,numbers=(1,2,3)):
    wait(h.page,'() => document.querySelector(".pdf-page .paragraphs p,#status.error")',70)
    result['status']=h.page.locator('#status').inner_text();result['pages']=h.page.locator('.pdf-page').count()
    assert result['pages']>0,result['status']
    h.page.screenshot(path=str(OUT/'pdf-original.png'))
    result['pageResults']=[]
    for number in numbers:
        h.page.fill('#page-number',str(number));h.page.click('#jump')
        wait(h.page,f'() => document.querySelector(".pdf-page[data-page=\\"{number}\\"] .paragraphs p")',30)
        selector=f'.pdf-page[data-page="{number}"] .paragraphs'
        before=h.page.locator(selector).inner_html()
        math_before=h.page.locator(selector+' .pdf-math,'+selector+' .pdf-formula').evaluate_all('els=>els.filter(el=>!el.closest("dl-t")).map(el=>el.textContent)')
        h.page.click('#translate')
        wait(h.page,f'''() => [...document.querySelectorAll('.pdf-page[data-page="{number}"] dl-t[data-dl-state=done]')]
          .some(el=>{{const r=el.getBoundingClientRect();return r.top<innerHeight && r.bottom>0 && /[\u4e00-\u9fff]/.test(el.textContent);}})''',150)
        h.page.wait_for_timeout(1200)
        texts=h.page.locator(selector+' dl-t[data-dl-state=done]').evaluate_all('''els=>els.map(el=>{
          const clone=el.cloneNode(true);clone.querySelectorAll('.pdf-math,.pdf-formula').forEach(n=>n.remove());return clone.textContent;})''')
        math_after=h.page.locator(selector+' .pdf-math,'+selector+' .pdf-formula').evaluate_all('els=>els.filter(el=>!el.closest("dl-t")).map(el=>el.textContent)')
        protected=h.page.locator(selector+' .pdf-math dl-t,'+selector+' .pdf-formula dl-t').count()==0
        aligned=h.page.locator(selector).evaluate('''el=>{const ps=[...el.children];return ps.every((p,i)=>!i || p.getBoundingClientRect().top>=ps[i-1].getBoundingClientRect().bottom-1)}''')
        h.page.screenshot(path=str(OUT/f'pdf-page-{number}-bilingual.png'))
        restored=restore_ball(h,True)
        # Layout margins are recalculated when translations resize; compare content/attributes except spacing.
        html=h.page.locator(selector).inner_html()
        normalize=lambda value:__import__('re').sub(r' style="margin-block-start: [^"]+"','',value)
        exact=normalize(before)==normalize(html)
        item={'page':number,'translationCount':len(texts),'chineseTranslations':sum(map(chinese,texts)),
          'formulaCount':len(math_before),'formulasUnchanged':math_before==math_after,'protected':protected,'aligned':aligned,'restored':restored,'contentDOMRestored':exact}
        result['pageResults'].append(item)
        assert texts and any(map(chinese,texts)) and math_before==math_after and protected and aligned and exact,item

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--only',choices=list(URLS),action='append')
    parser.add_argument('--pdf-page',type=int,action='append',help='Explicit additional PDF page probe instead of pages 1-3')
    parser.add_argument('--max-items',type=int,choices=range(1,7),default=6,help='Temporary profile batch size; does not alter device configuration')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);run=e.E2E_ROOT/('run-v031-live-'+uuid.uuid4().hex[:8]);run.mkdir()
    ledger=OUT/'sjtu-budget.json'
    previous_budget=json.loads(ledger.read_text(encoding='utf-8')) if ledger.exists() else {}
    raw_used=previous_budget.get('gatewayRequests',0)
    local_rejections=previous_budget.get('verifiedLocalRejections',0)
    used=raw_used-local_rejections
    remaining=max(0,min(24,30-used))
    ext,missing=e.stage_extension(run);assert not missing,missing
    results=[]
    try:
        with e.sync_playwright() as pw:
            h=e.Session(pw,ext,'','v031-live');h.profile.mkdir()
            try:
                h.ctx=pw.chromium.launch_persistent_context(str(h.profile),headless=False,
                    args=['--headless=new',f'--disable-extensions-except={ext}',f'--load-extension={ext}','--no-first-run'],
                    ignore_default_args=['--disable-extensions'],viewport=e.VIEWPORT,
                    proxy={'server':'http://127.0.0.1:7897','bypass':'127.0.0.1,localhost'})
                h.ext_id=e.get_sw(h.ctx).url.split('/')[2]
                h.sw_eval('''limit=>{const original=globalThis.fetch;globalThis.liveCalls=[];globalThis.liveSJTU=0;
                  globalThis.liveForwarded=0;globalThis.liveLocalRejected=0;
                  setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),10000);
                  globalThis.fetch=async(url,init)=>{let model='',streaming=false;if(String(url)==='http://127.0.0.1:18790/v1/chat/completions'){
                    const payload=JSON.parse(init.body);model=payload.model;streaming=payload.stream===true;
                    if(!['sjtu/deepseek-chat','hermes/upstage/solar-mini4:free','ollama/qwen3:4b'].includes(model))throw Error('Forbidden model');
                    if(model.startsWith('sjtu/')) {if(globalThis.liveForwarded>=limit)throw Error('SJTU test budget exhausted');globalThis.liveSJTU++;globalThis.liveForwarded++;}}
                    const res=await original(url,init);if(model){const metric={model,status:res.status};
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
                        target=f'chrome-extension://{h.ext_id}/pdf/viewer.html?file='+quote(url,safe='') if name=='pdf' else url
                        result['http']=navigate(h.page,target)
                        if name!='pdf':
                            h.page.wait_for_timeout(6000);h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
                        else:h.tab_id=h.page.evaluate('async()=>(await chrome.tabs.getCurrent()).id')
                        if name=='pdf':pdf(h,result,args.pdf_page or (1,2,3))
                        else:{'novel':novel,'artwork':artwork}[name](h,result)
                        result['outcome']='PASS'
                    except Exception as error:
                        result['outcome']='FAIL';result['error']=str(error)[:600]
                        result['visibleErrors']=h.page.locator('dl-r').evaluate_all('els=>els.map(el=>el.title || el.getAttribute("aria-label"))')
                        h.page.screenshot(path=str(OUT/f'{name}-failure.png'))
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
                if args.pdf_page and 'pdf' in merged:
                    for result in results:
                        if result['page']=='pdf':
                            inspected={p['page']:p for p in merged['pdf'].get('pageResults',[])}
                            inspected.update({p['page']:p for p in result.get('pageResults',[])})
                            result['pageResults']=list(inspected.values())
                merged.update({r['page']:r for r in results})
                result_file.write_text(json.dumps({'results':list(merged.values()),'budget':budget},ensure_ascii=False,indent=2),encoding='utf-8')
                print('REAL BUDGET',json.dumps(budget),flush=True)
            finally:h.close()
    finally:e.remove_runtime_dir(run)
    failed=sum(r['outcome']=='FAIL' for r in results)
    print(f'SUMMARY real-v031 total={len(results)} PASS={len(results)-failed} FAIL={failed} screenshots={OUT}',flush=True)
    return bool(failed)

if __name__=='__main__':raise SystemExit(main())

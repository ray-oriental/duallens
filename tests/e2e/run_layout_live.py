"""Explicit real-site layout diagnostics. No login; isolated profile; free providers only.

Run with --phase before|after. Artifacts and extracted PDF coordinates stay outside git.
"""
import argparse
import json
import time
import uuid
import subprocess
from pathlib import Path
from urllib.parse import quote
import run_e2e as e

URLS = {
    'novel': 'https://www.pixiv.net/novel/show.php?id=29352462#2',
    'artwork': 'https://www.pixiv.net/artworks/140601819#1',
    'pdf': 'https://math.berkeley.edu/~andrewshi/teaching/math1560j-fa26/lecture-notes/lecture-notes.pdf',
}
OUT = e.E2E_ROOT / 'layout'
e.JS_SEND = """async ({tabId,msg}) => Promise.race([
  chrome.tabs.sendMessage(tabId,msg).then(response=>({ok:true,response}),e=>({ok:false,error:String(e)})),
  new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'tab response timed out'}),10000))])"""


def inspect_popup(h,name,phase):
    popup=h.ctx.new_page()
    popup.add_init_script('if(globalThis.chrome?.tabs)chrome.tabs.query=async()=>[{id:'+str(h.tab_id)+',url:'+json.dumps(h.page.url)+'}];')
    try:
        popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
        popup.locator('#toggle:enabled').wait_for(timeout=10000)
        popup.screenshot(path=str(OUT/f'{name}-{phase}-popup.png'))
        return popup.locator('#page-status').inner_text()
    finally:popup.close();h.page.bring_to_front()


def restore_with_ball(h,name):
    size=h.page.viewport_size
    y=.6*size['height']+22 if name=='pdf' else round(.6*(size['height']-44))+22
    h.page.mouse.click(size['width']-28,y)
    h.page.wait_for_timeout(400)
    return h.page.locator('dl-t,dl-o,dl-comic').count()==0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--only', choices=list(URLS), action='append')
    parser.add_argument('--mock', action='store_true', help='Layout-only diagnosis, no model call')
    parser.add_argument('--pdf-file',type=Path,help='Explicitly inspect an anonymously downloaded real PDF through the file chooser')
    parser.add_argument('--model',choices=['ollama/qwen3:4b','sjtu/deepseek-chat'],default='ollama/qwen3:4b')
    parser.add_argument('--pdf-page',type=int,default=11)
    args = parser.parse_args()
    if args.model.startswith('sjtu/') and args.only!=['novel']:
        parser.error('SJTU is limited to the novel integration and at most two reader lines per container')
    OUT.mkdir(parents=True, exist_ok=True)
    run = e.E2E_ROOT / ('run-layout-' + uuid.uuid4().hex[:8])
    run.mkdir()
    ext, missing = e.stage_extension(run)
    assert not missing, missing
    if args.phase == 'before':
        # Reproduce HEAD without changing this worktree or anyone else's files.
        for path in subprocess.check_output(['git','diff','--name-only','HEAD','--','extension/'],cwd=e.REPO,text=True).splitlines():
            original=subprocess.run(['git','show',f'HEAD:{path}'],cwd=e.REPO,capture_output=True)
            target=ext/path.removeprefix('extension/')
            if original.returncode==0:target.write_bytes(original.stdout)
            else:target.unlink(missing_ok=True)
    results = []
    try:
        with e.sync_playwright() as p:
            h = e.Session(p, ext, '', 'layout-live')
            h.profile.mkdir()
            try:
                h.ctx = p.chromium.launch_persistent_context(str(h.profile), headless=False,
                    args=['--headless=new', f'--disable-extensions-except={ext}', f'--load-extension={ext}', '--no-first-run'],
                    ignore_default_args=['--disable-extensions'], viewport=e.VIEWPORT,
                    proxy={'server': 'http://127.0.0.1:7897', 'bypass': '127.0.0.1,localhost'})
                h.ext_id = e.get_sw(h.ctx).url.split('/')[2]
                network=[]
                def response_seen(response):
                    if response.url.startswith('http://127.0.0.1:18790/'):
                        network.append({'path':response.url.split(':18790',1)[-1],'status':response.status})
                        print('LOCAL MODEL HTTP',response.status,flush=True)
                h.ctx.on('response',response_seen)
                provider = 'mock' if args.mock else 'gateway'
                bridge = h.ctx.new_page()
                bridge.goto(f'chrome-extension://{h.ext_id}/ui/options.html')
                bridge.evaluate("""async ({provider,model}) => {
                    const {saveSettings}=await import('../shared/settings.js');
                    await saveSettings({provider:{active:provider,chain:[{profileId:provider,model:provider==='mock'?'mock':model}],profiles:[
                      {id:'gateway',kind:'gateway',name:'Local test',baseUrl:'http://127.0.0.1:18790/v1',model,jsonMode:true,maxItems:4,maxChars:800,concurrency:2,timeoutMs:90000,fallbackModels:[]},
                      {id:'mock',kind:'mock',name:'Offline test',model:'mock',maxItems:40,maxChars:6000,concurrency:2,timeoutMs:5000,fallbackModels:[]}]},
                      comics:{language:'jpn_vert'},lazy:{rootMarginPx:100}});
                    if(model.startsWith('sjtu/')) await saveSettings({siteRules:{custom:[{match:'www.pixiv.net',include:['p:has(>span.text-count) >span.text-count:nth-of-type(-n+2)'],exclude:[]}]}});
                }""", {'provider':provider,'model':args.model})
                for name, url in URLS.items():
                    if args.only and name not in args.only:
                        continue
                    result = {'page': name, 'url': url, 'phase': args.phase, 'provider': provider,'model':args.model if provider!='mock' else 'mock'}
                    bridge.evaluate("""async()=>{const {saveSettings}=await import('../shared/settings.js');await saveSettings({displayMode:'bilingual'})}""")
                    h.page = h.ctx.new_page()
                    print(f'OPEN {name} ({args.phase}, {provider})',flush=True)
                    try:
                        target = f'chrome-extension://{h.ext_id}/pdf/viewer.html?file={quote(url,safe="")}' if name == 'pdf' else url
                        if name=='pdf' and args.pdf_file:
                            target=f'chrome-extension://{h.ext_id}/pdf/viewer.html'
                        response = h.page.goto(target, wait_until='domcontentloaded', timeout=60000)
                        if name=='pdf' and args.pdf_file:
                            result['input']='downloaded real PDF via local chooser'
                            h.page.evaluate("() => document.querySelector('#local-file').addEventListener('change',e=>window.layoutPDF=e.target.files[0],{capture:true})")
                            h.page.locator('#local-file').set_input_files(str(args.pdf_file))
                        result['http'] = response.status if response else None
                        h.page.wait_for_timeout(7000)
                        if name=='novel' and h.page.locator('p:has(> span.text-count)').count():
                            h.page.locator('p:has(> span.text-count)').first.evaluate("el=>el.scrollIntoView({block:'start'})")
                            h.page.wait_for_timeout(500)
                        if name=='pdf':
                            deadline=time.monotonic()+40
                            while time.monotonic()<deadline and not h.page.locator('.pdf-page .paragraphs p,#status.error').count():
                                h.page.wait_for_timeout(250)
                            number=min(max(1,args.pdf_page),h.page.locator('.pdf-page').count())
                            if number:
                                h.page.fill('#page-number',str(number));h.page.click('#jump')
                                h.page.locator(f'.pdf-page[data-page="{number}"] .paragraphs p').first.wait_for(timeout=30000,state='attached')
                        h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-original.png'))
                        result['title'] = h.page.title()
                        if name == 'pdf':
                            result['status'] = h.page.locator('#status').inner_text()
                            result['pages'] = h.page.locator('.pdf-page').count()
                            result['inspectedPage']=number
                            if not result['pages']:
                                raise AssertionError(result['status'])
                            # Coordinate evidence is local only, never committed or printed as source text.
                            data = h.page.evaluate("""async url=>{
                              const {readPDFURL}=await import('./source.js');
                              const lib=await import('../vendor/pdfjs/pdf.min.js');
                              const doc=await lib.getDocument({data:window.layoutPDF?new Uint8Array(await window.layoutPDF.arrayBuffer()):await readPDFURL(url),isEvalSupported:false}).promise;
                              const items=[];
                              for(let i of [1,6,7,8,9,10,11,12]) if(i<=doc.numPages) items.push({page:i,items:(await (await doc.getPage(i)).getTextContent()).items});
                              const count=doc.numPages;await doc.destroy();return {count,items};
                            }""", url)
                            (OUT / f'pdf-{args.phase}-items.json').write_text(json.dumps(data), encoding='utf-8')
                            h.page.click('#translate')
                            h.page.locator('dl-t[data-dl-state="done"],dl-t[data-dl-state="error"]').first.wait_for(timeout=150000)
                            result['translationCount'] = h.page.locator('dl-t[data-dl-state="done"]').count()
                            h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-bilingual.png'))
                            h.page.select_option('#mode','translation-only')
                            h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-only.png'))
                            if args.phase=='after':
                                h.tab_id=h.page.evaluate('async()=>(await chrome.tabs.getCurrent()).id')
                                result['popup']=inspect_popup(h,name,args.phase)
                                result['ballRestored']=restore_with_ball(h,name)
                            if h.page.locator('#restore:enabled').count():h.page.click('#restore')
                            result['restore'] = h.page.locator('dl-t,dl-o').count() == 0
                        else:
                            h.tab_id = h.sw_eval(e.JS_FIND_TAB, h.page.url)
                            h.wait_ready()
                            original_readers=h.page.locator('p:has(>span.text-count)').evaluate_all('els=>els.map(el=>el.outerHTML)') if name=='novel' else None
                            result['elements'] = h.page.evaluate("""() => ({
                              textContainers:[...document.querySelectorAll('main,article,[role=main]')].map(el=>({tag:el.tagName,cls:el.className,len:el.textContent.length,br:el.querySelectorAll('br').length})),
                              images:[...document.images].filter(i=>i.getBoundingClientRect().width>250).map(i=>({w:i.naturalWidth,h:i.naturalHeight,src:i.currentSrc.slice(0,160),parent:i.parentElement.tagName})),
                              canvases:document.querySelectorAll('canvas').length})""")
                            if name=='artwork':
                                result['imageContainers']=h.page.evaluate("""()=>[...document.images].filter(i=>i.getBoundingClientRect().width>280).map(i=>({src:i.currentSrc.slice(-35),ancestors:(()=>{let a=i;const out=[];for(let j=0;j<7&&a;j++,a=a.parentElement)out.push({tag:a.tagName,role:a.getAttribute('role'),cls:a.className,position:getComputedStyle(a).position});return out})()}))""")
                            (OUT / f'{name}-{args.phase}-structure.json').write_text(json.dumps(h.page.evaluate("""() => [...document.querySelectorAll('main *,article *')].filter(el=>el.childNodes.length>10||el.querySelectorAll(':scope > br').length>2).map(el=>({tag:el.tagName,cls:el.className,role:el.getAttribute('role'),id:el.id,len:el.textContent.length,br:el.querySelectorAll(':scope > br').length,children:[...el.children].slice(0,8).map(c=>({tag:c.tagName,cls:c.className,len:c.textContent.length}))}))"""), ensure_ascii=False, indent=2),encoding='utf-8')
                            h.command('translate-comics' if name == 'artwork' else 'toggle-page')
                            print(f'TRANSLATING {name}',flush=True)
                            deadline = time.monotonic()+160
                            while time.monotonic()<deadline:
                                h.page.wait_for_timeout(1000)
                                state=h.state() or {}
                                if (name=='novel' and h.page.locator('p:has(> span.text-count) dl-t[data-dl-state="done"]').count()>0) or (name=='artwork' and any(c['items'] or any(w in c['status'] for w in ['失败','403','无法','没有找到']) for c in state.get('comics',[]))):
                                    break
                            result['state']=h.state()
                            result['translationCount']=h.page.locator('p:has(>span.text-count) dl-t[data-dl-state="done"]').count() if name=='novel' else sum(len(c['items']) for c in (result['state'] or {}).get('comics',[]))
                            if name=='novel' and h.page.locator('p:has(> span.text-count) dl-t[data-dl-state="done"]').count():
                                h.page.locator('p:has(> span.text-count) dl-t[data-dl-state="done"]').first.evaluate("el=>el.scrollIntoView({block:'center'})")
                            if name=='artwork' and h.page.locator('dl-comic').count():
                                h.page.locator('dl-comic').first.evaluate("el=>el.scrollIntoView({block:'center'})")
                            h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-bilingual.png'))
                            if name=='novel':
                                h.command('toggle-translation-only')
                                h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-only.png'))
                            if name=='artwork':
                                h.page.set_viewport_size({'width':375,'height':812});h.page.wait_for_timeout(1500)
                                h.command('translate-comics')
                                if h.page.locator('dl-comic').count():h.page.locator('dl-comic').first.evaluate("el=>el.scrollIntoView({block:'center'})")
                                h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-narrow.png'))
                            if args.phase=='after':
                                result['popup']=inspect_popup(h,name,args.phase)
                                result['ballRestored']=restore_with_ball(h,name)
                                result['stateAfterBall']=h.state()
                            if h.page.locator('dl-t,dl-o,dl-comic').count():h.command('restore-comics' if name=='artwork' else 'toggle-page')
                            if name=='artwork' and (h.state() or {}).get('translated'):h.command('toggle-page')
                            result['restore']=h.page.locator('dl-t,dl-o,dl-comic').count()==0
                            if original_readers is not None:
                                result['readerDOMRestored']=original_readers==h.page.locator('p:has(>span.text-count)').evaluate_all('els=>els.map(el=>el.outerHTML)')
                        result['outcome']='inspected'
                    except Exception as error:
                        result['outcome']='failed'
                        result['error']=str(error)[:600]
                        h.page.screenshot(path=str(OUT / f'{name}-{args.phase}-failure.png'))
                    finally:
                        h.page.close()
                    results.append(result)
                    (OUT / f'live-{args.phase}.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                    (OUT / f'live-{args.phase}-{provider}-{int(time.time())}.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                    print(json.dumps(result,ensure_ascii=False),flush=True)
            finally:
                h.close()
    finally:
        e.remove_runtime_dir(run)
    return int(any(r['outcome']=='failed' for r in results))


if __name__=='__main__':
    raise SystemExit(main())

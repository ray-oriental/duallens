"""Offline reader layout regressions using the canonical isolated MV3 runner."""
import run_e2e as e
import json
import sys
from urllib.parse import quote

e.CASES.clear()


@e.case('comic_flow', 'Image links, narrow flow, scroll discovery, dismissed panels and exact restore')
def comic_flow(h):
    h.open('article.html')
    h.page.set_viewport_size({'width':375,'height':812})
    h.js("""base=>{
      document.body.replaceChildren();document.body.style.margin='0';
      for(let i=0;i<5;i++) {
        const figure=document.createElement('figure');figure.style.margin='16px';
        const link=document.createElement('a');link.href=base+'/comics/eng.png';
        const image=document.createElement('img');image.src=link.href+'?page='+i;image.width=340;image.height=420;image.id='comic-'+i;
        link.append(image);figure.append(link);document.body.append(figure);
      }
    }""",h.base)
    before=h.js('() => document.body.outerHTML')
    h.js("""async extension=> {
      const {ComicTranslator}=await import(extension+'/content/comics/controller.js');
      window.layoutSettings={comics:{enabled:true,language:'eng',canvasSites:[]},displayMode:'bilingual',targetLang:'zh-CN',sourceLang:'en'};
      window.layoutRecognized=[];
      const platform={kind:'userscript',translator:()=>({translateBatch(req,cb){cb(req.items.map(i=>({id:i.id,text:'【译】'+i.text})));return {done:Promise.resolve(),cancel(){}};}}),
        comics:{recognize:async req=> {window.layoutRecognized.push(req.url);return {ok:true,width:680,height:840,regions:[{text:'An original line.',confidence:90,bbox:{x0:.1,y0:.1,x1:.8,y1:.2}}]};}}};
      window.layoutComic=new ComicTranslator({platform,getSettings:()=>window.layoutSettings});window.layoutComic.start();
    }""",f'chrome-extension://{h.ext_id}')
    h.wait_js('() => window.layoutRecognized.length>0')
    assert h.js("() => !document.querySelector('a dl-comic')")
    assert h.js("() => !window.layoutRecognized.some(url=>url.endsWith('page=4'))")
    h.page.locator('#comic-4').scroll_into_view_if_needed()
    h.wait_js("() => window.layoutRecognized.some(url=>url.endsWith('page=4'))")
    h.js("() => {const entry=[...window.layoutComic.panels.values()].find(e=>e.candidate.element.id==='comic-4');window.layoutComic.close(entry);window.dispatchEvent(new Event('scroll'))}")
    h.page.wait_for_timeout(500)
    assert not h.js("() => [...window.layoutComic.panels.keys()].some(el=>el.id==='comic-4')")
    h.js('() => window.layoutComic.restore()')
    assert h.js('() => document.body.outerHTML')==before
    return '375px flow outside image link; distant image waits for scroll; close stays closed; exact source DOM'


@e.case('math_pdf', 'Formula/inline variables survive; headers/numbers excluded; non-overlapping translation')
def math_pdf(h):
    h.page=h.ctx.new_page()
    h.page.goto(f'chrome-extension://{h.ext_id}/pdf/viewer.html?file={quote(h.base+"/math-notes.pdf",safe="")}')
    h.page.locator('.pdf-page[data-page="1"] .paragraphs p').first.wait_for(state='attached')
    h.page.wait_for_timeout(400)
    h.tab_id=h.page.evaluate('async()=>(await chrome.tabs.getCurrent()).id');h.wait_ready()
    assert h.state()['ui']['floatBall']
    first=h.page.locator('.pdf-page[data-page="1"] .paragraphs')
    before=first.evaluate('el=>el.outerHTML')
    formula=first.locator('.pdf-formula').all_text_contents()
    assert any('x + y = 2' in text for text in formula),formula
    assert first.locator('.pdf-formula sup').count()==1
    assert first.locator('.pdf-math').count()>0
    h.page.click('#translate')
    h.page.locator('.pdf-page[data-page="1"] dl-t[data-dl-state="done"]').first.wait_for()
    h.page.wait_for_timeout(400)
    assert first.locator('.pdf-formula dl-t,.pdf-margin dl-t').count()==0
    assert first.locator('dl-t .pdf-math').count()>0
    assert first.locator('.pdf-formula').all_text_contents()==formula
    assert first.evaluate("""el => {const ps=[...el.querySelectorAll(':scope > p')].filter(p=>p.getBoundingClientRect().height);return ps.every((p,i)=>!i || p.getBoundingClientRect().top>=ps[i-1].getBoundingClientRect().bottom)}""")
    h.page.click('#restore');h.page.wait_for_timeout(100)
    assert first.evaluate('el=>el.outerHTML')==before
    popup=h.ctx.new_page()
    popup.add_init_script('if(globalThis.chrome?.tabs)chrome.tabs.query=async()=>[{id:'+str(h.tab_id)+',url:'+json.dumps(h.page.url)+'}];')
    popup.goto(f'chrome-extension://{h.ext_id}/ui/popup.html')
    popup.locator('#toggle:enabled').wait_for();popup.click('#toggle')
    h.page.locator('.pdf-page[data-page="1"] dl-t[data-dl-state="done"]').first.wait_for()
    popup.select_option('#mode','translation-only')
    for _ in range(100):
        if h.page.evaluate("() => document.body.classList.contains('only')"):break
        h.page.wait_for_timeout(50)
    assert h.page.evaluate("() => document.body.classList.contains('only')")
    h.command('toggle-page')
    assert not h.page.locator('dl-t').count()
    popup.close()
    return 'original math PDF; opaque inline variables; untranslatable formulas/margins; flow alignment; exact restore'


@e.case('novel_paragraphs', 'BR blank lines and block lines form natural paragraphs; exact restore')
def novel_paragraphs(h):
    h.open('pixiv-novel-like.html')
    h.js("() => window.originalReaderText=document.querySelector('#pre-wrap-reader').firstChild")
    before=h.js('() => document.body.outerHTML')
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#br-reader dl-t[data-dl-state=done]').length === 4 && document.querySelectorAll('#line-reader dl-t[data-dl-state=done]').length === 2")
    h.page.locator('#pre-wrap-reader').scroll_into_view_if_needed()
    h.wait_js("() => document.querySelectorAll('#pre-wrap-reader dl-t[data-dl-state=done]').length===2")
    assert h.js("() => [...document.querySelectorAll('#br-reader dl-t')].every(t=>t.classList.contains('dl-block'))")
    assert h.js("() => document.querySelector('#br-reader dl-t').textContent.includes('私は古い図書館')")
    h.command('toggle-translation-only')
    h.wait_js("() => document.querySelectorAll('#br-reader dl-o').length === 4")
    assert h.js("() => [...document.querySelectorAll('#br-reader dl-t')].every(t=>getComputedStyle(t).display==='block')")
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before
    assert h.js("() => document.querySelector('#pre-wrap-reader').firstChild===window.originalReaderText")
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#br-reader dl-t[data-dl-state=done]').length === 4")
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before


@e.case('novel_pixiv_scope', 'Public DOM marker scopes pixiv text to reader; vertical style and dynamic restore')
def novel_pixiv_scope(h):
    # Intercepted fixture is deliberately separate from the real-site integration runner.
    html=(e.FIXTURES/'pixiv-novel-like.html').read_text(encoding='utf-8')
    h.ctx.route('https://www.pixiv.net/novel/show.php?*',lambda route:route.fulfill(body=html,content_type='text/html'))
    h.page=h.ctx.new_page()
    h.page.goto('https://www.pixiv.net/novel/show.php?id=1')
    h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
    h.js("() => {document.querySelector('#br-reader').classList.add('vertical')}")
    before=h.js('() => document.body.outerHTML')
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#br-reader dl-t[data-dl-state=done]').length===4")
    assert h.js("() => document.querySelectorAll('nav dl-t,aside dl-t,footer dl-t,h1 dl-t').length===0")
    assert h.js("() => getComputedStyle(document.querySelector('#br-reader dl-t')).writingMode==='vertical-rl'")
    assert h.js("() => getComputedStyle(document.querySelector('#br-reader dl-t')).fontSize==='20px'")
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before
    # Dynamic added text must be rescanned as the same paragraph ranges, without nested translations.
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#br-reader dl-t[data-dl-state=done]').length===4")
    h.js("() => {const el=document.querySelector('#br-reader');el.append(document.createElement('br'),document.createElement('br'),document.createTextNode('夜の庭には、静かな風だけが残っていた。'))}")
    h.wait_js("() => document.querySelectorAll('#br-reader dl-t[data-dl-state=done]').length===5")
    assert h.js('() => document.querySelectorAll("dl-t dl-t").length')==0
    h.command('toggle-page')
    assert h.js('() => document.querySelectorAll("dl-t,dl-o,dl-w,dl-r").length')==0
    return 'BR paragraphs, line groups, body scope, vertical/font inheritance, repeat/dynamic restore'


if __name__=='__main__':
    raise SystemExit(e.main(['--mock-only','--artifacts-dir',str(e.E2E_ROOT/'layout'/'offline'),*sys.argv[1:]]))

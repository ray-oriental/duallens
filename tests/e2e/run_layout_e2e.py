"""Offline reader layout regressions using the canonical isolated MV3 runner.

PDF reader checks live in run_pdf_e2e.py (mock-only by default).
"""
import run_e2e as e
import sys

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


@e.case('novel_pixiv_scope', 'Reader and page chrome translate; vertical style and dynamic restore')
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
    h.wait_js("() => document.querySelector('nav dl-t[data-dl-state=done]')")
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


@e.case('novel_range_lazy','Tall shared reader host releases only nearby ranges, scroll discovers later lines, exact restore')
def novel_range_lazy(h):
    html='<!doctype html><meta charset="utf-8"><style>p{font:20px/8 serif;max-width:700px}p:has(dl-o){line-height:2}</style><nav>このナビゲーションは本文ではない</nav><p>'+''.join('<span class="text-count">これは小説の本文です。雨の庭を眺めていました。'+str(i)+'</span><br>' for i in range(80))+'</p>'
    h.ctx.route('https://www.pixiv.net/novel/show.php?*',lambda route:route.fulfill(body=html,content_type='text/html'))
    h.settings({'lazy':{'rootMarginPx':50}})
    h.page=h.ctx.new_page();h.page.goto('https://www.pixiv.net/novel/show.php?id=2#2')
    h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
    before=h.js('() => document.body.outerHTML')
    h.command('toggle-page');h.wait_js("() => document.querySelectorAll('dl-t[data-dl-state=done]').length>0")
    h.page.wait_for_timeout(500)
    first=h.js("() => document.querySelectorAll('dl-t[data-dl-state=done]').length")
    assert first<25,first
    h.wait_js("() => document.querySelector('nav dl-t[data-dl-state=done]')")
    h.command('toggle-translation-only')
    h.wait_js("() => document.querySelectorAll('dl-t[data-dl-state=done]').length>"+str(first))
    h.command('toggle-translation-only');h.wait_js("() => !document.querySelector('dl-o')")
    nearby=h.js("() => document.querySelectorAll('dl-t[data-dl-state=done]').length")
    h.page.locator('p > span.text-count').nth(60).scroll_into_view_if_needed()
    h.wait_js("() => document.querySelectorAll('dl-t[data-dl-state=done]').length>"+str(nearby))
    h.command('toggle-page');assert h.js('() => document.body.outerHTML')==before
    return f'first viewport/nearby translated {first}/80; contraction rechecks without scroll; distant lines wait for scroll; exact restore'

@e.case('live_navigation_reads','Real document replacement retries read, and missing line cannot borrow next line translation')
def live_navigation_reads(h):
    from run_v031_live import read,reader_snapshot
    html='<p><span class="text-count">今日はいい天気です。</span><br><span class="text-count">明日も晴れるでしょう。</span><br><dl-t data-dl-state="done">明天也会晴。</dl-t></p>'
    h.ctx.route(h.base+'/nav-start',lambda route:route.fulfill(body=html+"<script>setTimeout(()=>location.replace('/nav-stable'),150)</script>",content_type='text/html'))
    h.ctx.route(h.base+'/nav-stable',lambda route:route.fulfill(body=html,content_type='text/html'))
    h.page=h.ctx.new_page();h.page.goto(h.base+'/nav-start',wait_until='domcontentloaded')
    count=read(h.page,lambda:h.page.locator('span.text-count').evaluate_all('async els=>{await new Promise(r=>setTimeout(r,300));return els.length}'))
    assert h.page.url.endswith('/nav-stable') and count==2
    assert [p['done'] for p in reader_snapshot(h.page)['pairs']]==[False,True]
    return 'navigation-safe locator read; adjacent translated line cannot make missing line pass'

@e.case('visible_controls', 'Visible controls, attributes, adaptive layout, exact restore and settings invalidation')
def visible_controls(h):
    h.open('article.html')
    h.js("""() => {document.body.replaceChildren();
      const fixture=document.createElement('section');
      // Static fixture markup, never provider output.
      fixture.innerHTML='<nav style="display:flex;gap:12px"><a id="nav" href="#x">Home</a><button id="button" style="height:30px;white-space:nowrap">Go</button></nav><p id="prose">Read this <a href="#test">helpful page</a> for more information.</p><label id="label">Search</label><input id="search" placeholder="Search articles"><button id="icon" title="Open settings"><svg width="12" height="12"><circle cx="6" cy="6" r="5"/></svg></button><select id="select"><option value="eng">English</option><option value="deu">German</option></select><table><tr><th id="head">Language</th><td id="cell">An extended cell with useful information about this language.</td></tr></table><details open><summary id="summary">More</summary><figcaption id="caption">A useful caption.</figcaption></details><div id="clamp" style="white-space:nowrap;overflow:hidden;width:140px">Useful content</div><p id="zh">这是中文内容。</p><p id="jp">これは日本語の文章です。</p><div class="katex">Mathematics</div><div id="later" hidden>Dynamic comment</div>';
      document.body.append(fixture);
      document.querySelector('#label').style.color='color(srgb .8 .8 .8)';
      window.sourceNode=document.querySelector('#button').firstChild;
    }""")
    before=h.js('() => document.body.outerHTML')
    h.command('toggle-page')
    h.wait_js("() => document.querySelector('#cell dl-t[data-dl-state=done]') && document.querySelector('#search').placeholder.startsWith('【译】') && document.querySelector('option').label.startsWith('【译】')")
    assert h.js("() => !document.querySelector('#zh dl-t,.katex dl-t') && !!document.querySelector('#jp dl-t')")
    assert h.js("() => document.querySelector('#button dl-t').classList.contains('dl-solo') && document.querySelector('#clamp dl-t').classList.contains('dl-solo') && document.querySelector('#prose dl-t').classList.contains('dl-block')")
    assert h.js("() => document.querySelector('#icon').title.startsWith('【译】') && document.querySelector('#button').title==='Go'")
    assert h.js("() => document.querySelectorAll('#prose dl-t').length===1 && document.querySelector('#select').value==='eng'")
    assert h.js("() => getComputedStyle(document.querySelector('#label dl-t'),'::before').content.includes('·')")
    assert h.js("() => document.querySelector('#label dl-t').style.getPropertyValue('--dl-fg')==='rgb(0,0,0)'")
    h.js("() => {document.querySelector('#search').placeholder='Find books';document.querySelector('#later').hidden=false}")
    h.wait_js("() => document.querySelector('#search').placeholder==='【译】Find books' && document.querySelector('#later dl-t[data-dl-state=done]')")
    h.settings({'translation':{'mode':'mt','mt':{'engine':'mock'}}})
    h.wait_js("() => document.querySelector('#prose dl-t').getAttribute('data-dl-engine')==='mock' && document.querySelector('#search').placeholder.startsWith('【机翻】')")
    h.command('toggle-page')
    expected=before.replace('Search articles','Find books').replace('id="later" hidden=""','id="later"')
    assert h.js('() => document.body.outerHTML')==expected
    assert h.js("() => document.querySelector('#button').firstChild===window.sourceNode")
    h.settings({'translateShortText':False})
    h.page.wait_for_timeout(300)
    h.command('toggle-page')
    h.wait_js("() => document.querySelector('#prose dl-t[data-dl-state=done]')")
    assert h.js("() => !document.querySelector('#button dl-t,#label dl-t')")
    h.command('toggle-page')
    return 'controls/attributes/JP/math; constrained replacement; dynamic reveal; MT mode invalidates; exact nodes and attributes'

@e.case('novel_mobile_wrappers', 'Pixiv mobile non-p reader wrappers translate and restore')
def novel_mobile_wrappers(h):
    html='<meta charset="utf-8"><meta name="viewport" content="width=device-width"><nav>Home</nav><main><section><p><span><span id="reader"><span class="text-count">今日はいい天気です。庭を歩いていました。</span><br><span class="text-count">明日も晴れるでしょう。静かに笑いました。</span><br></span></span></p><div id="reader-div"><span class="text-count">庭には花が咲いていました。</span><br><span class="text-count">春の風を待っていました。</span><br></div></section></main>'
    h.ctx.route('https://www.pixiv.net/novel/show.php?*',lambda route:route.fulfill(body=html,content_type='text/html'))
    h.page=h.ctx.new_page();h.page.set_viewport_size({'width':375,'height':812})
    h.page.goto('https://www.pixiv.net/novel/show.php?id=3#2')
    h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
    before=h.js('() => document.body.outerHTML')
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#reader dl-t[data-dl-state=done]').length===2")
    h.wait_js("() => document.querySelectorAll('#reader-div dl-t[data-dl-state=done]').length===2")
    assert h.js("() => [...document.querySelectorAll('#reader dl-t')].every(t=>t.classList.contains('dl-block'))")
    h.command('toggle-page');assert h.js('() => document.body.outerHTML')==before
    return '375px p > span > span and div readers; four natural paragraphs; exact restore'

@e.case('compact_navigation', 'Table-based link menus, whitespace echo and constrained failure preserve layout')
def compact_navigation(h):
    h.open('article.html')
    h.page.set_viewport_size({'width':375,'height':812})
    h.js("""() => {document.body.replaceChildren();
      const table=document.createElement('table'),row=table.insertRow(),cell=row.insertCell(),span=document.createElement('span');
      for(const text of ['new','past','comments','ask','show','jobs','submit']) {const a=document.createElement('a');a.href='#'+text;a.textContent=text;span.append(a,document.createTextNode(' | '));}
      cell.append(span);document.body.append(table);
      const metadata=table.insertRow().insertCell();metadata.id='metadata';
      metadata.innerHTML='<span><span>130 points</span> by <a href="#author">Example Author</a> <span>2 hours ago</span> | <a href="#hide">hide</a> | <a href="#comments">48 comments</a></span>';
      const h=document.createElement('h1');h.textContent='Array.prototype.map()';document.body.append(h);
      const button=document.createElement('button');button.id='retry';button.title='Original tip';button.style.cssText='height:30px;white-space:nowrap';button.textContent='Retry';document.body.append(button);
    }""")
    before=h.js('() => document.body.outerHTML')
    h.js("""async extension => {
      const {PageTranslator}=await import(extension+'/content/controller.js');
      const {DEFAULT_SETTINGS}=await import(extension+'/shared/settings.js');
      let failed=false;
      const platform={coarse:true,detectLanguage:async()=>null,translator:()=>({translateBatch(req,cb){
        const timer=setTimeout(()=>cb(req.items.map(i=>{
          if(i.text==='Retry'&&!failed){failed=true;return {id:i.id,error:{code:'network',message:'fixture failure'}}}
          return {id:i.id,text:i.text==='Array.prototype.map()'?'Array.prototype.map （）':'【译】'+i.text};
        })),30);return {cancel(){clearTimeout(timer)}};
      }})};
      window.compact=new PageTranslator({getSettings:()=>DEFAULT_SETTINGS,platform});compact.start();
    }""",f'chrome-extension://{h.ext_id}')
    h.wait_js("() => compact.getState().failed===1 && document.querySelectorAll('td a dl-t[data-dl-state=done]').length===7")
    assert h.js("() => [...document.querySelectorAll('td a dl-t')].every(t=>t.classList.contains('dl-solo')) && !document.querySelector('h1 dl-t,#retry dl-t')")
    assert h.js("() => document.querySelectorAll('#metadata dl-t').length===1 && document.querySelector('#metadata dl-t').textContent.includes('130 points by Example Author')")
    h.js("() => compact.hoverToggle(document.querySelector('#retry'),'translate')")
    h.wait_js("() => document.querySelector('#retry dl-t[data-dl-state=done]')")
    h.js('() => compact.stop()')
    assert h.js('() => document.body.outerHTML')==before
    return '375px dense menu replacement; no duplicate code heading; failure preserves control; retry + exact restore'

if __name__=='__main__':
    raise SystemExit(e.main(['--mock-only','--artifacts-dir',str(e.E2E_ROOT/'layout'/'offline'),*sys.argv[1:]]))

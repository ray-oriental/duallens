#!/usr/bin/env python3
"""Mock-only segmentation, source geometry and lossless DOM regressions."""
import sys
from pathlib import Path
import run_e2e as e

e.CASES.clear()

COUNTS = "() => Object.fromEntries(['br1','wall','prewrap','pretext'].map(id=>[id,document.querySelectorAll('#'+id+' dl-t[data-dl-state=done]').length]))"

def finish(h):
    h.js("() => {for(const el of document.querySelectorAll('#br1,#wall,#prewrap'))el.scrollIntoView()}")
    for selector in ['#br1', '#wall', '#prewrap']:
        h.page.locator(selector).scroll_into_view_if_needed()
        h.wait_js("sel=>document.querySelector(sel+' dl-t[data-dl-state=done]')", arg=selector)
    h.wait_quiet()

@e.case('segmentation_modes', 'Paragraph/sentence placement, preserved source lines, settings restart, display modes and exact restore')
def segmentation_modes(h):
    h.settings({f:{'enabled':False} for f in ('floatBall','selection','hover','input','comics')})
    h.open('unsegmented.html')
    before=h.js('() => document.body.outerHTML')
    source_lines=h.js("""() => {const el=document.querySelector('#prewrap'),range=document.createRange();range.selectNodeContents(el);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size}""")
    h.js("""() => {window.originalNodes=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_ALL);for(let n;(n=w.nextNode());)originalNodes.push([n,n.parentNode,n.nodeType===3?n.data:null]);}""")
    h.command('toggle-page');finish(h)
    counts=h.js(COUNTS)
    assert counts=={'br1':13,'wall':8,'prewrap':3,'pretext':0}, str(counts)
    paragraph=counts.copy()
    assert h.js("() => getComputedStyle(document.querySelector('#prewrap')).whiteSpace==='pre-wrap'"), 'preserved white-space'
    translated_lines=h.js("""() => [...document.querySelectorAll('#prewrap dl-w')].reduce((count,w)=>{const range=document.createRange();range.setStart(w,0);range.setEndBefore(w.querySelector('dl-t'));return count+new Set([...range.getClientRects()].filter(r=>r.height>0).map(r=>Math.round(r.top))).size},0)""")
    assert translated_lines==source_lines, f'source lines {source_lines} -> {translated_lines}'
    geometry=h.js("""() => [...document.querySelectorAll('#br1 dl-w,#wall dl-w,#prewrap dl-w')].map(w=>{
      const t=w.querySelector('dl-t');if(!t)return null;
      const r=document.createRange();r.setStart(w,0);r.setEndBefore(t);
      const rects=[...r.getClientRects()].filter(r=>r.height>0),bottom=Math.max(...rects.map(r=>r.bottom));
      return {gap:t.getBoundingClientRect().top-bottom,line:parseFloat(getComputedStyle(w).lineHeight)};
    }).filter(Boolean)""")
    assert geometry and all(-2<=g['gap']<=g['line']+5 for g in geometry), str(geometry)
    assert h.js("""() => [...document.querySelectorAll('#br1 dl-w')].every(w=>{const next=w.nextElementSibling;if(next?.localName!=='dl-w')return true;const r=document.createRange();r.selectNodeContents(next.firstChild);return r.getBoundingClientRect().top-w.querySelector('dl-t').getBoundingClientRect().bottom<parseFloat(getComputedStyle(w).lineHeight)*.6})"""), 'no blank line before the next source (only the pair gap)'
    out=e.E2E_ROOT/'segmentation';out.mkdir(parents=True,exist_ok=True)
    h.page.screenshot(path=str(out/'paragraph.png'),full_page=True)
    for mode in ['translation-only','bilingual']:
        h.settings({'displayMode':mode})
        h.wait_js("mode=>[...document.querySelectorAll('#br1 dl-t')].every(t=>t.classList.contains('dl-solo')===(mode==='translation-only'))",arg=mode)
    h.settings({'segmentation':'sentence'})
    finish(h)
    counts=h.js(COUNTS)
    assert counts=={'br1':13,'wall':36,'prewrap':9,'pretext':0}, str(counts)
    h.page.screenshot(path=str(out/'sentence.png'),full_page=True)
    h.settings({'displayMode':'translation-only'})
    h.wait_js("() => [...document.querySelectorAll('#wall dl-t')].every(t=>t.classList.contains('dl-solo'))")
    h.settings({'displayMode':'bilingual'})
    h.wait_js("() => !document.querySelector('#wall dl-o:not(.dl-hide)') && [...document.querySelectorAll('#wall dl-t')].every(t=>!t.classList.contains('dl-solo'))")
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before, 'byte-exact restored body'
    assert h.js("() => originalNodes.every(([n,p,d])=>n.parentNode===p&&(d===null||n.data===d))"), 'original node identity/data/parents'
    return f'paragraph={paragraph}; sentence={counts}; source geometry, both display modes and exact restore; screenshots={out}'

@e.case('segmentation_dom', 'Direct text boundaries, inline atoms, source edits, cancelled scans and semantic exclusions')
def segmentation_dom(h):
    h.open('unsegmented.html')
    result=h.js("""async ext=>{
      const {collectRuns,iterateRuns}=await import(ext+'/content/walker.js');
      const inj=await import(ext+'/content/injector.js');
      const root=document.createElement('article');
      root.innerHTML='<p id="prose">This is the first sentence. This <em>is the second. Inside emphasis stays whole.</em> This is the last sentence.</p><h1>A title. Another title.</h1><nav>First link. Second link.</nav><table><tr><td>A table cell. Another sentence.</td></tr></table><div class="subtext">Some metadata. Another date.</div><p id="signature">Alice Example<br>\\nResearch fellow</p><div id="lines" style="white-space:pre-line">A quiet night\\nAcross the bay\\nWe sail away</div><div data-novel-content><p>First reader sentence. Second reader sentence.</p><p>Another reader paragraph. One more reader sentence.</p></div>';
      document.body.append(root);const before=root.outerHTML,em=root.querySelector('em');
      const runs=collectRuns(root,{segmentation:'sentence'}),counts={};
      for(const r of runs)counts[r.host.id||r.host.localName]=(counts[r.host.id||r.host.localName]||0)+1;
      const direct=runs.filter(r=>r.host.id==='prose');
      if(direct.length!==3||!direct.some(r=>inj.nodesOf(r).includes(em)))throw Error('inline boundaries '+direct.length);
      if(counts.signature!==1||counts.lines!==3||counts.p!==4)throw Error('signature/reader/lines '+JSON.stringify(counts));
      if(counts.h1!==1||counts.nav!==1||counts.td!==1||counts.div!==1)throw Error('semantic exclusions '+JSON.stringify(counts));
      for(const r of runs)inj.restore(r);inj.restoreTextSplits();
      if(root.outerHTML!==before||root.querySelector('em')!==em)throw Error('DOM restore');
      const changing=document.createElement('p');changing.textContent='This is the first sentence. This is the second sentence. This is the third sentence.';root.append(changing);
      const pending=inj.splitParagraphText({host:changing,first:changing.firstChild,last:changing.lastChild,whole:true},{segmentation:'sentence'});
      pending.next();pending.next();changing.firstChild.data='Website changed during the scan.';
      for(const r of pending)if(r)inj.restore(r);
      if(changing.childNodes.length!==1||changing.textContent!=='Website changed during the scan.')throw Error('scan edit lost');
      changing.remove();
      const it=iterateRuns(root,{segmentation:'sentence'});let first;
      while(!(first=it.next()).done&&!first.value){};
      if(first.value)inj.restore(first.value);inj.restoreTextSplits();
      if(root.outerHTML!==before)throw Error('cancelled scan restore');
      const edited=collectRuns(root.querySelector('#prose'),{segmentation:'sentence'});
      edited[0].first.data='Website edit wins.';
      for(const r of edited)inj.restore(r);inj.restoreTextSplits();
      if(!root.textContent.includes('Website edit wins.'))throw Error('source edit lost');
      for(const r of collectRuns(root.querySelector('#prose'),{segmentation:'sentence'}))inj.restore(r);
      inj.restoreTextSplits();
      root.remove();return counts;
    }""",f'chrome-extension://{h.ext_id}')
    return str(result)

@e.case('segmentation_article', 'Default paragraph mode retains canonical article cardinality')
def segmentation_article(h):
    h.settings({f:{'enabled':False} for f in ('floatBall','selection','hover','input','comics')})
    h.open('article.html');before=h.js('() => document.body.outerHTML')
    h.command('toggle-page');h.wait_units(e.ARTICLE_UNITS);h.wait_quiet()
    count=h.js('() => document.querySelectorAll("dl-t[data-dl-state=done]").length')
    assert count==23, f'baseline article cardinality changed: {count}'
    h.command('toggle-page');assert h.js('() => document.body.outerHTML')==before
    return f'article done units={count}'

@e.case('segmentation_retry', 'Adjacent sentences share ordered requests; failed segment retries independently')
def segmentation_retry(h):
    h.settings({f:{'enabled':False} for f in ('floatBall','selection','hover','input','comics')})
    h.open('unsegmented.html')
    h.js("""() => {document.body.innerHTML='<p id="source">This is the first sentence. This is the second sentence. This is the third sentence.<small>(example.com)</small></p>';window.retryBefore=document.body.outerHTML}""")
    h.js("""async ext=>{
      const {PageTranslator}=await import(ext+'/content/controller.js');const {DEFAULT_SETTINGS}=await import(ext+'/shared/settings.js');
      window.segmentRequests=[];let failed=false;
      window.segmentController=new PageTranslator({getSettings:()=>({...DEFAULT_SETTINGS,segmentation:'sentence',translation:{mode:'llm'},provider:{...DEFAULT_SETTINGS.provider,active:'mock'}}),platform:{detectLanguage:async()=>null,translator:()=>({translateBatch(req,cb){
        segmentRequests.push(structuredClone(req.items));const timer=setTimeout(()=>cb(req.items.map(it=>{
          if(it.text.includes('second')&&!failed){failed=true;return{id:it.id,error:{code:'parse',message:'Fixture failure'}};}
          return{id:it.id,text:'【译】'+it.text};
        })),20);return{cancel(){clearTimeout(timer)}};
      }})}});segmentController.start();
    }""",f'chrome-extension://{h.ext_id}')
    h.wait_js("() => document.querySelectorAll('#source dl-t[data-dl-state=done]').length===2&&document.querySelector('#source dl-r')")
    assert h.js("() => segmentRequests[0].length===3&&segmentRequests[0].map(it=>it.text).join('|')==='This is the first sentence.|This is the second sentence.|This is the third sentence.'"), 'same ordered context batch'
    h.page.locator('#source dl-r').click()
    h.wait_js("() => document.querySelectorAll('#source dl-t[data-dl-state=done]').length===3")
    assert h.js("() => segmentRequests.length===2&&segmentRequests[1].length===1&&segmentRequests[1][0].text.includes('second')"), 'independent retry'
    assert h.js("() => {const s=document.querySelector('#source small');return s.getBoundingClientRect().height>0&&s.nextElementSibling?.localName==='dl-t'}"), 'boundary identifier stays visible before translation'
    h.js('() => segmentController.stop()')
    assert h.js('() => document.body.outerHTML===retryBefore'), 'retry restore'
    return '3 ordered items in one mock request; retry sends only failed sentence; exact restore'

@e.case('segmentation_pixiv', 'Sentence mode retains Pixiv paragraph hosts and their original text nodes')
def segmentation_pixiv(h):
    h.settings({'segmentation':'sentence', **{f:{'enabled':False} for f in ('floatBall','selection','hover','input','comics')}})
    html='''<!doctype html><meta charset="utf-8"><p id="reader" data-novel-content><span class="text-count">We opened the library window. We listened to the distant birds.</span><br><br><span class="text-count">We read the old travel book. We remembered the summer journey.</span></p>'''
    h.ctx.route('https://www.pixiv.net/novel/show.php?*',lambda route:route.fulfill(body=html,content_type='text/html'))
    h.page=h.ctx.new_page();h.page.goto('https://www.pixiv.net/novel/show.php?id=1')
    h.tab_id=h.sw_eval(e.JS_FIND_TAB,h.page.url);h.wait_ready()
    before=h.js('() => document.body.outerHTML')
    h.js("() => window.readerNodes=[...document.querySelectorAll('.text-count')].map(n=>[n,n.firstChild,n.firstChild.data])")
    h.command('toggle-page')
    h.wait_js("() => document.querySelectorAll('#reader dl-t[data-dl-state=done]').length===4")
    assert h.js("() => readerNodes.every(([n])=>n.querySelectorAll('dl-t').length===2)"), 'paragraph hosts retained'
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before
    assert h.js("() => readerNodes.every(([n,t,data])=>n.firstChild===t&&t.data===data)"), 'reader text identity'
    return '2 original text-count hosts -> 4 sentences; original paragraphs and exact node identity restored'

@e.case('segmentation_structures', 'Long table-cell posts split, short cells stay whole, wrapper title classes do not block, BR hard wraps join to sentences')
def segmentation_structures(h):
    h.settings({f:{'enabled':False} for f in ('floatBall','selection','hover','input','comics')})
    h.open('unsegmented-structures.html')
    before=h.js('() => document.body.outerHTML')
    ids=['tdpost','tdshort','wrapped','brwrap']
    counts_js="ids => Object.fromEntries(ids.map(id=>[id,document.querySelectorAll('#'+id+' dl-t[data-dl-state=done]').length]))"
    h.command('toggle-page')
    h.wait_js("ids => ids.every(id=>document.querySelector('#'+id+' dl-t[data-dl-state=done]'))", arg=ids);h.wait_quiet()
    counts=h.js(counts_js, ids)
    # Each line of the forum post and of the wrapped dialogue ends a sentence; the address is a short cell;
    # the seven 70-column BR lines form one sentence-ended group instead of seven fragments.
    assert counts=={'tdpost':3,'tdshort':1,'wrapped':4,'brwrap':1}, str(counts)
    assert h.js("() => [...document.querySelectorAll('#brwrap dl-t')].every(t=>/news\\.$/.test(t.textContent.trim()))"), 'hard wrap translated as whole sentences'
    h.settings({'segmentation':'sentence'})
    h.wait_js("() => document.querySelectorAll('#brwrap dl-t[data-dl-state=done]').length>1");h.wait_quiet()
    sentence=h.js(counts_js, ids)
    assert sentence['tdshort']==1 and sentence['brwrap']>=4, str(sentence)
    h.command('toggle-page')
    assert h.js('() => document.body.outerHTML')==before, 'byte-exact restored body'
    return f'paragraph={counts}; sentence={sentence}; exact restore'

if __name__=='__main__':
    raise SystemExit(e.main(['--mock-only','--artifacts-dir',str(e.E2E_ROOT/'segmentation'),*sys.argv[1:]]))

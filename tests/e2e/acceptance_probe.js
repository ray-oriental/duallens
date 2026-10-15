// Test-only observer. Independent of the extension's walker and settings.minChars.
// A frozen visible Text node is one denominator item; visible placeholders and input
// button values are additional items. No attributes/markup are added to the webpage.
(() => {
  const own = 'dl-ui,dl-t,dl-o,dl-r';
  const excluded = 'script,style,noscript,template,code,pre,kbd,samp,var,math,svg,canvas,iframe,video,audio';
  const short = 'nav a,nav button,button,label,summary,[role=button],[role=tab],[role=menuitem],th';
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const eligible = s => {
    s = norm(s);
    if (!s || !/\p{L}/u.test(s) || /^(?:https?:\/\/|www\.)\S+$/i.test(s)) return false;
    // Code is an explicit hard-acceptance exception even when a website renders
    // hashes, filenames, version references or counters outside a <code> tag.
    if (/^[a-f\d]{7,40}$/i.test(s) && /\d/.test(s) ||
        /^\d+(?:\.\d+)?[kmb]\+?$/i.test(s) || /^\[v\d+\]$/i.test(s) ||
        /^arxiv:\d{4}\.\d{4,5}(?:v\d+)?$/i.test(s) ||
        /^\.[a-z][\w.-]*$/i.test(s) || /^[\w-]+\.(?:py|js|mjs|ts|tsx|jsx|json|md|rst|toml|yaml|yml|txt|html|css|c|h|cpp|hpp)$/i.test(s) ||
        /^[\w.-]+@[\w.-]+\.[a-z]{2,}$/i.test(s)) return false;
    const letters = [...s].filter(c => /\p{L}/u.test(c));
    // Han alone is treated as already Chinese; kana/Hangul are never excluded.
    if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s) &&
        letters.filter(c => /\p{Script=Han}/u.test(c)).length / letters.length >= .7) return false;
    return true;
  };
  const rect = r => ({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
  const inViewport = r => r.width > 0 && r.height > 0 && r.x < innerWidth && r.right > 0 && r.y < innerHeight && r.bottom > 0;
  function visible(el, r) {
    if (!el?.isConnected || !inViewport(r)) return false;
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility !== 'visible' || +s.opacity === 0 || p.hidden) return false;
      // Root/body overflow can propagate to the viewport. A zero-height body
      // (YouTube uses this) does not clip its painted descendants to a zero box.
      if (p!==document.body && p!==document.documentElement && /(hidden|clip|scroll|auto)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const b = p.getBoundingClientRect();
        if (r.right <= b.x || r.x >= b.right || r.bottom <= b.y || r.y >= b.bottom) return false;
      }
    }
    // Occluded text under dialogs/menus is not a visible denominator item.
    const x = Math.max(0, Math.min(innerWidth-1, (Math.max(0,r.x)+Math.min(innerWidth,r.right))/2));
    const y = Math.max(0, Math.min(innerHeight-1, (Math.max(0,r.y)+Math.min(innerHeight,r.bottom))/2));
    const top = document.elementFromPoint(x,y);
    return !top || top === el || el.contains(top) || top.contains(el);
  }
  function selector(el) {
    if (!el) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const out=[];
    for(let p=el;p && p!==document.body && out.length<6;p=p.parentElement) {
      const siblings=p.parentElement ? [...p.parentElement.children].filter(e=>e.localName===p.localName) : [];
      out.unshift(p.localName+(siblings.length>1?`:nth-of-type(${siblings.indexOf(p)+1})`:''));
      if(p.parentElement?.id) {out.unshift('#'+CSS.escape(p.parentElement.id));break;}
    }
    return out.join(' > ') || 'body';
  }
  function bodyHTML() {
    const clone=document.body.cloneNode(true);
    clone.querySelectorAll('dl-ui').forEach(e=>e.remove());
    return clone.outerHTML;
  }
  function geometry(el) {
    return {box:rect(el.getBoundingClientRect()), overflow:el.scrollWidth>el.clientWidth+2,
      display:getComputedStyle(el).display, short:el.matches(short)};
  }
  let sources=[], before=new Map(), original='', t0=0, marks={}, observer, mutationCount=0;
  let siteExclude='';
  function excludedBySite(el) {try {return !!siteExclude && !!el.closest(siteExclude);} catch {return false;}}
  function freeze(exclude='') {
    siteExclude=exclude; sources=[];before=new Map();marks={};mutationCount=0;
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    for(let n; (n=w.nextNode());) {
      const el=n.parentElement;
      if(el.closest(own+','+excluded) || excludedBySite(el) || !eligible(n.data)) continue;
      const r=document.createRange();r.selectNodeContents(n);
      const boxes=[...r.getClientRects()];
      if(!boxes.some(b=>visible(el,b))) continue;
      sources.push({node:n,el,text:n.data,selector:selector(el),type:el.localName,attribute:null});
    }
    for(const el of document.querySelectorAll('input[placeholder],textarea[placeholder],input[type=button],input[type=submit],input[type=reset]')) {
      if(el.type==='password' || excludedBySite(el) || !visible(el,el.getBoundingClientRect())) continue;
      const attribute=el.hasAttribute('placeholder')?'placeholder':'value', text=el.getAttribute(attribute);
      if(eligible(text)) sources.push({node:el,el,text,selector:selector(el),type:el.localName+'['+attribute+']',attribute});
    }
    for(const el of document.body.querySelectorAll('*')) {
      if(el.closest(own) || !visible(el,el.getBoundingClientRect())) continue;
      before.set(el,geometry(el));
    }
    original=bodyHTML();
    return {total:sources.length,items:sources.map(s=>({type:s.type,selector:s.selector,text:norm(s.text).slice(0,40)}))};
  }
  function valid(t,s) {
    return t?.matches('dl-t[data-dl-state=done]') && /\p{Script=Han}/u.test(t.textContent) &&
      norm(t.textContent)!==norm(s.text) && getComputedStyle(t).display!=='none' && getComputedStyle(t).visibility!=='hidden';
  }
  function translation(s) {
    if(s.attribute) return null;
    // Inspect the source node's own ancestor chain. Never use an arbitrary descendant
    // translation, or a translation belonging to a later sibling paragraph.
    for(let branch=s.node;branch?.parentElement && branch.parentElement!==document.documentElement;branch=branch.parentElement) {
      if(branch.nodeType===1 && !/^(inline|contents|ruby)/.test(getComputedStyle(branch).display) && branch.localName!=='dl-w') break;
      const p=branch.parentElement;
      const whole=p.getAttribute('data-dl-id');
      if(whole) {
        const t=[...p.querySelectorAll(':scope > dl-t,:scope > dl-w > dl-t')].find(t=>t.dataset.dlId===whole);
        if(valid(t,s)) return t;
      }
      let n=branch.nextSibling;
      for(;n;n=n.nextSibling) {
        if(n.nodeType!==1) continue;
        if(n.matches('dl-t')) return valid(n,s)?n:null;
        const style=getComputedStyle(n);
        // A second inline source cannot borrow the following run's translation.
        // Be conservative at BR boundaries: do not borrow the next line's result.
        if(n.localName==='br') break;
        if(!/^(inline|contents|ruby)/.test(style.display) && style.display!=='none') break;
      }
      // A block child cannot borrow a translation attached after that block.
    }
    return null;
  }
  function sample() {
    let covered=0, refined=0;
    const missing=[];
    for(const s of sources) {
      const t=translation(s);
      const attrDone=s.attribute && s.el.getAttribute(s.attribute)!==s.text && /\p{Script=Han}/u.test(s.el.getAttribute(s.attribute)||'');
      if(t || attrDone) {covered++; if(t?.dataset.dlStage==='final' && t.dataset.dlEngine==='llm') refined++;}
      else missing.push({type:s.type,selector:s.selector,text:norm(s.text).slice(0,40),reason:!s.node.isConnected?'source-detached':s.attribute?'attribute-untranslated':'no-associated-Chinese-translation'});
    }
    const elapsed=(performance.now()-t0)/1000;
    // First result must actually be visible, not an offscreen prefetch result.
    const first=[...document.querySelectorAll('dl-t[data-dl-state=done]')].some(t=>/\p{Script=Han}/u.test(t.textContent) && [...t.getClientRects()].some(r=>visible(t,r)));
    if(first && marks.t_first==null) marks.t_first=elapsed;
    if(sources.length && covered===sources.length && marks.t_fill==null) marks.t_fill=elapsed;
    if(sources.length && refined===sources.length && marks.t_final==null) marks.t_final=elapsed;
    return {...marks,total:sources.length,covered,refined,coverage:sources.length?covered/sources.length:null,missing};
  }
  function start() {
    t0=performance.now();marks={};
    observer?.disconnect();
    observer=new MutationObserver(records=>{
      for(const r of records) {
        const e=r.target.nodeType===1?r.target:r.target.parentElement;
        if(!e?.closest('dl-t,dl-r,dl-ui') && ![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1 && n.matches('dl-t,dl-r,dl-w,dl-o'))) mutationCount++;
      }
      sample();
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
  }
  function contrast(el) {
    const rgba=s=>{const c=(s.match(/[\d.]+/g)||[]).map(Number);if(s.startsWith('color(srgb '))for(let i=0;i<3;i++)c[i]*=255;return c;};
    const fg=rgba(getComputedStyle(el).color);if(fg.length<3) return null;
    let bg=[255,255,255];const layers=[];
    for(let p=el;p;p=p.parentElement) {
      if(getComputedStyle(p).backgroundImage!=='none') return null;
      layers.push(rgba(getComputedStyle(p).backgroundColor));
    }
    for(const c of layers.reverse()) if(c.length>=3) {const a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}
    const a=fg[3]??1, ink=bg.map((v,i)=>fg[i]*a+v*(1-a));
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const l1=lum(ink),l2=lum(bg);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
  }
  const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>2;
  function layout(dark=false) {
    const issues=[], seen=new Set();
    function add(type,el,detail) {const key=type+selector(el);if(seen.has(key))return;seen.add(key);issues.push({type,selector:selector(el),detail,box:rect(el.getBoundingClientRect())});}
    for(const [el,old] of before) {
      if(!el.isConnected || !visible(el,el.getBoundingClientRect())) continue;
      const now=geometry(el);
      if(now.overflow && !old.overflow) add('new-horizontal-overflow',el,{before:old.box,after:now.box,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth});
      if(old.short && old.box.height>0 && now.box.height/old.box.height>1.6) add('short-control-height-growth',el,{ratio:now.box.height/old.box.height,before:old.box.height,after:now.box.height});
      if(/flex|grid/.test(old.display)) {
        const children=[...el.children].filter(e=>before.has(e) && !e.matches('dl-t,dl-w'));
        // Detect formerly aligned siblings diverging; natural reflow is a review candidate.
        for(let i=1;i<children.length;i++) {
          const a=children[i-1],b=children[i],oa=before.get(a).box,ob=before.get(b).box;
          const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
          if(Math.abs(oa.y-ob.y)<3 && Math.abs(ra.y-rb.y)>8 && overlaps({...ra,bottom:ra.y+2},{...rb,bottom:rb.y+2})===false && rb.x>ra.x)
            add('flex-grid-alignment-review',el,{child:selector(b),beforeDelta:ob.y-oa.y,afterDelta:rb.y-ra.y});
        }
      }
    }
    const translations=[...document.querySelectorAll('dl-t[data-dl-state=done],.tb[data-stage]')].filter(t=>[...t.getClientRects()].some(r=>visible(t,r)));
    for(const t of translations) {
      const p=t.parentElement,pr=p.getBoundingClientRect();
      const outside=[...t.getClientRects()].some(r=>r.x<pr.x-2 || r.right>pr.right+2 || r.y<pr.y-2 || r.bottom>pr.bottom+2);
      if(outside) add('translation-outside-container',t,{container:selector(p)});
      if(t.hasAttribute('data-overflow')) add('pdf-block-overflow',t,{});
      if(dark) {const c=contrast(t);if(c!=null && c<4.5) add('low-dark-contrast',t,{ratio:c});}
    }
    // Compare individual text Range rects; element bounding boxes include legitimate
    // multiline whitespace. Only new collisions involving a translation are reported.
    const textRects=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    for(let n;(n=w.nextNode());) {
      const e=n.parentElement;if(!norm(n.data)||e.closest('script,style,dl-ui,.textLayer'))continue;
      const r=document.createRange();r.selectNodeContents(n);
      for(const b of r.getClientRects()) if(visible(e,b)) textRects.push({e,b:rect(b),t:e.closest('dl-t,.tb')});
    }
    for(let i=0;i<textRects.length;i++) for(let j=i+1;j<textRects.length;j++) {
      const a=textRects[i],b=textRects[j];if((!a.t&&!b.t)||a.t===b.t) continue;
      if(overlaps(a.b,b.b)) add('overlapping-text',a.t||b.t,{other:selector((a.t?b:a).e),first:a.b,second:b.b});
    }
    return issues;
  }
  function restoreResult() {
    observer?.disconnect();
    const after=bodyHTML();let at=0;while(at<Math.min(original.length,after.length)&&original[at]===after[at])at++;
    return {restore_identical:after===original,restore_diff:after===original?null:{offset:at,before:original.slice(Math.max(0,at-70),at+100),after:after.slice(Math.max(0,at-70),at+100),lengthBefore:original.length,lengthAfter:after.length},nonTranslationMutations:mutationCount};
  }
  function diagnose() {
    return sources.filter(s=>!translation(s) && !(s.attribute && s.el.getAttribute(s.attribute)!==s.text && /\p{Script=Han}/u.test(s.el.getAttribute(s.attribute)||''))).map(s=>{
      const host=s.el.closest('[data-dl-id]');
      const ancestors=[];
      for(let el=s.el;el && ancestors.length<4;el=el.parentElement) ancestors.push({tag:el.localName,display:getComputedStyle(el).display,
        translate:el.getAttribute('translate'),notranslate:el.classList.contains('notranslate'),role:el.getAttribute('role')});
      return {selector:s.selector,text:norm(s.text).slice(0,40),connected:s.node.isConnected,attribute:s.attribute,ancestors,
        markedHost:host?{selector:selector(host),state:host.dataset.dlState,translationCount:host.querySelectorAll('dl-t').length}:null,
        nearbyTranslations:[...(s.el.parentElement?.querySelectorAll(':scope > dl-t')||[])].slice(0,3).map(t=>({state:t.dataset.dlState,stage:t.dataset.dlStage,engine:t.dataset.dlEngine,text:norm(t.textContent).slice(0,40)}))};
    });
  }
  window.__dlAcceptance={eligible,visible,selector,freeze,start,sample,layout,restoreResult,bodyHTML,translation,contrast,diagnose};
})();

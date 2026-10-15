// Test-only observer. Independent of the extension's walker and settings.minChars.
// A frozen visible Text node is one denominator item; visible placeholders and input
// button values are additional items. No attributes/markup are added to the webpage.
(() => {
  const own = 'dl-ui,dl-t,dl-o,dl-r';
  const excluded = 'script,style,noscript,template,code,pre,kbd,samp,var,math,svg,canvas,iframe,video,audio';
  const short = 'nav a,nav button,button,label,summary,[role=button],[role=tab],[role=menuitem],th';
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const brands = new Set(('HTML|CSS|JavaScript|TypeScript|Python|GitHub|GitLab|MIT License|MIT|BSD|Apache License|GNU|GPL|CPython|PyPI|pip|npm|Node.js|React|Vue|Angular|Docker|Kubernetes|Linux|Windows|macOS|Android|iOS|Chrome|Chromium|Edge|Firefox|Safari|Microsoft|Google|Apple|Amazon|YouTube|Reddit|Stack Overflow|Hacker News|OpenAI|ChatGPT|Ollama|Wikipedia|Wikimedia|English|Japanese|Korean|Chinese|Rust|Go|C++|C#|Java|PHP|Ruby|Swift|Kotlin|SQL|JSON|XML|UTF-8|API|PDF|arXiv').toLowerCase().split('|'));
  // Context is required for personal names; title case alone would hide navigation.
  const person = '[rel~=author],[itemprop=author],.author,.username,.hnuser,[data-hovercard-type=user],.contributor,[itemtype$="/Person"] [itemprop=name]';
  function exception(s, el=null) {
    s = norm(s);
    if (!s || !/\p{L}/u.test(s)) return 'number-or-no-letter';
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(s)) return 'url';
    if (brands.has(s.toLowerCase())) return 'brand-product-language';
    if (el?.closest(person) || /^@[\w.-]+$/.test(s)) return 'person-or-username';
    const link=el?.closest('a[href]');
    if(link) {
      try {
        const u=new URL(link.href,location.href), tail=decodeURIComponent(u.pathname.replace(/\/$/,'').split('/').pop()||'');
        if(s.toLowerCase()===tail.toLowerCase()) return 'link-path-identifier';
        if(/(?:github\.com|gitlab\.com)$/.test(u.hostname) && /^\/[\w-]+\/?$/.test(u.pathname)) return 'person-or-username';
        if(u.hostname==='news.ycombinator.com' && u.pathname==='/user' && u.searchParams.get('id')===s) return 'person-or-username';
      } catch { /* malformed href is not evidence of an exception */ }
    }
    // Code is an explicit hard-acceptance exception even when a website renders
    // hashes, filenames, version references or counters outside a <code> tag.
    if (/^[a-f\d]{7,128}$/i.test(s) && (/\d/.test(s) || s.length>=32) ||
        /^\d+(?:\.\d+)?[kmb]\+?$/i.test(s) || /^\[v\d+\]$/i.test(s) ||
        /^arxiv:\d{4}\.\d{4,5}(?:v\d+)?$/i.test(s) ||
        /^\.[a-z][\w.-]*$/i.test(s) || /^[\w-]+\.(?:py|js|mjs|ts|tsx|jsx|json|md|rst|toml|yaml|yml|txt|html|css|c|h|cpp|hpp)$/i.test(s) ||
        /^[\w.-]+@[\w.-]+\.[a-z]{2,}$/i.test(s)) return 'identifier';
    // Internal punctuation distinguishes identifiers from sentence-final punctuation.
    if (!/\s/.test(s) && (/^[\p{L}\d@.+/_-]+$/u.test(s) && /[\p{L}\d][./_-][\p{L}\d]/u.test(s) ||
        /^[a-z][a-z\d]*(?:[A-Z][a-z\d]*)+$/.test(s) || /^v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?$/i.test(s))) return 'identifier';
    const letters = [...s].filter(c => /\p{L}/u.test(c));
    // Han alone is treated as already Chinese; kana/Hangul are never excluded.
    if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s) &&
        letters.filter(c => /\p{Script=Han}/u.test(c)).length / letters.length >= .7) return 'already-target-language';
    return null;
  }
  const eligible = s => !exception(s);
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
  let sources=[], exclusions=[], before=new Map(), original='', baseline, t0=0, marks={}, observer, mutationCount=0, attributeActivity=new Map();
  let siteExclude='';
  function excludedBySite(el) {try {return !!siteExclude && !!el.closest(siteExclude);} catch {return false;}}
  function freeze(exclude='') {
    siteExclude=exclude; sources=[];exclusions=[];before=new Map();marks={};mutationCount=0;
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    for(let n; (n=w.nextNode());) {
      const el=n.parentElement;
      if(el.closest(own) || !norm(n.data)) continue;
      const r=document.createRange();r.selectNodeContents(n);
      const boxes=[...r.getClientRects()];
      if(!boxes.some(b=>visible(el,b))) continue;
      const reason=el.closest(excluded)?'code-formula-embedded':excludedBySite(el)?'site-selector':exception(n.data,el);
      if(reason) {exclusions.push({type:el.localName,selector:selector(el),text:norm(n.data).slice(0,40),reason});continue;}
      sources.push({node:n,el,text:n.data,selector:selector(el),type:el.localName,attribute:null});
    }
    for(const el of document.querySelectorAll('input[placeholder],textarea[placeholder],input[type=button],input[type=submit],input[type=reset]')) {
      if(el.type==='password' || excludedBySite(el) || !visible(el,el.getBoundingClientRect())) continue;
      const attribute=el.hasAttribute('placeholder')?'placeholder':'value', text=el.getAttribute(attribute);
      const reason=exception(text,el);
      if(reason) exclusions.push({type:el.localName+'['+attribute+']',selector:selector(el),text:norm(text).slice(0,40),reason});
      else sources.push({node:el,el,text,selector:selector(el),type:el.localName+'['+attribute+']',attribute});
    }
    for(const el of document.body.querySelectorAll('*')) {
      if(el.closest(own) || !visible(el,el.getBoundingClientRect())) continue;
      before.set(el,geometry(el));
    }
    original=bodyHTML();
    baseline=snapshot();
    return {total:sources.length,exclusions,items:sources.map(s=>({type:s.type,selector:s.selector,text:norm(s.text).slice(0,40)}))};
  }
  function valid(t,s) {
    return s.node.isConnected && t?.isConnected && t.matches('dl-t[data-dl-state=done]') && /\p{Script=Han}/u.test(t.textContent) &&
      norm(t.textContent)!==norm(s.text) && getComputedStyle(t).display!=='none' && getComputedStyle(t).visibility!=='hidden';
  }
  function translation(s) {
    if(s.attribute) return null;
    // A matching whole-host id explicitly owns all descendant source nodes,
    // including CSS block spans (GitHub counters). This is stronger evidence
    // than the conservative unmarked run search below; never borrow by proximity.
    const host=s.node.parentElement?.closest('[data-dl-id]');
    if(host) {
      const id=host.getAttribute('data-dl-id');
      const t=[...host.querySelectorAll(':scope > dl-t,:scope > dl-w > dl-t')].find(t=>t.dataset.dlId===id);
      if(valid(t,s)) return t;
    }
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
  function sameResult(s) {
    if(!s.node.isConnected || s.attribute) return null;
    const host=s.el.closest('[data-dl-state]');
    if(!host || host.querySelector('dl-t,dl-r')) return null;
    if(host.dataset.dlState==='same') return 'mt-returned-unchanged-marker';
    // v0.4's showNothing adopts only whole hosts and leaves done + id without T.
    // Never infer from an unmarked missing item or a still-pending host.
    if(host.dataset.dlState==='done' && host.hasAttribute('data-dl-id') && !host.querySelector('[data-dl-id]'))
      return 'mt-returned-unchanged-inferred';
    return null;
  }
  function sample() {
    let covered=0, refined=0;
    const missing=[], except=[...exclusions];
    for(const s of sources) {
      const t=translation(s);
      const reason=!t && sameResult(s);
      if(reason) {except.push({type:s.type,selector:s.selector,text:norm(s.text).slice(0,40),reason});continue;}
      const attrDone=s.attribute && s.el.getAttribute(s.attribute)!==s.text && /\p{Script=Han}/u.test(s.el.getAttribute(s.attribute)||'');
      if(t || attrDone) {covered++; if(t?.dataset.dlStage==='final' && t.dataset.dlEngine==='llm') refined++;}
      else missing.push({type:s.type,selector:s.selector,text:norm(s.text).slice(0,40),reason:!s.node.isConnected?'source-detached':s.attribute?'attribute-untranslated':'no-associated-Chinese-translation'});
    }
    const elapsed=(performance.now()-t0)/1000;
    // First result must actually be visible, not an offscreen prefetch result.
    const first=[...document.querySelectorAll('dl-t[data-dl-state=done]')].some(t=>/\p{Script=Han}/u.test(t.textContent) && [...t.getClientRects()].some(r=>visible(t,r)));
    if(first && marks.t_first==null) marks.t_first=elapsed;
    const total=covered+missing.length;
    if(total && covered===total && marks.t_fill==null) marks.t_fill=elapsed;
    if(total && refined===total && marks.t_final==null) marks.t_final=elapsed;
    return {...marks,total,initial_total:sources.length,covered,refined,coverage:total?covered/total:null,missing,exclusions:except};
  }
  function start() {
    t0=performance.now();marks={};attributeActivity=new Map();
    observer?.disconnect();
    observer=new MutationObserver(records=>{
      for(const r of records) {
        const e=r.target.nodeType===1?r.target:r.target.parentElement;
        if(r.type==='attributes' && baseline.elements.has(e) && r.oldValue!==e.getAttribute(r.attributeName)) {
          const p=baseline.elements.get(e).path;
          attributeActivity.set(p+'\0'+r.attributeName,{path:p,attribute:r.attributeName});
        }
        if(!e?.closest('dl-t,dl-r,dl-ui') && ![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1 && n.matches('dl-t,dl-r,dl-w,dl-o'))) mutationCount++;
      }
      sample();
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true});
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
  // Full structural paths deliberately avoid randomized ids and extension wrappers.
  function path(el) {
    const parts=[];
    for(let e=el;e && e!==document.documentElement;e=e.parentElement) {
      const peers=e.parentElement?[...e.parentElement.children].filter(x=>x.localName===e.localName):[e];
      parts.unshift(e.localName+':'+peers.indexOf(e));
    }
    return parts.join('/');
  }
  function snapshot() {
    const elements=new Map(),texts=[];
    for(const e of [document.body,...document.body.querySelectorAll('*')]) {
      if(e.closest('dl-ui')) continue;
      elements.set(e,{path:path(e),attrs:Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]))});
    }
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    for(let n;(n=w.nextNode());) if(!n.parentElement.closest('dl-ui')) texts.push({node:n,text:n.data,path:path(n.parentElement)});
    return {elements,texts};
  }
  function restoreResult() {
    observer?.disconnect();
    const after=bodyHTML();let at=0;while(at<Math.min(original.length,after.length)&&original[at]===after[at])at++;
    const attributeChanges=[],residue=[],textChanges=[];
    for(const [e,old] of baseline.elements) {
      if(!e.isConnected) {attributeChanges.push({path:old.path,attribute:'__element_removed__'});continue;}
      const attrs=Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]));
      for(const name of new Set([...Object.keys(old.attrs),...Object.keys(attrs)])) if(old.attrs[name]!==attrs[name]) {
        attributeChanges.push({path:old.path,attribute:name,before:(old.attrs[name]??null),after:(attrs[name]??null)});
        if((['style','title','placeholder','class'].includes(name)) || name.startsWith('data-dl-')) {
          // A same-attribute control may explain ordinary style/title changes later;
          // dl-* classes/data attributes and newly empty class are never exempted.
          if(name.startsWith('data-dl-') || name==='class' && (attrs[name]==='' || (attrs[name]||'').split(/\s+/).some(c=>c.startsWith('dl-') && !(old.attrs.class||'').split(/\s+/).includes(c))))
            residue.push({path:old.path,type:'attribute',attribute:name});
        }
      }
    }
    for(const e of document.body.querySelectorAll('*')) {
      if(e.closest('dl-ui')) continue;
      if(e.localName.startsWith('dl-') && !baseline.elements.has(e)) residue.push({path:path(e),type:'element'});
      // New site-owned nodes are outside the preexisting-element contract. Only
      // extension signatures implicate them; a React-created empty class alone
      // is not proof that the extension left it behind.
      if(!baseline.elements.has(e)) for(const a of e.attributes) if(a.name.startsWith('data-dl-') || a.name==='class' && /(?:^|\s)dl-/.test(a.value)) residue.push({path:path(e),type:'new-element-attribute',attribute:a.name});
    }
    const connected=baseline.texts.filter(x=>x.node.isConnected);
    const ordered=[...connected].sort((a,b)=>a.node===b.node?0:a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    const expectedOrder=new Map(connected.map((x,i)=>[x.node,i]));
    for(let i=0;i<baseline.texts.length;i++) {
      const old=baseline.texts[i];
      const atOrder=ordered[expectedOrder.get(old.node)];
      const orderChanged=atOrder && (atOrder.node.data!==old.text || path(atOrder.node.parentElement)!==old.path);
      if(!old.node.isConnected || old.node.data!==old.text || path(old.node.parentElement)!==old.path || orderChanged)
        textChanges.push({index:i,path:old.path,text:old.text.slice(0,40),reason:!old.node.isConnected?'removed':old.node.data!==old.text?'content':path(old.node.parentElement)!==old.path?'parent-path':'order'});
    }
    return {restore_identical:!attributeChanges.length&&!textChanges.length&&!residue.length,restore_strict:after===original,
      restore_attributes:attributeChanges,restore_text_changes:textChanges,restore_residue:residue,
      restore_attribute_activity:[...attributeActivity.values()],
      restore_diff:after===original?null:{offset:at,before:original.slice(Math.max(0,at-70),at+100),after:after.slice(Math.max(0,at-70),at+100),lengthBefore:original.length,lengthAfter:after.length},nonTranslationMutations:mutationCount};
  }
  function diagnose() {
    return sources.filter(s=>!translation(s) && !sameResult(s) && !(s.attribute && s.el.getAttribute(s.attribute)!==s.text && /\p{Script=Han}/u.test(s.el.getAttribute(s.attribute)||''))).map(s=>{
      const host=s.el.closest('[data-dl-id]');
      const ancestors=[];
      for(let el=s.el;el && ancestors.length<4;el=el.parentElement) ancestors.push({tag:el.localName,display:getComputedStyle(el).display,
        translate:el.getAttribute('translate'),notranslate:el.classList.contains('notranslate'),role:el.getAttribute('role')});
      return {selector:s.selector,text:norm(s.text).slice(0,40),connected:s.node.isConnected,attribute:s.attribute,ancestors,
        markedHost:host?{selector:selector(host),state:host.dataset.dlState,translationCount:host.querySelectorAll('dl-t').length}:null,
        nearbyTranslations:[...(s.el.parentElement?.querySelectorAll(':scope > dl-t')||[])].slice(0,3).map(t=>({state:t.dataset.dlState,stage:t.dataset.dlStage,engine:t.dataset.dlEngine,text:norm(t.textContent).slice(0,40)}))};
    });
  }
  window.__dlAcceptance={eligible,exception,visible,selector,freeze,start,sample,layout,restoreResult,bodyHTML,translation,contrast,diagnose};
})();

// DOM writes for translation units (SPEC §5.6-5.7). Everything that touches the page DOM on behalf
// of a unit lives here so that restore() can promise to leave the page exactly as it was found.
//
// Unit shape (owned by controller.js): { id, host, first, last, whole, plain, state, lang,
//   tEl, oEl, wEl, hadClass, inline, peek }
// first..last are consecutive siblings. Whole units claim the host, but boundary identifiers
// may remain outside that source range; tail keeps the translation after an excluded suffix.

import {TAG_T,TAG_O,TAG_W,TAG_R} from './util.js';
import {measurePresentation} from './presentation.js';
import {prepareLayout,fitLayout,releaseLayout} from './adaptive-layout.js';

// All writes go through this hook so the mutation observer can discard its own records.
let guard=(fn)=> fn();
export function setWriteGuard(fn) {
  guard=fn;
}
export function write(fn) {
  return guard(fn);
}

const HEAVY_SEL='iframe,video,audio,input,textarea,select,canvas,object,embed';
const textSplits=new WeakMap();
const titleClaims=new WeakMap();

function claimTitle(u) {
  let rec=titleClaims.get(u.host);
  if(!rec) titleClaims.set(u.host,rec={original:u.host.getAttribute('title'),units:new Set(),written:null});
  rec.units.add(u); u.titleSaved=true;
  rec.written=[...rec.units].map(u=> u.plain).join(' ');
  u.host.setAttribute('title',rec.written);
}

function releaseTitle(u) {
  const rec=titleClaims.get(u.host);
  if(!u.titleSaved || !rec) return;
  rec.units.delete(u); u.titleSaved=false;
  if(u.host.getAttribute('title')===rec.written) {
    if(rec.units.size) {
      rec.written=[...rec.units].map(u=> u.plain).join(' ');
      u.host.setAttribute('title',rec.written);
    } else if(rec.original===null) u.host.removeAttribute('title');
    else u.host.setAttribute('title',rec.original);
  }
  if(!rec.units.size) titleClaims.delete(u.host);
}

// A pre-wrap reader can put several paragraphs in a single Text node. Retain that exact node
// and its original data; every emitted range releases its claim during restore/drop.
export function splitParagraphText(host,minChars) {
  const original=host.firstChild;
  if(original?.nodeType!==3 || original!==host.lastChild || !/\n[ \t\r]*\n/.test(original.data) ||
    !['pre-wrap','pre-line','break-spaces'].includes(getComputedStyle(host).whiteSpace)) return null;
  const data=original.data;
  const parts=data.split(/(\n[ \t\r]*\n(?:[ \t\r]*\n)*)/);
  if(parts.filter((part,i)=>i%2===0 && part.trim().length>=minChars && /\p{L}/u.test(part)).length<2) return null;
  const rec={original,data,nodes:[],active:new Set(),host};
  const runs=[];
  write(()=> {
    parts.forEach((part,i)=> {
      const node=i===0?original:document.createTextNode(part);
      if(i===0) node.data=part;else host.append(node);
      rec.nodes.push({node,data:part});
      if(i%2===0 && part.trim().length>=minChars && /\p{L}/u.test(part)) {
        rec.active.add(node);textSplits.set(node,rec);
        runs.push({host,first:node,last:node,whole:false});
      }
    });
  });
  return runs;
}

function releaseTextSplit(u) {
  const rec=textSplits.get(u.first);
  if(!rec) return;
  textSplits.delete(u.first);rec.active.delete(u.first);
  if(rec.active.size) return;
  // A webpage edit wins over restoration of our own temporary split.
  if(rec.nodes.some(({node,data})=>node.parentNode!==rec.host || node.data!==data)) return;
  rec.original.data=rec.data;
  for(const {node} of rec.nodes) if(node!==rec.original) node.remove();
}

export function nodesOf(u) {
  const out=[];
  for(let n=u.first; n; n=n.nextSibling) {
    out.push(n);
    if(n===u.last) break;
  }
  return out;
}

// True while the unit's own nodes are still where we found them.
export function intact(u) {
  if(u.attribute) return u.host.isConnected;
  if(!u.host.isConnected || !u.first.isConnected || !u.last.isConnected) return false;
  return u.first.parentNode===u.last.parentNode;
}

// Claims the host element of a whole unit; pristine until the first translation step touches it.
function adopt(u) {
  if(!u.whole || u.adopted) return;
  u.adopted=true;
  u.hadClass=u.host.hasAttribute('class');
  u.hadOnlyClass=u.host.classList.contains('dl-only');
  u.originalId=u.host.getAttribute('data-dl-id');
  u.originalState=u.host.getAttribute('data-dl-state');
  u.host.setAttribute('data-dl-id',u.id);
}

function setHostState(u,state) {
  if(u.whole) u.host.setAttribute('data-dl-state',state);
  if(u.wEl) u.wEl.setAttribute('data-dl-state',state);
}

function createT(u) {
  const t=document.createElement(TAG_T);
  t.setAttribute('data-dl-id',u.id);
  t.setAttribute('translate','no'); // keep browser-level translators away from our output
  if(u.lang) t.setAttribute('lang',u.lang);
  return t;
}

// flex/grid hosts would lay the translation out beside the text instead of below it, so the unit
// and its translation are wrapped into one block-level item.
function ensureWrapper(u) {
  if(u.wEl || u.wChecked) return;
  u.wChecked=true;
  // flexHost is measured by the controller in its read phase to avoid forced style recalculation
  const flex=u.flexHost ?? /flex|grid/.test(getComputedStyle(u.host).display);
  if(u.whole&&(!flex||u.presentation!=='block')) return;
  const parent=u.first.parentNode;
  const nodes=nodesOf({first:u.first,last:u.tail||u.last});
  const w=document.createElement(TAG_W);
  w.setAttribute('data-dl-id',u.id);
  if(!u.whole) w.style.display=u.presentation==='block'?'block':'inline';
  parent.insertBefore(w,u.first);
  for(const n of nodes) w.appendChild(n);
  u.wEl=w;
}

function place(u,t) {
  const anchor=u.tail&&(u.tail.parentNode===u.host||u.tail.parentNode===u.wEl)?u.tail:u.oEl||u.last;
  anchor.parentNode.insertBefore(t,anchor.nextSibling);
}

function ensureT(u) {
  adopt(u);
  ensureWrapper(u);
  if(!u.tEl || !u.tEl.isConnected) {
    u.tEl=createT(u);
    place(u,u.tEl);
  }
  return u.tEl;
}

function hasHeavy(u) {
  for(const n of nodesOf(u)) {
    if(n.nodeType===1 &&(n.matches(HEAVY_SEL) || n.querySelector(HEAVY_SEL))) return true;
  }
  return false;
}

function wrapOriginal(u) {
  if(u.oEl || hasHeavy(u)) return;
  const parent=u.first.parentNode;
  const nodes=nodesOf(u);
  const o=document.createElement(TAG_O);
  o.className='dl-hide';
  parent.insertBefore(o,u.first);
  for(const n of nodes) o.appendChild(n);
  u.oEl=o;
}

function unwrap(wrapper) {
  const parent=wrapper.parentNode;
  if(!parent) return;
  while(wrapper.firstChild) parent.insertBefore(wrapper.firstChild,wrapper);
  wrapper.remove();
}

function unwrapOriginal(u) {
  if(!u.oEl) return;
  unwrap(u.oEl);
  u.oEl=null;
}

function cleanHostClass(u) {
  if(!u.whole) return;
  const h=u.host;
  h.classList.toggle('dl-only',!!u.hadOnlyClass);
  if(!u.hadClass && h.getAttribute('class')==='') h.removeAttribute('class');
}

export function markPending(u) {
  if(u.attribute) return;
  if(!u.layoutGroup) prepareLayout(u);
  write(()=> {
    const t=ensureT(u);
    t.className='dl-t dl-inline';
    t.setAttribute('data-dl-state','pending');
    t.replaceChildren();
    setHostState(u,'pending');
  });
}

export function decideInline(u,inlineMaxChars) {
  if(u.layoutFacts?.metadata) return true;
  // Virtual paragraphs in a line-break reader must remain separate even for short dialogue.
  if(!u.whole &&(u.host.querySelector(':scope > br') || u.host.matches('[data-novel-content]'))) return false;
  if(textSplits.has(u.first)) return false;
  return(u.presentation || measurePresentation(u,inlineMaxChars)) !=='block';
}

// mode: 'bilingual' | 'translation-only'. stage: 'draft' (machine translation, an LLM result is
// expected) | 'final'. A refinement reuses the same <dl-t> and class list: only its text changes.
export function showTranslation(u,fragment,{mode,style,inlineMaxChars,stage='final',engine='llm'}) {
  if(!u.attribute && !u.layoutGroup) prepareLayout(u);
  write(()=> {
    if(u.attribute) {
      // No markup, child nodes or form values are inserted into a visible attribute.
      const current=u.host.getAttribute(u.attribute);
      if(current !==(u.attributeWritten ?? u.originalAttribute)) return;
      u.attributeWritten=(u.attribute==='label'&&mode==='bilingual'?u.source+' · ':'')+fragment.textContent;
      u.host.setAttribute(u.attribute,u.attributeWritten);
      return;
    }
    const t=ensureT(u);
    u.inline=decideInline(u,inlineMaxChars);
    t.className=`dl-t ${u.inline ? 'dl-inline' : 'dl-block'} dl-s-${style}`;
    if(u.translationColor) t.style.setProperty('--dl-fg',u.translationColor);
    t.setAttribute('data-dl-state','done');
    t.setAttribute('data-dl-stage',stage);
    t.setAttribute('data-dl-engine',engine);
    t.setAttribute('data-dl-presentation',u.presentation ||(u.inline ? 'inline':'block'));
    t.replaceChildren(fragment);
    setHostState(u,'done');
    applyMode(u,mode);
    fitLayout(u,u=>applyMode(u,mode));
  });
}

export function setStage(u,stage,engine) {
  if(u.tEl) write(()=> {
    u.tEl.setAttribute('data-dl-stage',stage);
    if(engine) u.tEl.setAttribute('data-dl-engine',engine);
  });
}
export function refit(u,mode) {if(u.tEl)fitLayout(u,x=>applyMode(x,mode));}

// Translation identical to the source: nothing to show.
export function showNothing(u) {
  if(u.attribute) return;
  write(()=> {
    if(u.tEl) u.tEl.remove();
    u.tEl=null;
    unwrapOriginal(u);
    cleanHostClass(u);
    releaseTitle(u);
    releaseLayout(u);
    adopt(u);
    setHostState(u,'same');
  });
}

export function markError(u,message) {
  if(u.attribute) return;
  // A touch-sized retry button cannot fit a single-line menu or icon button. Leave the
  // original control usable; page state still reports the error and hover can retry it.
  if(u.layoutFacts?.interactive) {restore(u); return;}
  write(()=> {
    const t=ensureT(u);
    t.className='dl-t dl-inline';
    t.setAttribute('data-dl-state','error');
    const r=document.createElement(TAG_R);
    r.setAttribute('role','button');
    r.setAttribute('tabindex','0');
    r.setAttribute('aria-label','重试翻译');
    r.setAttribute('title',`翻译失败：${message || '未知错误'}（点击重试）`);
    r.textContent='↻';
    t.replaceChildren(r);
    setHostState(u,'error');
  });
}

function applyMode(u,mode) {
  const t=u.tEl;
  if(!t) return;
  const replace=u.presentation==='replace';
  if(replace && !u.titleSaved) claimTitle(u);
  const solo=(mode==='translation-only' || replace) && u.state==='done';
  if(solo) {
    wrapOriginal(u);
    // hasHeavy() may have refused to wrap; then the translation stays beside the original
    const hidden=!!u.oEl;
    t.classList.toggle('dl-solo',hidden);
    if(u.whole) u.host.classList.toggle('dl-only',hidden || !!u.hadOnlyClass);
  } else {
    unwrapOriginal(u);
    t.classList.remove('dl-solo');
    cleanHostClass(u);
  }
  applyPeek(u);
}

export function setMode(u,mode) {
  if(u.state !=='done' || !u.tEl) return;
  write(()=> applyMode(u,mode));
}

export function setStyle(u,style) {
  if(!u.tEl) return;
  write(()=> {
    const t=u.tEl;
    t.className=t.className.replace(/\bdl-s-\S+/,`dl-s-${style}`);
  });
}

function applyPeek(u) {
  if(u.tEl) {
    if(u.peek) u.tEl.setAttribute('data-dl-peek','');
    else u.tEl.removeAttribute('data-dl-peek');
  }
  if(u.oEl) u.oEl.classList.toggle('dl-peek',!!u.peek);
}

// Temporarily swaps what is visible: in bilingual mode the translation is hidden, in
// translation-only mode the original comes back.
export function setPeek(u,on) {
  u.peek=!!on;
  write(()=> applyPeek(u));
}

// Puts the DOM back exactly as the page had it.
export function restore(u) {
  write(()=> {
    if(u.attribute) {
      if(u.attributeWritten !==undefined && u.host.getAttribute(u.attribute)===u.attributeWritten) {
        if(u.originalAttribute===null) u.host.removeAttribute(u.attribute);
        else u.host.setAttribute(u.attribute,u.originalAttribute);
      }
      return;
    }
    if(u.tEl) u.tEl.remove();
    unwrapOriginal(u);
    if(u.wEl) {
      unwrap(u.wEl);
      u.wEl=null;
    }
    if(u.whole && u.adopted) {
      const h=u.host;
      if(u.originalId===null) h.removeAttribute('data-dl-id'); else h.setAttribute('data-dl-id',u.originalId);
      if(u.originalState===null) h.removeAttribute('data-dl-state'); else h.setAttribute('data-dl-state',u.originalState);
      cleanHostClass(u);
    }
    u.tEl=null;
    u.wChecked=false;
    u.adopted=false;
    releaseTitle(u);
    releaseLayout(u);
    releaseTextSplit(u);
  });
}

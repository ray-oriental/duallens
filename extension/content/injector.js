import { t as l10n } from '../shared/i18n.js';
// DOM writes for translation units (SPEC §5.6-5.7). Everything that touches the page DOM on behalf
// of a unit lives here so that restore() can promise to leave the page exactly as it was found.
//
// Unit shape (owned by controller.js): { id, host, first, last, whole, plain, state, lang,
//   tEl, oEl, wEl, hadClass, inline, peek }
// first..last are consecutive siblings. Whole units claim the host, but boundary identifiers
// may remain outside that source range; tail keeps the translation after an excluded suffix.

import {TAG_T,TAG_O,TAG_W,TAG_R} from './util.js';
import {lineParts,proseParts} from '../shared/segmentation.js';
import {measurePresentation,normalizeStyle} from './presentation.js';
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
const splitClaims=new WeakMap();
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

// Split only direct Text children. Inline elements are opaque: a boundary inside one advances
// to its end. Retain text identity/data and all claims, including a cancelled scan's unconsumed runs.
const splitRecords=new Set();
const PRESERVE_SPACE=new Set(['pre-wrap','pre-line','break-spaces']);
function restoreSplit(rec) {
  if(rec.nodes.every(({node,data},i)=>node.parentNode===rec.host && node.data===data && (!i || rec.nodes[i-1].node.nextSibling===node))) {
    rec.original.data=rec.data;
    for(const {node} of rec.nodes) if(node!==rec.original)node.remove();
  }
  for(const {node} of rec.nodes) textSplits.delete(node);
  splitRecords.delete(rec);
}
export function restoreTextSplits(owner) {for(const rec of splitRecords)if(!owner || rec.owner===owner)restoreSplit(rec);}

const NO_SPLIT='h1,h2,h3,h4,h5,h6,button,label,summary,nav,header,menu,select,th,[role="button"],[role="tab"],[role="menuitem"],[role="navigation"],.subtext,.comhead,[class~="metadata"]';
// Class names are only trusted close to the host; an article wrapper such as .has-post-title is not a heading.
const TITLE_CLASS='[class*="title" i],[class*="headline" i],[class*="heading" i]';
export function* splitParagraphText(run,opts={}) {
  const {host,first,last}=run;
  if(run.metadata || opts.known?.(host,first) || host.closest(NO_SPLIT) || host.matches(TITLE_CLASS) || host.parentElement?.matches(TITLE_CLASS) ||
    host.localName==='a' && host.textContent.length<120) {yield run;return;}
  const nodes=[];let text='';
  for(let n=first;n;n=n.nextSibling) {
    yield null;
    const data=n.nodeType===3?n.data:n.nodeType===1?(n.localName==='br'?'\n':n.textContent):'';
    nodes.push({node:n,data,start:text.length,end:text.length+data.length});text+=data;
    if(n===last)break;
  }
  // Old forums keep whole posts in table cells; short cells stay intact so tables keep their shape.
  if(host.closest('td') && text.trim().length<160) {yield run;return;}
  const preserve=/\n/.test(text) && PRESERVE_SPACE.has(getComputedStyle(host).whiteSpace);
  const paragraphGaps=preserve && /\n[ \t\r]*\n/.test(text);
  const breaks=nodes.some(x=>x.node.localName==='br');
  // Outside preserved whitespace only a BR is a line end; markup newlines render as spaces.
  // Same-length substitution keeps every offset valid for the cuts below.
  const view=preserve?text:nodes.map(x=>x.node.localName==='br'?'\n':x.data.replace(/[\r\n]/g,' ')).join('');
  let groups=preserve||breaks?lineParts(view):[view];
  groups=groups.flatMap(part=>proseParts(part,opts.segmentation));
  if(groups.length<2) {yield run;return;}
  const cuts=new Set([0,text.length]);let pos=0;
  let nodeIndex=0;
  for(const part of groups.slice(0,-1)) {
    yield null;
    pos+=part.length;
    while(nodeIndex<nodes.length-1 && nodes[nodeIndex].end<=pos)nodeIndex++;
    const atom=nodes[nodeIndex];
    cuts.add(atom.start<pos&&pos<atom.end&&atom.node.nodeType!==3?atom.end:pos);
  }
  const bounds=[...cuts].sort((a,b)=>a-b);
  if(bounds.length<3) {yield run;return;}
  // Keep separator whitespace outside the source range; it will be hidden only while a unit
  // is displayed, so a preserved newline/BR does not add an empty row after the translation.
  let trimIndex=0;
  for(let i=1;i<bounds.length;i++) {
    yield null;
    const a=bounds[i-1],b=bounds[i],trim=text.slice(a,b).match(/\s+$/)?.[0].length||0;
    while(trimIndex<nodes.length-1 && nodes[trimIndex].end<=b-trim)trimIndex++;
    const atom=nodes[trimIndex];
    if(trim && b-trim>a && !(atom.node.nodeType!==3&&atom.start<b-trim&&b-trim<atom.end)) cuts.add(b-trim);
  }
  // Cooperative checkpoints may let the site replace or edit this run before our write phase.
  if(nodes.some(({node,data},i)=>node.parentNode!==host || node.nodeType===3 && node.data!==data || i && nodes[i-1].node.nextSibling!==node)) {yield run;return;}
  const pieces=[];
  const sortedCuts=[...cuts].sort((a,b)=>a-b);let cutIndex=0;
  write(()=> {
    for(const entry of nodes) {
      const {node,start,end}=entry;
      const local=[];
      while(cutIndex<sortedCuts.length && sortedCuts[cutIndex]<=start)cutIndex++;
      while(cutIndex<sortedCuts.length && sortedCuts[cutIndex]<end)local.push(sortedCuts[cutIndex++]-start);
      if(node.nodeType!==3 || !local.length) {pieces.push({...entry});continue;}
      const data=node.data,rec={original:node,data,host:node.parentNode,nodes:[],active:new Set(),owner:opts.splitOwner};
      splitRecords.add(rec);
      let previous=0,current=node;
      for(const offset of [...local,data.length]) {
        const value=data.slice(previous,offset);current.data=value;
        rec.nodes.push({node:current,data:value});textSplits.set(current,rec);
        pieces.push({node:current,start:start+previous,end:start+offset});
        if(offset<data.length) {const next=host.ownerDocument.createTextNode('');current.after(next);current=next;}
        previous=offset;
      }
    }
  });
  const runs=[];let pieceIndex=0;
  for(let i=1;i<bounds.length;i++) {
    const group=[];
    while(pieceIndex<pieces.length && pieces[pieceIndex].end<=bounds[i])group.push(pieces[pieceIndex++]);
    const content=group.filter(x=>x.node.nodeType===1?x.node.localName!=='br':/\S/.test(x.node.data||''));
    if(!content.length) {if(runs.length)runs.at(-1).tail=group.at(-1)?.node||runs.at(-1).tail;continue;}
    const a=content[0].node,b=content.at(-1).node,tail=group.at(-1).node;
    const r={...run,first:a,last:b,tail:tail===b||paragraphGaps?undefined:tail,whole:false,paragraph:true,segmented:true};
    if(i===bounds.length-1 && run.tail)r.tail=run.tail;
    const claims=new Set();
    for(const x of group) {const rec=textSplits.get(x.node);if(rec){rec.active.add(a);claims.add(rec);}}
    splitClaims.set(a,claims);
    runs.push(r);
  }
  for(const r of runs)yield r;
}

function releaseTextSplit(u) {
  for(const rec of splitClaims.get(u.first)||[]) {
    rec.active.delete(u.first);
    if(!rec.active.size)restoreSplit(rec);
  }
  splitClaims.delete(u.first);
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
  // Keep the site's chosen fonts first; only missing CJK glyphs use our local fallbacks.
  const family=getComputedStyle(u.host).fontFamily;
  t.style.fontFamily=family+',"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
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
  if(u.segmented && u.tail && nodesOf({first:u.last.nextSibling,last:u.tail}).every(n=>
    n.nodeType===3&&!/\S/.test(n.data)||n.localName==='br')) {
    const separator=document.createElement(TAG_O);separator.className='dl-hide';
    w.insertBefore(separator,u.last.nextSibling);
    while(separator.nextSibling)separator.append(separator.nextSibling);
    u.separatorEl=separator;
  }
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

// A paragraph still pending after WAIT_MS gets data-dl-wait; content.css then draws a quiet "…".
// Nothing is shown earlier, so fast results never flash and no placeholder ever changes layout.
const WAIT_MS=1500;
export function markPending(u) {
  if(u.attribute) return;
  if(!u.layoutGroup) prepareLayout(u);
  write(()=> {
    const t=ensureT(u);
    t.className='dl-t dl-inline';
    t.setAttribute('data-dl-state','pending');
    t.removeAttribute('data-dl-wait');
    t.replaceChildren();
    setHostState(u,'pending');
    clearTimeout(u.waitTimer);
    u.waitTimer=setTimeout(()=> {
      if(u.tEl===t && t.getAttribute('data-dl-state')==='pending') write(()=>t.setAttribute('data-dl-wait',''));
    },WAIT_MS);
  });
}

export function decideInline(u,inlineMaxChars) {
  if(u.layoutFacts?.metadata) return true;
  // Virtual paragraphs in a line-break reader must remain separate even for short dialogue.
  if(u.segmented)return false;
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
    t.className=`dl-t ${u.inline ? 'dl-inline' : 'dl-block'}${u.segmented ? ' dl-seg':''} dl-s-${normalizeStyle(style)}`;
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
    r.setAttribute('aria-label',l10n('m4r'));
    r.setAttribute('title',l10n('m4t', [message || l10n('m4s')]));
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
    t.className=t.className.replace(/\bdl-s-\S+/,`dl-s-${normalizeStyle(style)}`);
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
    if(u.separatorEl) {unwrap(u.separatorEl);u.separatorEl=null;}
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

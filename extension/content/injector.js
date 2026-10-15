// DOM writes for translation units (SPEC §5.6-5.7). Everything that touches the page DOM on behalf
// of a unit lives here so that restore() can promise to leave the page exactly as it was found.
//
// Unit shape (owned by controller.js): { id, host, first, last, whole, plain, state, lang,
//   tEl, oEl, wEl, hadClass, inline, peek }
// first..last are consecutive siblings; for a whole unit they span every child of host.

import { TAG_T, TAG_O, TAG_W, TAG_R } from './util.js';
import { measurePresentation } from './presentation.js';

// All writes go through this hook so the mutation observer can discard its own records.
let guard = (fn) => fn();
export function setWriteGuard(fn) {
  guard = fn;
}
export function write(fn) {
  return guard(fn);
}

const HEAVY_SEL = 'iframe,video,audio,input,textarea,select,canvas,object,embed';
const textSplits = new WeakMap();
const titleClaims = new WeakMap();

function claimTitle(unit) {
  let record = titleClaims.get(unit.host);
  if (!record) titleClaims.set(unit.host, record = { original: unit.host.getAttribute('title'), units: new Set(), written: null });
  record.units.add(unit); unit.titleSaved = true;
  record.written = [...record.units].map(u => u.plain).join(' ');
  unit.host.setAttribute('title', record.written);
}

function releaseTitle(unit) {
  const record = titleClaims.get(unit.host);
  if (!unit.titleSaved || !record) return;
  record.units.delete(unit); unit.titleSaved = false;
  if (unit.host.getAttribute('title') === record.written) {
    if (record.units.size) {
      record.written = [...record.units].map(u => u.plain).join(' ');
      unit.host.setAttribute('title', record.written);
    } else if (record.original === null) unit.host.removeAttribute('title');
    else unit.host.setAttribute('title', record.original);
  }
  if (!record.units.size) titleClaims.delete(unit.host);
}

// A pre-wrap reader can put several paragraphs in a single Text node. Retain that exact node
// and its original data; every emitted range releases its claim during restore/drop.
export function splitParagraphText(host, minChars) {
  const original=host.firstChild;
  if(original?.nodeType!==3 || original!==host.lastChild || !/\n[ \t\r]*\n/.test(original.data) ||
    !['pre-wrap','pre-line','break-spaces'].includes(getComputedStyle(host).whiteSpace)) return null;
  const data=original.data;
  const parts=data.split(/(\n[ \t\r]*\n(?:[ \t\r]*\n)*)/);
  if(parts.filter((part,i)=>i%2===0 && part.trim().length>=minChars && /\p{L}/u.test(part)).length<2) return null;
  const record={original,data,nodes:[],active:new Set(),host};
  const runs=[];
  write(()=> {
    parts.forEach((part,i)=> {
      const node=i===0?original:document.createTextNode(part);
      if(i===0) node.data=part;else host.append(node);
      record.nodes.push({node,data:part});
      if(i%2===0 && part.trim().length>=minChars && /\p{L}/u.test(part)) {
        record.active.add(node);textSplits.set(node,record);
        runs.push({host,first:node,last:node,whole:false});
      }
    });
  });
  return runs;
}

function releaseTextSplit(unit) {
  const record=textSplits.get(unit.first);
  if(!record) return;
  textSplits.delete(unit.first);record.active.delete(unit.first);
  if(record.active.size) return;
  // A webpage edit wins over restoration of our own temporary split.
  if(record.nodes.some(({node,data})=>node.parentNode!==record.host || node.data!==data)) return;
  record.original.data=record.data;
  for(const {node} of record.nodes) if(node!==record.original) node.remove();
}

export function nodesOf(unit) {
  const out = [];
  for (let n = unit.first; n; n = n.nextSibling) {
    out.push(n);
    if (n === unit.last) break;
  }
  return out;
}

// True while the unit's own nodes are still where we found them.
export function intact(unit) {
  if (unit.attribute) return unit.host.isConnected;
  if (!unit.host.isConnected || !unit.first.isConnected || !unit.last.isConnected) return false;
  return unit.first.parentNode === unit.last.parentNode;
}

// Claims the host element of a whole unit; pristine until the first translation step touches it.
function adopt(unit) {
  if (!unit.whole || unit.adopted) return;
  unit.adopted = true;
  unit.hadClass = unit.host.hasAttribute('class');
  unit.hadOnlyClass = unit.host.classList.contains('dl-only');
  unit.originalId = unit.host.getAttribute('data-dl-id');
  unit.originalState = unit.host.getAttribute('data-dl-state');
  unit.host.setAttribute('data-dl-id', unit.id);
}

function setHostState(unit, state) {
  if (unit.whole) unit.host.setAttribute('data-dl-state', state);
}

function createT(unit) {
  const t = document.createElement(TAG_T);
  t.setAttribute('data-dl-id', unit.id);
  t.setAttribute('translate', 'no'); // keep browser-level translators away from our output
  if (unit.lang) t.setAttribute('lang', unit.lang);
  return t;
}

// flex/grid hosts would lay the translation out beside the text instead of below it, so the unit
// and its translation are wrapped into one block-level item.
function ensureWrapper(unit) {
  if (unit.wEl || unit.wChecked) return;
  unit.wChecked = true;
  // flexHost is measured by the controller in its read phase to avoid forced style recalculation
  const flex = unit.flexHost ?? /flex|grid/.test(getComputedStyle(unit.host).display);
  if (!flex) return;
  const parent = unit.first.parentNode;
  const nodes = nodesOf(unit);
  const w = document.createElement(TAG_W);
  parent.insertBefore(w, unit.first);
  for (const n of nodes) w.appendChild(n);
  unit.wEl = w;
}

function place(unit, t) {
  const anchor = unit.oEl || unit.last;
  anchor.parentNode.insertBefore(t, anchor.nextSibling);
}

function ensureT(unit) {
  adopt(unit);
  ensureWrapper(unit);
  if (!unit.tEl || !unit.tEl.isConnected) {
    unit.tEl = createT(unit);
    place(unit, unit.tEl);
  }
  return unit.tEl;
}

function hasHeavy(unit) {
  for (const n of nodesOf(unit)) {
    if (n.nodeType === 1 && (n.matches(HEAVY_SEL) || n.querySelector(HEAVY_SEL))) return true;
  }
  return false;
}

function wrapOriginal(unit) {
  if (unit.oEl || hasHeavy(unit)) return;
  const parent = unit.first.parentNode;
  const nodes = nodesOf(unit);
  const o = document.createElement(TAG_O);
  o.className = 'dl-hide';
  parent.insertBefore(o, unit.first);
  for (const n of nodes) o.appendChild(n);
  unit.oEl = o;
}

function unwrap(wrapper) {
  const parent = wrapper.parentNode;
  if (!parent) return;
  while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
  wrapper.remove();
}

function unwrapOriginal(unit) {
  if (!unit.oEl) return;
  unwrap(unit.oEl);
  unit.oEl = null;
}

function cleanHostClass(unit) {
  if (!unit.whole) return;
  const h = unit.host;
  h.classList.toggle('dl-only', !!unit.hadOnlyClass);
  if (!unit.hadClass && h.getAttribute('class') === '') h.removeAttribute('class');
}

export function markPending(unit) {
  if (unit.attribute) return;
  write(() => {
    const t = ensureT(unit);
    t.className = 'dl-t dl-inline';
    t.setAttribute('data-dl-state', 'pending');
    t.replaceChildren();
    setHostState(unit, 'pending');
  });
}

export function decideInline(unit, inlineMaxChars) {
  // Virtual paragraphs in a line-break reader must remain separate even for short dialogue.
  if (!unit.whole && (unit.host.querySelector(':scope > br') || unit.host.matches('[data-novel-content]'))) return false;
  if(textSplits.has(unit.first)) return false;
  return (unit.presentation || measurePresentation(unit, inlineMaxChars)) !== 'block';
}

// mode: 'bilingual' | 'translation-only'. stage: 'draft' (machine translation, an LLM result is
// expected) | 'final'. A refinement reuses the same <dl-t> and class list: only its text changes.
export function showTranslation(unit, fragment, { mode, style, inlineMaxChars, stage = 'final', engine = 'llm' }) {
  write(() => {
    if (unit.attribute) {
      // No markup, child nodes or form values are inserted into a visible attribute.
      const current = unit.host.getAttribute(unit.attribute);
      if (current !== (unit.attributeWritten ?? unit.originalAttribute)) return;
      unit.attributeWritten = fragment.textContent;
      unit.host.setAttribute(unit.attribute, unit.attributeWritten);
      return;
    }
    const t = ensureT(unit);
    unit.inline = decideInline(unit, inlineMaxChars);
    t.className = `dl-t ${unit.inline ? 'dl-inline' : 'dl-block'} dl-s-${style}`;
    if (unit.translationColor) t.style.setProperty('--dl-fg', unit.translationColor);
    t.setAttribute('data-dl-state', 'done');
    t.setAttribute('data-dl-stage', stage);
    t.setAttribute('data-dl-engine', engine);
    t.setAttribute('data-dl-presentation', unit.presentation || (unit.inline ? 'inline' : 'block'));
    t.replaceChildren(fragment);
    setHostState(unit, 'done');
    applyMode(unit, mode);
  });
}

export function setStage(unit, stage, engine) {
  if (unit.tEl) write(() => {
    unit.tEl.setAttribute('data-dl-stage', stage);
    if (engine) unit.tEl.setAttribute('data-dl-engine', engine);
  });
}

// Translation identical to the source: nothing to show.
export function showNothing(unit) {
  if (unit.attribute) return;
  write(() => {
    if (unit.tEl) unit.tEl.remove();
    unit.tEl = null;
    unwrapOriginal(unit);
    cleanHostClass(unit);
    releaseTitle(unit);
    adopt(unit);
    setHostState(unit, 'done');
  });
}

export function markError(unit, message) {
  if (unit.attribute) return;
  // A touch-sized retry button cannot fit a single-line menu or icon button. Leave the
  // original control usable; page state still reports the error and hover can retry it.
  if (unit.presentation === 'replace') { restore(unit); return; }
  write(() => {
    const t = ensureT(unit);
    t.className = 'dl-t dl-inline';
    t.setAttribute('data-dl-state', 'error');
    const r = document.createElement(TAG_R);
    r.setAttribute('role', 'button');
    r.setAttribute('tabindex', '0');
    r.setAttribute('aria-label', '重试翻译');
    r.setAttribute('title', `翻译失败：${message || '未知错误'}（点击重试）`);
    r.textContent = '↻';
    t.replaceChildren(r);
    setHostState(unit, 'error');
  });
}

function applyMode(unit, mode) {
  const t = unit.tEl;
  if (!t) return;
  const replace = unit.presentation === 'replace';
  if (replace && !unit.titleSaved) claimTitle(unit);
  const solo = (mode === 'translation-only' || replace) && unit.state === 'done';
  if (solo) {
    wrapOriginal(unit);
    // hasHeavy() may have refused to wrap; then the translation stays beside the original
    const hidden = !!unit.oEl;
    t.classList.toggle('dl-solo', hidden);
    if (unit.whole) unit.host.classList.toggle('dl-only', hidden || !!unit.hadOnlyClass);
  } else {
    unwrapOriginal(unit);
    t.classList.remove('dl-solo');
    cleanHostClass(unit);
  }
  applyPeek(unit);
}

export function setMode(unit, mode) {
  if (unit.state !== 'done' || !unit.tEl) return;
  write(() => applyMode(unit, mode));
}

export function setStyle(unit, style) {
  if (!unit.tEl) return;
  write(() => {
    const t = unit.tEl;
    t.className = t.className.replace(/\bdl-s-\S+/, `dl-s-${style}`);
  });
}

function applyPeek(unit) {
  if (unit.tEl) {
    if (unit.peek) unit.tEl.setAttribute('data-dl-peek', '');
    else unit.tEl.removeAttribute('data-dl-peek');
  }
  if (unit.oEl) unit.oEl.classList.toggle('dl-peek', !!unit.peek);
}

// Temporarily swaps what is visible: in bilingual mode the translation is hidden, in
// translation-only mode the original comes back.
export function setPeek(unit, on) {
  unit.peek = !!on;
  write(() => applyPeek(unit));
}

// Puts the DOM back exactly as the page had it.
export function restore(unit) {
  write(() => {
    if (unit.attribute) {
      if (unit.attributeWritten !== undefined && unit.host.getAttribute(unit.attribute) === unit.attributeWritten) {
        if (unit.originalAttribute === null) unit.host.removeAttribute(unit.attribute);
        else unit.host.setAttribute(unit.attribute, unit.originalAttribute);
      }
      return;
    }
    if (unit.tEl) unit.tEl.remove();
    unwrapOriginal(unit);
    if (unit.wEl) {
      unwrap(unit.wEl);
      unit.wEl = null;
    }
    if (unit.whole && unit.adopted) {
      const h = unit.host;
      if (unit.originalId === null) h.removeAttribute('data-dl-id'); else h.setAttribute('data-dl-id', unit.originalId);
      if (unit.originalState === null) h.removeAttribute('data-dl-state'); else h.setAttribute('data-dl-state', unit.originalState);
      cleanHostClass(unit);
    }
    unit.tEl = null;
    unit.wChecked = false;
    unit.adopted = false;
    releaseTitle(unit);
    releaseTextSplit(unit);
  });
}

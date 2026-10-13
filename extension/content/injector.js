// DOM writes for translation units (SPEC §5.6-5.7). Everything that touches the page DOM on behalf
// of a unit lives here so that restore() can promise to leave the page exactly as it was found.
//
// Unit shape (owned by controller.js): { id, host, first, last, whole, plain, state, lang,
//   tEl, oEl, wEl, hadClass, inline, peek }
// first..last are consecutive siblings; for a whole unit they span every child of host.

import { TAG_T, TAG_O, TAG_W, TAG_R } from './util.js';

// All writes go through this hook so the mutation observer can discard its own records.
let guard = (fn) => fn();
export function setWriteGuard(fn) {
  guard = fn;
}
export function write(fn) {
  return guard(fn);
}

const HEAVY_SEL = 'iframe,video,audio,input,textarea,select,canvas,object,embed';
const INLINE_HOST_SEL = 'button,summary,label,[role="button"],[role="tab"],[role="menuitem"],[role="option"]';

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
  write(() => {
    const t = ensureT(unit);
    t.className = 'dl-t dl-inline';
    t.setAttribute('data-dl-state', 'pending');
    t.replaceChildren();
    setHostState(unit, 'pending');
  });
}

export function decideInline(unit, inlineMaxChars) {
  if (unit.plain.length < inlineMaxChars) return true;
  return unit.host.matches(INLINE_HOST_SEL);
}

// mode: 'bilingual' | 'translation-only'
export function showTranslation(unit, fragment, { mode, style, inlineMaxChars }) {
  write(() => {
    const t = ensureT(unit);
    unit.inline = decideInline(unit, inlineMaxChars);
    t.className = `dl-t ${unit.inline ? 'dl-inline' : 'dl-block'} dl-s-${style}`;
    t.setAttribute('data-dl-state', 'done');
    t.replaceChildren(fragment);
    setHostState(unit, 'done');
    applyMode(unit, mode);
  });
}

// Translation identical to the source: nothing to show.
export function showNothing(unit) {
  write(() => {
    if (unit.tEl) unit.tEl.remove();
    unit.tEl = null;
    unwrapOriginal(unit);
    adopt(unit);
    setHostState(unit, 'done');
  });
}

export function markError(unit, message) {
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
  const solo = mode === 'translation-only' && unit.state === 'done';
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
  });
}

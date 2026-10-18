// Small helpers shared by the content modules. No state, no DOM writes.
import { escapeText, stripMarkup } from '../shared/markup.js';

export const TAG_T = 'dl-t'; // translation
export const TAG_O = 'dl-o'; // wrapper around original nodes (translation-only mode)
export const TAG_W = 'dl-w'; // wrapper that makes flex/grid hosts treat unit + translation as one item
export const TAG_R = 'dl-r'; // retry control

export const LETTER_RE = /\p{L}/u;

// Every element we create has a "dl-" local name, so one prefix test recognises them all.
export function isOurs(el) {
  return el.localName.startsWith('dl-');
}

export function debounce(fn, ms) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

// Selectors come from user-authored site rules; an invalid one must never break the page.
const probe = typeof document !== 'undefined' ? document.createDocumentFragment() : null;
export function validSelector(sel) {
  if (typeof sel !== 'string') return null;
  const s = sel.trim();
  if (!s) return null;
  try {
    probe.querySelector(s);
    return s;
  } catch {
    return null;
  }
}

// Accepts a string or an array of strings (one selector list each) and returns one valid list or null.
export function joinSelectors(v) {
  const parts = (Array.isArray(v) ? v : [v]).map(validSelector).filter(Boolean);
  return parts.length ? parts.join(',') : null;
}

export function deepActiveElement() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

// Only public identifiers cross the transport. Explicit service selection must bypass MT.
export function interactionRequest(choice = {}) {
  return choice.profileId ? { profileId: choice.profileId, model: choice.model?.trim() || undefined, mode: 'llm' } : {};
}

// Keep the controller's batching, cancellation and exact restore. Its existing one-shot transport
// supports profile overrides on both platforms; port batches intentionally retain the page chain.
export function hoverService(service, getSettings) {
  return { ...service, translateBatch(req, partial) {
    const choice = interactionRequest(getSettings().hover);
    if (req.purpose !== 'hover' || !choice.profileId) return service.translateBatch(req, partial);
    let cancelled = false;
    const done = Promise.all(req.items.map(async item => {
      let res;
      try { res = await service.translateText({ text: stripMarkup(item.text), to: req.to, from: req.from, purpose: 'hover', ...choice }); }
      catch { res = { ok: false }; }
      if (!cancelled) partial([res.ok ? { id: item.id, text: escapeText(res.text), stage: 'final' }
        : { id: item.id, error: { code: 'PROVIDER', message: '悬停翻译失败，请重试' } }]);
    }));
    return { done, cancel() { cancelled = true; } };
  } };
}

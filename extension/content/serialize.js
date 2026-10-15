// Unit DOM <-> placeholder string (SPEC §6).
//
// serializeRun(): original nodes -> "text with <g0>…</g0> and <x1/>" plus the element table.
// buildFragment(): parsed model output -> DocumentFragment, built only from createTextNode and
// clones of the page's own elements. Model output never reaches innerHTML.

import { escapeText } from '../shared/markup.js';
import { classify } from './walker.js';
import { LETTER_RE } from './util.js';
import { identifierText } from '../shared/identifiers.js';

// Inline wrappers that get a <gN> tag (SPEC §6).
const G_TAGS = new Set('a b strong em i u s mark sub sup small abbr cite q span font'.split(' '));
// Kept verbatim as <xN/> regardless of exclusion rules.
const ATOM_TAGS = new Set(['br', 'img', 'wbr']);
// Excluded elements that must not be duplicated into a translation (a second form field, frame or
// player would change page behaviour); they are simply left out of the translated copy.
const DROP_TAGS = new Set([
  'input', 'textarea', 'select', 'option', 'iframe', 'video', 'audio', 'canvas', 'object', 'embed',
]);
const MAX_DEPTH = 4;

const WS = /[ \t\n\r\f]+/g;

// -> { text, plain, els }
// text:  placeholder string sent to the model
// plain: visible text only, whitespace-normalised (for language checks and "same as source" tests)
// els:   element table; index N is what <gN>/<xN/> refer to
export function serializeRun(first, last, { exclude = null } = {}) {
  const els = [];
  let s = '';
  let plain = '';

  const atom = (el) => {
    s += `<x${els.length}/>`;
    els.push(el);
  };

  const walk = (node, depth) => {
    if (node.nodeType === 3) {
      const t = node.data.replace(WS, ' ');
      s += escapeText(t);
      plain += t;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    const kind = classify(node, exclude);
    if (kind === 'hidden' || DROP_TAGS.has(tag)) return;
    if (ATOM_TAGS.has(tag) || kind === 'atom') return atom(node);
    if (kind === 'excluded-block') return;

    if (kind === 'inline' && G_TAGS.has(tag) && depth < MAX_DEPTH) {
      const idx = els.length;
      els.push(node);
      const open = `<g${idx}>`;
      const start = s.length;
      const plainStart = plain.length;
      s += open;
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
      if (LETTER_RE.test(plain.slice(plainStart))) {
        s += `</g${idx}>`;
      } else {
        // Decorative wrapper without text of its own: keep what it holds, drop the wrapper.
        s = s.slice(0, start) + s.slice(start + open.length);
      }
      return;
    }

    // Unknown inline element, nesting beyond the limit, or an unexpected block: keep only its content.
    const block = kind === 'container';
    if (block) {
      s += ' ';
      plain += ' ';
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, depth);
    if (block) {
      s += ' ';
      plain += ' ';
    }
  };

  for (let n = first; n; n = n.nextSibling) {
    walk(n, 0);
    if (n === last) break;
  }

  return {
    text: s.replace(/ {2,}/g, ' ').trim(),
    plain: plain.replace(/ {2,}/g, ' ').trim(),
    els,
  };
}

// Quick filter for strings that are not worth sending: no letters, bare URLs, e-mail addresses,
// and lone code-ish tokens (v2.0, api_key, #id).
let wordSegmenter;
export function isShortText(plain) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(plain)) {
    if (typeof Intl.Segmenter === 'function') {
      wordSegmenter ||= new Intl.Segmenter(undefined, { granularity: 'word' });
      let words = 0;
      for (const segment of wordSegmenter.segment(plain)) if (segment.isWordLike && ++words > 3) return false;
      return true;
    }
    return (plain.match(/\p{L}/gu) || []).length <= 3;
  }
  return (plain.match(/\S+/g) || []).length <= 3;
}

export function isTranslatable(plain, minChars) {
  if (identifierText(plain)) return false;
  if (plain.length < minChars) return false;
  if (!LETTER_RE.test(plain)) return false;
  if (/^(?:https?:\/\/|ftp:\/\/|www\.)\S+$/i.test(plain)) return false;
  if (/^(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|dev|app|cn|uk|jp|de|fr|ru)(?::\d+)?(?:\/\S*)?$/i.test(plain)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(plain)) return false;
  if (/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?[,]?\s+)?(?:\d{1,4}[-/:.]\d{1,2}[-/:.]\d{1,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})(?:[T\s].*)?$/i.test(plain)) return false;
  if (/^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?(?:\s*(?:UTC|GMT|[+-]\d{2}:?\d{2}))?|\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago)$/i.test(plain)) return false;
  return true;
}

function stripIds(el) {
  el.removeAttribute('id');
  el.removeAttribute('data-dl-id');
  el.removeAttribute('data-dl-state');
  for (const attr of [...el.attributes]) {
    if (/^on/i.test(attr.name) || attr.name === 'autofocus' ||
        (/^(href|src|xlink:href)$/i.test(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) {
      el.removeAttribute(attr.name);
    }
  }
}

function cloneShallow(src) {
  const c = src.cloneNode(false);
  stripIds(c);
  return c;
}

function cloneDeep(src) {
  const c = src.cloneNode(true);
  stripIds(c);
  for (const el of c.querySelectorAll('*')) stripIds(el);
  for (const el of c.querySelectorAll('dl-t,dl-o,dl-w,dl-r')) el.remove();
  return c;
}

function appendNodes(parent, nodes, els) {
  for (const n of nodes) {
    if (n.t === 'text') {
      parent.appendChild(document.createTextNode(n.v));
    } else if (n.t === 'g') {
      const src = els[n.n];
      if (src) {
        const c = cloneShallow(src);
        appendNodes(c, n.children, els);
        parent.appendChild(c);
      } else {
        appendNodes(parent, n.children, els);
      }
    } else if (n.t === 'x') {
      const src = els[n.n];
      if (src) parent.appendChild(cloneDeep(src));
    }
  }
}

export function buildFragment(nodes, els) {
  const frag = document.createDocumentFragment();
  appendNodes(frag, nodes, els);
  return frag;
}

export function textFragment(text) {
  const frag = document.createDocumentFragment();
  frag.appendChild(document.createTextNode(text));
  return frag;
}

// Segmentation: finds translation units (SPEC §5.1-5.2).
//
// A unit is a run of consecutive sibling nodes inside one block-level container that carries visible
// text. A container whose children are all inline content yields one "whole" run; a container that
// mixes text and block children (e.g. <li>text<ul>…</ul></li>) yields one run per stretch of inline
// content. Block-ness comes from computed style, so flex/grid items count as blocks.

import { isOurs, LETTER_RE } from './util.js';

const SILENT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'base']);

// SPEC §5.2 exclusions by tag.
export const EXCLUDED_TAGS = new Set([
  'textarea', 'input', 'select', 'option', 'svg', 'math', 'canvas', 'iframe', 'video', 'audio',
  'code', 'pre', 'kbd', 'samp', 'var', 'object', 'embed',
]);

// SPEC §5.2 exclusions by attribute.
const EXCLUDED_ATTR_SEL =
  '[translate="no"],.notranslate,[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])';

// Used to find out whether an inline element wraps real blocks (e.g. <a><div>…</div></a>).
const BLOCK_SEL =
  'address,article,aside,blockquote,details,dialog,div,dl,fieldset,figure,footer,form,h1,h2,h3,h4,h5,h6,' +
  'header,hr,li,main,nav,ol,p,section,table,tr,td,th,ul';

// Used to ask "is this node somewhere inside an excluded subtree".
const EXCLUDED_CLOSEST =
  'textarea,select,option,pre,code,kbd,samp,var,svg,math,canvas,iframe,video,audio,script,style,noscript,' +
  'template,dl-t,dl-o,dl-w,dl-r,' + EXCLUDED_ATTR_SEL;

export function isInlineLevel(display) {
  return display === 'inline' || display === 'contents' || display.startsWith('inline-') || display.startsWith('ruby');
}

// Inline-level elements that still need to be scanned as containers.
function needsContainer(el, display) {
  if (display === 'inline-flex' || display === 'inline-grid' || display === 'inline-table') return true;
  return !!el.firstElementChild && !!el.querySelector(BLOCK_SEL);
}

function isExcludedEl(el, tag, exclude) {
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (el.matches(EXCLUDED_ATTR_SEL)) return true;
  return !!exclude && el.matches(exclude);
}

// 'hidden' | 'atom' | 'excluded-block' | 'inline' | 'container'
// 'atom': an excluded or invisible-to-translation inline element kept as a placeholder.
export function classify(el, exclude) {
  const tag = el.localName;
  if (SILENT_TAGS.has(tag) || isOurs(el)) return 'hidden';
  const cs = getComputedStyle(el);
  const display = cs.display;
  if (display === 'none' || cs.visibility === 'hidden') return 'hidden';
  const inlineLevel = isInlineLevel(display);
  if (isExcludedEl(el, tag, exclude)) return inlineLevel ? 'atom' : 'excluded-block';
  if (inlineLevel && !needsContainer(el, display)) return 'inline';
  return 'container';
}

// True when `el` sits inside something that must never be translated.
export function inExcludedContext(el, exclude) {
  if (el.closest(EXCLUDED_CLOSEST)) return true;
  return !!exclude && !!el.closest(exclude);
}

// Nearest ancestor-or-self that lays out as a block (the container whose runs a node belongs to).
export function blockContainerOf(node) {
  let el = node.nodeType === 1 ? node : node.parentElement;
  const root = document.body || document.documentElement;
  while (el && el !== document.documentElement) {
    const display = getComputedStyle(el).display;
    if (!isInlineLevel(display) || display === 'inline-flex' || display === 'inline-grid' || display === 'inline-table') {
      return el;
    }
    el = el.parentElement;
  }
  return root;
}

// opts: { minChars, exclude: selector|null, known(host, first) -> bool, shallow: bool }
// -> [{ host, first, last, whole }]
export function collectRuns(root, opts = {}) {
  const minChars = opts.minChars ?? 2;
  const exclude = opts.exclude || null;
  const known = opts.known || null;
  const shallow = !!opts.shallow;
  const out = [];

  if (root.nodeType !== 1) return out;
  if (inExcludedContext(root, exclude)) return out;
  if (classify(root, exclude) === 'hidden' || classify(root, exclude) === 'excluded-block') return out;

  function scan(el) {
    if (el.hasAttribute('data-dl-id')) return; // already a whole unit; its children belong to it
    let first = null;
    let last = null;
    let rough = 0;
    let letters = false;
    let sawBlock = false;

    const flush = () => {
      if (first && letters && rough >= minChars && !(known && known(el, first))) {
        out.push({ host: el, first, last, whole: false });
      }
      first = last = null;
      rough = 0;
      letters = false;
    };

    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        const d = n.data;
        if (!first) {
          if (!/\S/.test(d)) continue;
          first = n;
        }
        last = n;
        rough += d.length;
        if (!letters && LETTER_RE.test(d)) letters = true;
        continue;
      }
      if (n.nodeType !== 1) continue; // comments etc. neither start nor end a run

      const kind = classify(n, exclude);
      if (kind === 'hidden') continue;
      if (kind === 'inline' || kind === 'atom') {
        if (!first) first = n;
        last = n;
        if (kind === 'inline') {
          const t = n.textContent;
          rough += t.length;
          if (!letters && LETTER_RE.test(t)) letters = true;
        }
        continue;
      }
      flush();
      sawBlock = true;
      if (kind === 'container' && !shallow) scan(n);
    }

    if (first && !sawBlock) {
      // The single run covers the whole container: claim the container itself.
      if (letters && rough >= minChars && !(known && known(el, el.firstChild))) {
        out.push({ host: el, first: el.firstChild, last: el.lastChild, whole: true });
      }
      first = last = null;
    }
    flush();
  }

  scan(root);
  return out;
}

// Runs belonging to one block container only (no recursion); used by hover on an unscanned page.
export function runsOf(container, opts = {}) {
  return collectRuns(container, { ...opts, shallow: true });
}

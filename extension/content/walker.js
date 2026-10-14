// Segmentation: finds translation units (SPEC §5.1-5.2).
//
// A unit is a run of consecutive sibling nodes inside one block-level container that carries visible
// text. A container whose children are all inline content yields one "whole" run; a container that
// mixes text and block children (e.g. <li>text<ul>…</ul></li>) yields one run per stretch of inline
// content. Block-ness comes from computed style, so flex/grid items count as blocks.

import { isOurs, LETTER_RE } from './util.js';
import { novelRoots, novelBody, pixivNovelDocument } from '../shared/site-adapters.js';
import { splitParagraphText } from './injector.js';

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
  const out = [];
  for (const run of iterateRuns(root, opts)) if (run) out.push(run);
  return out;
}

// Null yields are cooperative checkpoints, including containers that contain no text.
export function* iterateRuns(root, opts = {}) {
  const minChars = opts.minChars ?? 2;
  const exclude = opts.exclude || null;
  const known = opts.known || null;
  const shallow = !!opts.shallow;

  if (root.nodeType !== 1) return;
  if (inExcludedContext(root, exclude)) return;
  if (classify(root, exclude) === 'hidden' || classify(root, exclude) === 'excluded-block') return;

  function* scan(el) {
    yield null;
    if (el.hasAttribute('data-dl-id')) return; // already a whole unit; its children belong to it
    const textParagraphs=splitParagraphText(el,minChars);
    if(textParagraphs) {for(const run of textParagraphs) yield run;return;}
    let first = null;
    let last = null;
    let rough = 0;
    let letters = false;
    let sawBlock = false;
    let breakNode = null;
    let beforeBreak = null;
    // Pixiv text-count spans are author-entered lines, not CSS-wrapped visual rows. When there
    // are no explicit blank lines, each is already a paragraph (often one line of dialogue).
    const paragraphLines = pixivNovelDocument(el.ownerDocument) && el.matches('p:has(> span.text-count)') &&
      ![...el.querySelectorAll(':scope > span.text-count')].some(line=>!line.textContent.trim()) &&
      !el.querySelector(':scope > br + br');

    const flush = () => {
      if (first && letters && rough >= minChars && !(known && known(el, first))) {
        const run = { host: el, first, last, whole: false };
        first = last = null; rough = 0; letters = false;
        return run;
      }
      first = last = null;
      rough = 0;
      letters = false;
    };

    // Some novel readers use one block per visual line, with an empty block between paragraphs.
    // Keep the original siblings intact and claim a range per natural paragraph.
    if (novelBody(el) && el.children.length && [...el.children].every(n =>
      ['div', 'p', 'span'].includes(n.localName) && classify(n, exclude) === 'container' && !n.querySelector(BLOCK_SEL))) {
      for (const n of el.childNodes) {
        yield null;
        if (n.nodeType !== 1) continue;
        const text = n.textContent.trim();
        if (!text) { const run = flush(); if (run) yield run; continue; }
        if (!first) first = n;
        last = n; rough += text.length; letters ||= LETTER_RE.test(text);
      }
      const run = flush(); if (run) yield run;
      return;
    }

    for (let n = el.firstChild; n; n = n.nextSibling) {
      yield null;
      if (n.nodeType === 3) {
        const d = n.data;
        if (/\S/.test(d)) breakNode = null;
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
        if (n.localName === 'br') {
          if (paragraphLines) {
            const run=flush();if(run) yield run;
            sawBlock=true;breakNode=null;continue;
          }
          if (breakNode) {
            last = beforeBreak;
            const run = flush();
            if (run) yield run;
            // Consecutive breaks (and empty inline line wrappers) are separators, not source text.
            sawBlock = true;
            beforeBreak = null;
            continue;
          }
          beforeBreak = last;
          breakNode = n;
        } else if (kind === 'inline' && /\S/.test(n.textContent)) {
          breakNode = null;
        }
        if (!first) first = n;
        last = n;
        if (kind === 'inline') {
          const t = n.textContent;
          rough += t.length;
          if (!letters && LETTER_RE.test(t)) letters = true;
        }
        continue;
      }
      const run = flush();
      if (run) yield run;
      sawBlock = true;
      breakNode = null;
      if (kind === 'container' && !shallow) yield* scan(n);
    }

    if (first && !sawBlock) {
      // The single run covers the whole container: claim the container itself.
      if (letters && rough >= minChars && !(known && known(el, el.firstChild))) {
        yield { host: el, first: el.firstChild, last: el.lastChild, whole: true };
      }
      first = last = null;
    }
    const run = flush();
    if (run) yield run;
  }

  const doc = root.ownerDocument;
  if (pixivNovelDocument(doc)) {
    const bodies = novelRoots(doc);
    if (bodies.some(body => body === root || body.contains(root))) yield* scan(root);
    else for (const body of bodies) if (root.contains(body)) yield* scan(body);
    return;
  }
  yield* scan(root);
}

// Runs belonging to one block container only (no recursion); used by hover on an unscanned page.
export function runsOf(container, opts = {}) {
  return collectRuns(container, { ...opts, shallow: true });
}

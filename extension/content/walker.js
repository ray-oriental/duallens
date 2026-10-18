// Segmentation: finds translation units (SPEC §5.1-5.2).
//
// A unit is a run of consecutive sibling nodes inside one block-level container that carries visible
// text. A container whose children are all inline content yields one "whole" run; a container that
// mixes text and block children (e.g. <li>text<ul>…</ul></li>) yields one run per stretch of inline
// content. Block-ness comes from computed style, so flex/grid items count as blocks.

import {isOurs,LETTER_RE} from './util.js';
import {novelBody,pixivNovelDocument,protectedElement} from '../shared/site-adapters.js';
import {splitParagraphText} from './injector.js';
import {denseLinkMenu} from './presentation.js';
import {identifierText} from '../shared/identifiers.js';

const SILENT_TAGS=new Set(['script','style','noscript','template','head','title','meta','link','base']);

// SPEC §5.2 exclusions by tag.
export const EXCLUDED_TAGS=new Set([
  'textarea','input','select','option','svg','math','canvas','iframe','video','audio',
  'code','pre','kbd','samp','var','object','embed',
]);

// SPEC §5.2 exclusions by attribute.
const EXCLUDED_ATTR_SEL=
  '[translate="no"],.notranslate,.katex,.MathJax,mjx-container,[contenteditable]:not([contenteditable="false"])';

// Used to find out whether an inline element wraps real blocks (e.g. <a><div>…</div></a>).
const BLOCK_SEL=
  'address,article,aside,blockquote,details,dialog,div,dl,fieldset,figure,footer,form,h1,h2,h3,h4,h5,h6,' +
  'header,hr,li,main,nav,ol,p,section,table,tr,td,th,ul';

// Used to ask "is this node somewhere inside an excluded subtree".
const EXCLUDED_CLOSEST=
  'textarea,select,option,pre,code,kbd,samp,var,svg,math,canvas,iframe,video,audio,script,style,noscript,' +
  'template,dl-t,dl-o,dl-w,dl-r,' + EXCLUDED_ATTR_SEL;

export function isInlineLevel(display) {
  return display==='inline' || display==='contents' || display.startsWith('inline-') || display.startsWith('ruby');
}

function edgeIdentifier(el) {
  return el?.nodeType===1&&el.matches('a,span,small,sup,sub')&&identifierText(el.textContent.trim().replace(/^\((.*)\)$/,'$1'))&&
    !el.querySelector('button,input,select,label,[role="button"]')&&[...el.querySelectorAll('a')].every(protectedElement);
}
function proseLink(el) {
  if(el.closest('nav,header,[role="navigation"],.related,[class*="breadcrumb" i]')) return false;
  return !!el.closest('p,li,dd,td,figcaption,blockquote,[role="note"]') ||
    [...el.parentElement.childNodes].filter(n=>n.nodeType===3).map(n=>n.data).join('').replace(/\P{L}/gu,'').length>12;
}

// Inline-level elements that still need to be scanned as containers.
function needsContainer(el,display) {
  if(display==='inline-flex' || display==='inline-grid' || display==='inline-table') return true;
  if(!el.firstElementChild) return false;
  if(edgeIdentifier(el.firstElementChild)||edgeIdentifier(el.lastElementChild)) return true;
  if(pixivNovelDocument(el.ownerDocument) && el.querySelector('span.text-count')) return true;
  if(el.querySelector('button,label,summary,[role="button"],[role="tab"],[role="menuitem"]')) return true;
  if(el.querySelector('a') &&(!proseLink(el.querySelector('a')) ||
      denseLinkMenu(el))) return true;
  return !!el.firstElementChild && !!el.querySelector(BLOCK_SEL);
}

function isExcludedEl(el,tag,exclude) {
  if(EXCLUDED_TAGS.has(tag)) return true;
  if(protectedElement(el)||edgeIdentifier(el)) return true;
  if(el.matches(EXCLUDED_ATTR_SEL)) return true;
  return !!exclude && el.matches(exclude);
}

// 'hidden' | 'atom' | 'excluded-block' | 'inline' | 'container'
// 'atom': an excluded or invisible-to-translation inline element kept as a placeholder.
export function classify(el,exclude) {
  const tag=el.localName;
  if(tag==='slot' && el.assignedNodes().length)return 'hidden';
  if(SILENT_TAGS.has(tag) || isOurs(el)) return 'hidden';
  const cs=getComputedStyle(el);
  const display=cs.display;
  if(display==='none' || cs.visibility==='hidden') return 'hidden';
  if(cs.opacity==='0'||((cs.clip!=='auto'||cs.clipPath!=='none')&&el.getBoundingClientRect().width<=2&&el.getBoundingClientRect().height<=2)) return 'hidden';
  const inlineLevel=isInlineLevel(display);
  if(isExcludedEl(el,tag,exclude)) return inlineLevel ? 'atom':'excluded-block';
  if(el.shadowRoot || novelBody(el)) return 'container';
  // Interactive inline siblings must have independent translations and layout policies.
  if(el.matches('.subtext,.comhead,button,label,summary,[role="button"],[role="tab"],[role="menuitem"]') ||
      (tag==='a' &&(!proseLink(el) ||
        denseLinkMenu(el.parentElement)))) return 'container';
  if(inlineLevel && !needsContainer(el,display)) return 'inline';
  return 'container';
}

// True when `el` sits inside something that must never be translated.
export function inExcludedContext(el,exclude) {
  if(el.closest(EXCLUDED_CLOSEST)) return true;
  for(let p=el;p&&p!==el.ownerDocument.body;p=p.parentElement) if(protectedElement(p)) return true;
  return !!exclude && !!el.closest(exclude);
}

// Nearest ancestor-or-self that lays out as a block (the container whose runs a node belongs to).
export function blockContainerOf(node) {
  if(node.nodeType===11)return node;
  let el=node.nodeType===1 ? node:node.parentElement;
  const reader=el?.closest('[data-novel-content]')||
    (el&&pixivNovelDocument(el.ownerDocument)&&el.closest(':has(> span.text-count)'));
  if(reader) return reader;
  const doc=node.ownerDocument;
  const scope=node.getRootNode();
  const root=scope.host ? scope:doc.body || doc.documentElement;
  while(el && el !==doc.documentElement) {
    if(novelBody(el)) return el;
    const display=getComputedStyle(el).display;
    if(!isInlineLevel(display) || display==='inline-flex' || display==='inline-grid' || display==='inline-table') {
      return el;
    }
    el=el.parentElement;
  }
  return root;
}

// opts: { minChars, exclude: selector|null, known(host, first) -> bool, shallow: bool }
// -> [{ host, first, last, whole }]
export function collectRuns(root,opts={}) {
  const out=[];
  for(const run of iterateRuns(root,opts)) if(run) out.push(run);
  return out;
}

// Null yields are cooperative checkpoints, including containers that contain no text.
function* iterateTextRuns(root,opts={}) {
  const minChars=opts.minChars ?? 2;
  const exclude=opts.exclude || null;
  const known=opts.known || null;
  const shallow=!!opts.shallow;

  if(root.nodeType !==1) return;
  if(inExcludedContext(root,exclude)) return;
  if(['hidden','atom','excluded-block'].includes(classify(root,exclude))) return;

  function* scan(el) {
    yield null;
    if(el.hasAttribute('data-dl-id')) return; // already a whole unit; its children belong to it
    if(el.matches('.subtext,.comhead')) {
      if(!known?.(el,el.firstChild)&&el.textContent.trim()) yield {host:el,first:el.firstChild,last:el.lastChild,whole:true,metadata:true};
      return;
    }
    const textParagraphs=splitParagraphText(el,minChars);
    if(textParagraphs) {for(const run of textParagraphs) yield run;return;}
    let first=null;
    let last=null;
    let rough=0;
    let letters=false;
    let sawBlock=false;
    let breakNode=null;
    let beforeBreak=null;
    // Pixiv text-count spans are author-entered lines, not CSS-wrapped visual rows. When there
    // are no explicit blank lines, each is already a paragraph (often one line of dialogue).
    const paragraphLines=pixivNovelDocument(el.ownerDocument) && el.matches(':has(> span.text-count)') &&
      ![...el.querySelectorAll(':scope > span.text-count')].some(line=>!line.textContent.trim()) &&
      !el.querySelector(':scope > br + br');

    const flush=()=> {
      if(first && letters && rough >=minChars && !(known && known(el,first))) {
        const run={host:el,first,last,whole:false,paragraph:paragraphLines || novelBody(el)};
        first=last=null; rough=0; letters=false;
        return run;
      }
      first=last=null;
      rough=0;
      letters=false;
    };

    // Some novel readers use one block per visual line, with an empty block between paragraphs.
    // Keep the original siblings intact and claim a range per natural paragraph.
    if(novelBody(el) && el.children.length && [...el.children].every(n=>
      ['div','p','span'].includes(n.localName) && classify(n,exclude)==='container' && !n.querySelector(BLOCK_SEL))) {
      for(const n of el.childNodes) {
        yield null;
        if(n.nodeType !==1) continue;
        const text=n.textContent.trim();
        if(!text) {const run=flush(); if(run) yield run; continue;}
        if(!first) first=n;
        last=n; rough +=text.length; letters ||=LETTER_RE.test(text);
      }
      const run=flush(); if(run) yield run;
      return;
    }

    for(let n=el.firstChild; n; n=n.nextSibling) {
      yield null;
      if(n.nodeType===3) {
        const d=n.data;
        if(/\S/.test(d)) breakNode=null;
        if(!first) {
          if(!/\S/.test(d)) continue;
          first=n;
        }
        last=n;
        rough +=d.length;
        if(!letters && LETTER_RE.test(d)) letters=true;
        continue;
      }
      if(n.nodeType !==1) continue; // comments etc. neither start nor end a run

      const kind=classify(n,exclude);
      if(kind==='hidden') continue;
      if(kind==='inline' || kind==='atom') {
        if(n.localName==='br') {
          if(paragraphLines) {
            const run=flush();if(run) yield run;
            sawBlock=true;breakNode=null;continue;
          }
          if(breakNode) {
            last=beforeBreak;
            const run=flush();
            if(run) yield run;
            // Consecutive breaks (and empty inline line wrappers) are separators, not source text.
            sawBlock=true;
            beforeBreak=null;
            continue;
          }
          beforeBreak=last;
          breakNode=n;
        } else if(kind==='inline' && /\S/.test(n.textContent)) {
          breakNode=null;
        }
        if(!first) first=n;
        last=n;
        if(kind==='inline') {
          const t=n.textContent;
          rough +=t.length;
          if(!letters && LETTER_RE.test(t)) letters=true;
        }
        continue;
      }
      const run=flush();
      if(run) yield run;
      sawBlock=true;
      breakNode=null;
      if(kind==='container' && !shallow) yield* scan(n);
    }

    if(first && !sawBlock) {
      // The single run covers the whole container: claim the container itself.
      if(letters && rough >=minChars && !(known && known(el,el.firstChild))) {
        yield {host:el,first:el.firstChild,last:el.lastChild,whole:true,paragraph:paragraphLines || novelBody(el)};
      }
      first=last=null;
    }
    const run=flush();
    if(run) yield run;
  }

  yield* scan(root);
}

export function* iterateRuns(root,opts={}) {
  if(root.nodeType===11) {
    if(inExcludedContext(root.host,opts.exclude))return;
    for(let h=root.host;h;h=h.parentElement || h.getRootNode().host)if(['hidden','atom','excluded-block'].includes(classify(h,opts.exclude)))return;
    for(const n of root.childNodes) {
      if(n.nodeType===1)yield* iterateRuns(n,opts);
      else if(n.nodeType===3 && n.data.trim().length>=(opts.minChars ?? 1) && LETTER_RE.test(n.data) && !opts.known?.(root.host,n))yield {host:root.host,first:n,last:n,whole:false};
    }
    return;
  }
  if(root.nodeType !==1) return;
  for(const run of iterateTextRuns(root,opts)) {
    if(!run||run.metadata) {yield run;continue;}
    const boundary=n=>n.nodeType===3?!n.data.trim():n.nodeType===1&&(protectedElement(n)||edgeIdentifier(n));
    const tail=run.last;
    while(run.first!==run.last&&boundary(run.first)) run.first=run.first.nextSibling;
    while(run.last!==run.first&&boundary(run.last)) run.last=run.last.previousSibling;
    if(run.last!==tail) run.tail=tail;
    yield run;
  }
  const minChars=opts.minChars ?? 1,exclude=opts.exclude || null;
  // Attributes cannot host dl-t children; their translations are restored independently.
  for(const el of [root,...root.querySelectorAll('[placeholder],button[title],a[title],[role="button"][title],option,input[type="button"],input[type="submit"],input[type="reset"]')]) {
    yield null;
    if(el.closest('dl-ui,dl-t,dl-o,dl-w,pre,code,kbd,samp,var,svg,math,.katex,.MathJax,mjx-container,' + EXCLUDED_ATTR_SEL) ||
        (exclude && el.closest(exclude))) continue;
    if(!el.getClientRects().length && el.localName !=='option') continue;
    const cs=getComputedStyle(el);
    if(cs.display==='none' || cs.visibility !=='visible') continue;
    const attributes=[];
    if(el.matches('input[placeholder]:not([type="password"]),textarea[placeholder]') && !el.value) attributes.push(['placeholder',el.getAttribute('placeholder')]);
    if(el.matches('button[title],a[title],[role="button"][title]') && !(el.innerText || '').trim()) attributes.push(['title',el.getAttribute('title')]);
    if(el.localName==='option') attributes.push(['label',el.getAttribute('label') || el.textContent]);
    if(el.matches('input[type="button"],input[type="submit"],input[type="reset"]')) attributes.push(['value',el.getAttribute('value')]);
    for(const [attribute,source] of attributes) {
      if(source?.trim().length >=minChars && LETTER_RE.test(source) && !opts.attributeKnown?.(el,attribute)) {
        yield {host:el,first:el,last:el,whole:false,attribute,source};
      }
    }
  }
}

// Runs belonging to one block container only (no recursion); used by hover on an unscanned page.
export function runsOf(container,opts={}) {
  return collectRuns(container,{...opts,shallow:true});
}

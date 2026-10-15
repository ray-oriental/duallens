// Layout-preserving bilingual PDF reader (docs/PDF.md).
//
// Every page keeps its original rendering (canvas + selectable text layer). When translation is
// on, a same-size translated sheet is built from a copy of that rendering: each text block is
// painted over with its sampled background colour and the translation is placed at the block's
// original position, scaled to fit. Formulas, figures, rules, headers and page numbers keep the
// original pixels; inline formulas are cropped from the original page. Model output only ever
// becomes text nodes.

import { getDocument, GlobalWorkerOptions, TextLayer } from '../vendor/pdfjs/pdf.min.js';
import { createExtensionPlatform } from '../platform/extension.js';
import { PRIORITY } from '../shared/protocol.js';
import { blockSource } from './segments.js';
import { planBlock, sampleColors, cssColor, inkBounds } from './layout.js';
import { PdfTranslations } from './translate.js';
import { checkPDFBytes, readPDFURL, MAX_PDF_BYTES } from './source.js';
import { createOverlay } from '../content/overlay.js';
import { lensIcon } from '../content/visual.js';

GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const platform = createExtensionPlatform();
const $ = id => document.getElementById(id);
const VIEWS = ['side', 'translated', 'original', 'reflow'];
const VIEW_KEY = 'duallens.pdf.view';
const MAX_PIXELS = 4_000_000; // per canvas, independent of zoom and device pixel ratio
const MAX_RESIDENT = 5; // pages holding canvases
let settings = await platform.settingsStore.load();
let view = initialView();
let pdf, task, pages = [], epoch = 0, revision = 0, sourceRequest = 0, scale = 1;
let busy = false, nearObserver, visibleObserver, scrollFrame = 0, requestTimer = 0;
const resident = new Set(), near = new Set(), visible = new Set();
const paintQueue = new Set();
let paintFrame = 0;
const metrics = { opened: 0, firstPage: 0, firstDraft: 0, firstFinal: 0, activated: 0, slow: [] };
// Synchronous steps over 16 ms are recorded (bounded) to keep main-thread work visible.
function timed(label, fn) {
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  if (ms > 16 && metrics.slow.length < 50) metrics.slow.push({ step: label, ms: Math.round(ms) });
  return value;
}
// Read-only diagnostics for local tests and the user's own console; holds no secrets.
globalThis.__duallensPdfMetrics = metrics;
globalThis.__duallensPdfBlocks = number => {
  const page = pages[number - 1];
  return (page?.segments?.blocks || []).map(block => {
    const entry = session.get(blockId(page, block));
    const node = page.blockEls.get(block.id);
    return { id: block.id, kind: block.kind, role: block.role, size: block.size * scale, lines: block.lines.length,
      state: entry?.state, error: entry?.error?.message, complete: entry?.complete, source: entry?.source?.markup?.slice(0, 120),
      text: entry?.text?.slice(0, 120), fontSize: node?.style.fontSize, overflow: node ? 'overflow' in node.dataset : undefined };
  });
};

const session = new PdfTranslations({
  service: platform.translator(),
  getSettings: () => settings,
  // Only the requested block text is sent: no PDF URL, file name or metadata (docs/PRIVACY.md).
  getContext: () => ({}),
  onUpdate: ids => queuePaint(ids),
});

const el = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
const yieldMain = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
const blockId = (page, block) => `p${page.number}-b${block.id}`;
const fontStack = getComputedStyle(document.documentElement).getPropertyValue('--tr-font').trim() || 'sans-serif';
const measureContext = document.createElement('canvas').getContext('2d');
function measurer(font) {
  const cache = new Map();
  return text => {
    let width = cache.get(text);
    if (width === undefined) {
      measureContext.font = font;
      width = measureContext.measureText(text).width / 100;
      if (cache.size < 20000) cache.set(text, width);
    }
    return width;
  };
}
const measureRegular = measurer(`400 100px ${fontStack}`);
const measureBold = measurer(`600 100px ${fontStack}`);
let segmentWorker, segmentSequence = 0;
const segmentJobs = new Map();
function localSegments(items, options) {
  if (!segmentWorker) {
    segmentWorker = new Worker(new URL('./segment-worker.js', import.meta.url), { type: 'module' });
    segmentWorker.onmessage = ({ data }) => {
      const job = segmentJobs.get(data.id);
      if (!job) return;
      segmentJobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    segmentWorker.onerror = () => {
      for (const job of segmentJobs.values()) job.reject(new Error('PDF 文本块识别失败'));
      segmentJobs.clear(); segmentWorker.terminate(); segmentWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++segmentSequence;
    segmentJobs.set(id, { resolve, reject });
    try { segmentWorker.postMessage({ id, items, options }); }
    catch (error) { segmentJobs.delete(id); reject(error); }
  });
}
// Ascent/descent of the translation font as actually resolved (YaHei, PingFang, Noto Sans CJK...).
const fontMetrics = (() => {
  measureContext.font = `400 100px ${fontStack}`;
  const m = measureContext.measureText('中');
  const ascent = m.fontBoundingBoxAscent / 100, descent = m.fontBoundingBoxDescent / 100;
  return ascent > .5 && ascent < 1.5 && descent >= 0 && descent < .6 ? { ascent, descent } : { ascent: 1.06, descent: .26 };
})();

function initialView() {
  try { const saved = localStorage.getItem(VIEW_KEY); if (VIEWS.includes(saved)) return saved; } catch { /* storage unavailable */ }
  if (innerWidth < 600) return 'reflow';
  return innerWidth < 900 || settings.displayMode === 'translation-only' ? 'translated' : 'side';
}

// ---- floating ball -------------------------------------------------------------------------
const floating = createOverlay(`.pdf-ball{position:fixed;right:max(6px,env(safe-area-inset-right));top:60vh;width:44px;height:44px;border:0;border-radius:50%;background:linear-gradient(135deg,#4263eb,#20c997);box-shadow:0 2px 10px #0004;cursor:pointer;pointer-events:auto;touch-action:none}.pdf-ball svg{width:22px;height:22px}.pdf-ball:disabled{opacity:.4}.pdf-ball[aria-pressed=true]{outline:2px solid #20c997;outline-offset:3px}`);
const ball = document.createElement('button'); ball.className = 'pdf-ball'; ball.type = 'button';
ball.setAttribute('aria-label', '翻译或恢复当前 PDF'); ball.title = '翻译 / 恢复 PDF（拖动可移动，右键返回工具栏）';
ball.append(lensIcon(true)); floating.el.append(ball);
if (settings.floatBall.enabled) floating.attach();
ball.disabled = true;
ball.addEventListener('click', () => { if (session.active) deactivate(); else activate(); });
ball.addEventListener('contextmenu', event => { event.preventDefault(); document.querySelector('header').scrollIntoView({ block: 'start' }); $('translate').focus(); });
ball.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  const origin = ball.getBoundingClientRect(); let moved = false;
  ball.setPointerCapture(event.pointerId);
  const move = e => {
    if (e.pointerId !== event.pointerId) return;
    if (!moved && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
    moved = true;
    ball.style.left = Math.max(6, Math.min(innerWidth - 50, origin.left + e.clientX - event.clientX)) + 'px';
    ball.style.top = Math.max(6, Math.min(innerHeight - 50, origin.top + e.clientY - event.clientY)) + 'px'; ball.style.right = 'auto';
  };
  const end = e => {
    if (e.pointerId !== event.pointerId) return;
    ball.removeEventListener('pointermove', move); ball.removeEventListener('pointerup', end); ball.removeEventListener('pointercancel', end);
    if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    if (moved) ball.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); }, { once: true, capture: true });
  };
  ball.addEventListener('pointermove', move); ball.addEventListener('pointerup', end); ball.addEventListener('pointercancel', end);
});

// ---- status --------------------------------------------------------------------------------
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function stateChanged() {
  const stats = session.stats();
  ball.disabled = !pdf; ball.setAttribute('aria-pressed', String(session.active));
  $('translate').textContent = session.active ? (stats.failed ? '重试失败' : '继续翻译') : '翻译';
  $('restore').disabled = !session.active;
  document.body.classList.toggle('translating', session.active);
  if (!session.active) return;
  const parts = [`已翻译 ${stats.done}/${stats.total} 块`];
  if (stats.draft) parts.push(`草稿 ${stats.draft}`);
  if (stats.pending) parts.push(`待处理 ${stats.pending}`);
  if (stats.failed) parts.push(`失败 ${stats.failed}（点 ↻ 重试）`);
  if (stats.unrefined) parts.push(`${stats.unrefined} 块精修失败，显示机器翻译`);
  message(parts.join(' · '));
}

// ---- geometry ------------------------------------------------------------------------------
function fitScale(width) {
  const available = Math.max(240, document.documentElement.clientWidth - 28);
  const columns = view === 'side' ? 2 : 1;
  const value = (available - (columns - 1) * 14) / (width * columns);
  return Math.max(.3, Math.min(view === 'side' ? 2 : 1.6, value));
}
function chosenScale() {
  const zoom = $('zoom').value;
  return zoom === 'fit' ? fitScale(pages[0]?.size.w || 612) : Number(zoom);
}
function sizeSheets(page) {
  page.shell.style.setProperty('--sheet-w', Math.round(page.size.w * scale) + 'px');
  page.shell.style.setProperty('--sheet-h', Math.round(page.size.h * scale) + 'px');
}
// pdf.js items are in PDF user space; express them in the displayed page (rotation applied, y up).
function displayItems(items, transform, height) {
  const [a, b, c, d, e, f] = transform;
  return items.map(item => {
    const t = item?.transform;
    if (!Array.isArray(t) || t.length !== 6) return item;
    const m = [a * t[0] + c * t[1], b * t[0] + d * t[1], a * t[2] + c * t[3], b * t[2] + d * t[3],
      a * t[4] + c * t[5] + e, b * t[4] + d * t[5] + f];
    return { ...item, transform: [m[0], -m[1], m[2], -m[3], m[4], height - m[5]] };
  });
}
function currentPage() {
  const line = innerHeight * .4;
  let best = null, distance = Infinity;
  for (const page of visible) {
    const rect = page.shell.getBoundingClientRect();
    const d = rect.top <= line && rect.bottom >= line ? 0 : Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
    if (d < distance) { distance = d; best = page; }
  }
  return best?.number || Number($('page-number').value) || 1;
}

// ---- page lifecycle ------------------------------------------------------------------------
function placeholder(text) { const node = el('div', 'placeholder'); node.textContent = text; return node; }
function transPlaceholder(page) {
  return placeholder(page.segments && !page.segments.blocks.some(block => block.kind === 'text')
    ? '此页没有可读取的文本层（可能为扫描件），不提供 OCR' : '点击「翻译」后，此处显示保持原版式的译文页');
}
function createPage(number, size) {
  const shell = el('section', 'pdf-page'); shell.dataset.page = number;
  const label = el('div', 'page-label'); label.textContent = `第 ${number} 页`; label.setAttribute('translate', 'no');
  const sheets = el('div', 'sheets');
  const orig = el('div', 'sheet orig'); orig.setAttribute('translate', 'no');
  const trans = el('div', 'sheet trans'); trans.setAttribute('translate', 'no');
  const reflow = el('div', 'reflow'); reflow.setAttribute('translate', 'no');
  sheets.append(orig, trans); shell.append(label, sheets, reflow);
  const page = { number, shell, orig, trans, reflow, size: { ...size }, measured: false, ready: false, segments: null, sources: null,
    colors: null, text: null, blockEls: new Map(), whited: new Set(), rfEls: new Map(), reflowBuilt: false };
  orig.append(placeholder('靠近此页时加载'));
  trans.append(transPlaceholder(page));
  sizeSheets(page);
  return page;
}

function makeRoom(current) {
  while (resident.size >= MAX_RESIDENT) {
    const candidates = [...resident].filter(page => page !== current);
    if (!candidates.length) return;
    candidates.sort((a, b) => (near.has(a) - near.has(b)) || Math.abs(b.number - current.number) - Math.abs(a.number - current.number));
    evict(candidates[0]);
  }
}
function releasePixels(canvas) {
  if (!canvas) return;
  // Clearing several large backing stores during one zoom/restore event can
  // stall the main thread even though the DOM work is small. Dispose one per task.
  setTimeout(() => timed('release', () => { canvas.width = canvas.height = 0; }), 0);
}
function evict(page) {
  page.renderTask?.cancel(); page.renderTask = null;
  page.textLayer?.cancel(); page.textLayer = null;
  releasePixels(page.canvas); releasePixels(page.copy);
  const proxy = page.proxy;
  if (proxy) setTimeout(() => { try { proxy.cleanup(); } catch { /* document already closed */ } }, 0);
  page.canvas = page.copy = page.overlay = page.proxy = null;
  page.atomGeometry = null;
  page.ready = false; page.transBuilt = false; page.whited = new Set(); page.blockEls = new Map();
  page.orig.replaceChildren(placeholder('靠近此页时加载'));
  page.trans.replaceChildren(transPlaceholder(page));
  resident.delete(page);
  delete page.shell.dataset.rendered;
}

function needsWork(page) { return view === 'reflow' ? !page.segments || !page.reflowBuilt : !page.ready; }
async function pump() {
  if (busy || !pdf) return;
  const candidates = [...near].filter(needsWork);
  if (!candidates.length) return;
  const center = currentPage();
  candidates.sort((a, b) => (visible.has(b) - visible.has(a)) || Math.abs(a.number - center) - Math.abs(b.number - center));
  const page = candidates[0];
  busy = true;
  const generation = epoch, rev = revision;
  try {
    await renderPage(page, generation, rev);
  } catch (error) {
    if (generation === epoch && error?.name !== 'RenderingCancelledException') {
      page.orig.replaceChildren(placeholder('此页解析失败；可点击页码跳转重试。'));
      page.failed = true;
      message('部分页面无法渲染，其他页面仍可阅读。', true);
    }
  } finally {
    busy = false;
    if (generation === epoch) {
      if (page.failed) near.delete(page);
    }
    setTimeout(pump, 0); // a replacement document may have been waiting for this render
  }
}

async function extract(page, proxy) {
  if (page.segments) return;
  page.text ??= await proxy.getTextContent();
  const base = proxy.getViewport({ scale: 1 });
  page.segments = await localSegments(displayItems(page.text.items, base.transform, base.height),
    { pageWidth: base.width, pageHeight: base.height, styles: page.text.styles });
  page.sources = new Map();
  for (const block of page.segments.blocks) if (block.kind === 'text') page.sources.set(block.id, blockSource(block));
  if (!page.segments.blocks.some(block => block.kind === 'text') && !page.ready) page.trans.replaceChildren(transPlaceholder(page));
}

async function renderPage(page, generation, rev) {
  const stale = () => generation !== epoch || rev !== revision;
  const proxy = await pdf.getPage(page.number);
  if (stale()) return;
  if (!page.measured) {
    const base = proxy.getViewport({ scale: 1 });
    page.size = { w: base.width, h: base.height }; page.measured = true; sizeSheets(page);
  }
  if (view === 'reflow') {
    await extract(page, proxy);
    if (stale()) return;
    await buildReflow(page, generation, rev);
    requestSoon();
    return;
  }
  const viewport = proxy.getViewport({ scale });
  makeRoom(page);
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
  const canvas = el('canvas');
  canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
  canvas.setAttribute('aria-label', `PDF 原版第 ${page.number} 页`);
  const layer = el('div', 'textLayer'); layer.setAttribute('aria-hidden', 'true');
  page.orig.style.setProperty('--total-scale-factor', scale);
  page.orig.replaceChildren(canvas, layer);
  resident.add(page);
  const rendering = proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false, willReadFrequently: true }), viewport,
    transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], annotationMode: 0 });
  page.renderTask = rendering;
  try { await rendering.promise; } finally { page.renderTask = null; }
  if (stale()) { canvas.width = canvas.height = 0; return; }
  page.text ??= await proxy.getTextContent();
  if (stale()) { canvas.width = canvas.height = 0; return; }
  const textLayer = new TextLayer({ textContentSource: page.text, container: layer, viewport });
  page.textLayer = textLayer;
  const layerStart = performance.now();
  await textLayer.render();
  if (performance.now() - layerStart > 16 && metrics.slow.length < 50) metrics.slow.push({ step: 'textLayer(async)', ms: Math.round(performance.now() - layerStart) });
  if (stale()) { textLayer.cancel(); canvas.width = canvas.height = 0; return; }
  await yieldMain();
  await extract(page, proxy);
  await yieldMain();
  if (stale()) { textLayer.cancel(); canvas.width = canvas.height = 0; return; }
  Object.assign(page, { canvas, ratio, proxy, renderScale: scale, ready: true });
  if (stale() || !page.ready) return;
  page.shell.dataset.rendered = 'true';
  if (!metrics.firstPage) metrics.firstPage = performance.now() - metrics.opened;
  if (session.active) timed('sheet', () => buildTranslated(page));
  else page.trans.replaceChildren(transPlaceholder(page));
  if (page.reflowBuilt) paintReflowAll(page);
  requestSoon();
}

// Colours come from the original rendering, read block by block with yields in between so that no
// readback becomes a long main-thread task. They are only needed once translation is on.
function ensureColors(page) {
  if (page.colors) return Promise.resolve(page.colors);
  if (page.colorsPending) return page.colorsPending;
  const canvas = page.canvas, factor = page.renderScale * page.ratio;
  page.colorsPending = (async () => {
    const colors = new Map();
    const context = canvas.getContext('2d');
    let slice = performance.now();
    for (const block of page.segments.blocks) {
      if (block.kind !== 'text') continue;
      if (page.canvas !== canvas) return null; // evicted or re-rendered meanwhile
      let left = Infinity, top = Infinity, right = 0, bottom = 0;
      for (const r of block.cover) { left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom); }
      const x0 = Math.max(0, Math.floor(left * factor)), y0 = Math.max(0, Math.floor(top * factor));
      const x1 = Math.min(canvas.width, Math.ceil(right * factor)), y1 = Math.min(canvas.height, Math.ceil(bottom * factor));
      if (x1 <= x0 || y1 <= y0) continue;
      let data;
      try { data = context.getImageData(x0, y0, x1 - x0, y1 - y0); } catch { continue; }
      const dx = x0 / factor, dy = y0 / factor;
      const rects = block.cover.map(r => ({ left: r.left - dx, right: r.right - dx, top: r.top - dy, bottom: r.bottom - dy }));
      colors.set(block.id, sampleColors({ data: data.data, width: data.width, height: data.height }, rects, factor));
      if (performance.now() - slice > 8) { await yieldMain(); slice = performance.now(); }
    }
    page.colors = colors;
    return colors;
  })().finally(() => { page.colorsPending = null; });
  return page.colorsPending;
}

function boldFont(page, block) {
  if (block.role === 'heading') return true;
  if (!block.font || !page.proxy) return false;
  page.bold ??= new Map();
  if (!page.bold.has(block.font)) {
    let bold = false;
    try {
      const font = page.proxy.commonObjs.has(block.font) ? page.proxy.commonObjs.get(block.font) : null;
      bold = !!font && (font.bold === true || font.black === true || /bold|black|heavy|semibold|demi|-medi|\.b$|cmbx/i.test(String(font.name || '')));
    } catch { bold = false; }
    page.bold.set(block.font, bold);
  }
  return page.bold.get(block.font);
}

// ---- translated sheet ----------------------------------------------------------------------
function buildTranslated(page) {
  if (!page.ready || page.transBuilt || !page.canvas) return;
  // The translated sheet shows a snapshot of the original rendering. createImageBitmap copies it
  // asynchronously and bitmaprenderer displays it without another main-thread pixel copy.
  const copy = el('canvas');
  copy.width = page.canvas.width; copy.height = page.canvas.height;
  copy.setAttribute('aria-hidden', 'true');
  const overlay = el('div', 'overlay');
  overlay.lang = settings.targetLang;
  page.trans.replaceChildren(copy, overlay);
  Object.assign(page, { copy, overlay, transBuilt: true, whited: new Set(), blockEls: new Map() });
  createImageBitmap(page.canvas).then(bitmap => {
    if (page.copy !== copy) { bitmap.close(); return; }
    const renderer = copy.getContext('bitmaprenderer');
    if (renderer) renderer.transferFromImageBitmap(bitmap);
    else { copy.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); }
  }, () => {});
  if (!page.segments.blocks.some(block => block.kind === 'text')) overlay.append(placeholder('此页没有可读取的文本层（可能为扫描件），不提供 OCR'));
  const ids = page.segments.blocks.filter(block => block.kind === 'text').map(block => blockId(page, block));
  queuePaint(ids);
  void ensureColors(page).then(colors => { if (colors && page.overlay === overlay) queuePaint(ids); });
}
function clearTranslated(page) {
  releasePixels(page.copy);
  Object.assign(page, { copy: null, overlay: null, transBuilt: false, whited: new Set(), blockEls: new Map() });
  page.trans.replaceChildren(transPlaceholder(page));
}
function scheduleSheet(page) {
  const generation = session.generation, documentEpoch = epoch;
  setTimeout(() => {
    if (session.active && session.generation === generation && epoch === documentEpoch && resident.has(page)) {
      timed('sheet', () => buildTranslated(page));
    }
  }, 0);
}

// Cover the original words of one block, line by line, with their own background colour.
function whiteout(page, block, background) {
  const s = page.renderScale;
  const pad = block.size * .16;
  const group = el('div', 'wo');
  group.dataset.block = block.id;
  for (const r of block.cover) {
    const rect = el('div');
    Object.assign(rect.style, { left: `${(r.left - .8) * s}px`, top: `${(r.top - pad) * s}px`,
      width: `${(r.right - r.left + 1.6) * s}px`, height: `${(r.bottom - r.top + pad * 2) * s}px`, background: cssColor(background) });
    group.append(rect);
  }
  page.overlay.prepend(group);
}

const ATOM_PAD = .5;
function atomGeometry(page, atom) {
  page.atomGeometry ??= new WeakMap();
  if (page.atomGeometry.has(atom)) return page.atomGeometry.get(atom);
  const f = page.renderScale * page.ratio, r = atom.rect;
  const x = Math.max(0, Math.floor(r.left * f)), y = Math.max(0, Math.floor(r.top * f));
  const w = Math.min(page.canvas.width, Math.ceil(r.right * f)) - x;
  const h = Math.min(page.canvas.height, Math.ceil(r.bottom * f)) - y;
  let adjusted = atom;
  if (w > 0 && h > 0) {
    const pixels = page.canvas.getContext('2d').getImageData(x, y, w, h);
    const bg = sampleColors(pixels, [{ left: 0, top: 0, right: w, bottom: h }], 1).background;
    const ink = inkBounds(pixels, bg);
    if (ink) adjusted = { ...atom, rect: { left: (x + ink.left) / f, top: (y + ink.top) / f,
      right: (x + ink.right) / f, bottom: (y + ink.bottom) / f } };
  }
  page.atomGeometry.set(atom, adjusted);
  return adjusted;
}
function atomItem(atom) { return { atom: true, em: (atom.rect.right - atom.rect.left + ATOM_PAD * 2) / atom.size }; }
function atomElement(page, atom, fontPx) {
  const k = fontPx / atom.size;
  const r = atom.rect, w = r.right - r.left + ATOM_PAD * 2, h = r.bottom - r.top + ATOM_PAD * 2;
  const f = page.renderScale * page.ratio;
  const canvas = el('canvas', 'tm');
  canvas.width = Math.max(1, Math.ceil(w * f)); canvas.height = Math.max(1, Math.ceil(h * f));
  canvas.getContext('2d').drawImage(page.canvas, (r.left - ATOM_PAD) * f, (r.top - ATOM_PAD) * f, w * f, h * f, 0, 0, canvas.width, canvas.height);
  canvas.style.width = `${w * k}px`; canvas.style.height = `${h * k}px`;
  canvas.style.verticalAlign = `${-(r.bottom + ATOM_PAD - atom.baseline) * k}px`;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', atom.text);
  return canvas;
}
function mathText(part) {
  const span = el('span', 'tx');
  if (!part.runs) span.textContent = part.text;
  else for (const run of part.runs) {
    if (!run.script) span.append(run.text);
    else { const script = el(run.script); script.textContent = run.text; span.append(script); }
  }
  return span;
}

function paintBlock(page, block) {
  const id = blockId(page, block);
  page.blockEls.get(block.id)?.remove();
  page.blockEls.delete(block.id);
  const entry = session.get(id);
  if (!entry || entry.state === 'skip' || !page.overlay) return;
  const s = page.renderScale, box = block.textBox;
  let node;
  if (entry.state === 'pending') {
    node = el('div', 'tb-wait');
    Object.assign(node.style, { left: `${block.box.left * s - 6}px`, top: `${box.top * s}px`, height: `${Math.max(4, (box.bottom - box.top) * s)}px` });
  } else if (entry.state === 'error') {
    node = el('button', 'tb-retry'); node.type = 'button'; node.textContent = '↻';
    node.title = `翻译失败：${entry.error?.message || '未知错误'}。点击重试`;
    node.setAttribute('aria-label', node.title);
    Object.assign(node.style, { left: `${box.right * s - 10}px`, top: `${box.top * s - 10}px` });
    node.addEventListener('click', () => { session.retry(id); stateChanged(); });
  } else {
    if (entry.same) {
      // A draft may already have hidden the source. An unchanged final must restore
      // the original pixels, including formulas, instead of leaving the old whiteout.
      page.overlay.querySelector(`.wo[data-block="${block.id}"]`)?.remove();
      page.whited.delete(block.id);
      return;
    }
    if (!page.colors) return; // painted again once the colours are sampled
    const colors = page.colors.get(block.id) || { background: [255, 255, 255], foreground: [0, 0, 0] };
    if (!page.whited.has(block.id)) { whiteout(page, block, colors.background); page.whited.add(block.id); }
    const atoms = (page.sources.get(block.id)?.atoms || []).map(atom => atomGeometry(page, atom));
    const items = entry.nodes.map(n => n.t === 'x' ? (atoms[n.n] ? atomItem(atoms[n.n]) : { text: '' }) : { text: n.v });
    const bold = boldFont(page, block);
    const plan = planBlock(block, items, { scale: s, measure: bold ? measureBold : measureRegular, metrics: fontMetrics,
      minRatio: block.role === 'toc' || block.role === 'heading' ? .5 : .6 });
    node = el('div', 'tb');
    node.dataset.id = id; node.dataset.stage = entry.state; node.dataset.align = plan.align;
    if (bold) node.dataset.heading = '';
    if (entry.refined === false) node.title = '大模型精修失败，显示的是机器翻译';
    Object.assign(node.style, { left: `${plan.left}px`, top: `${plan.top}px`, width: `${plan.width + 1}px`,
      fontSize: `${plan.size.toFixed(2)}px`, lineHeight: `${plan.lineHeight.toFixed(2)}px`, color: cssColor(colors.foreground),
      textIndent: plan.indent ? `${plan.indent}px` : '' });
    if (plan.overflow) {
      node.dataset.overflow = '';
      node.style.background = cssColor(colors.background);
      node.style.boxShadow = `0 0 0 2px ${cssColor(colors.background)}`;
    }
    for (const n of entry.nodes) {
      if (n.t === 'text') node.append(document.createTextNode(n.v));
      else if (atoms[n.n]) node.append(atomElement(page, atoms[n.n], plan.size));
    }
  }
  node.dataset.block = block.id;
  page.overlay.append(node);
  page.blockEls.set(block.id, node);
}

// ---- reflow --------------------------------------------------------------------------------
async function buildReflow(page, generation, rev) {
  if (page.reflowBuilt || !page.segments) return;
  const fragment = document.createDocumentFragment();
  let slice = performance.now();
  for (const block of page.segments.blocks) {
    if (performance.now() - slice > 8) {
      await yieldMain();
      if (generation !== epoch || rev !== revision || view !== 'reflow') return;
      slice = performance.now();
    }
    if (block.kind === 'label' || !block.text) continue;
    const p = el('p', 'rf');
    p.dataset.kind = block.kind; p.dataset.block = block.id;
    if (block.role) p.dataset.role = block.role;
    if (block.kind === 'text') {
      if (block.label) p.append(block.label);
      for (const part of block.parts) p.append(part.type === 'math' ? mathText(part) : part.text);
    } else if (block.kind === 'math' && block.parts) {
      block.parts.forEach((part, i) => { if (i) p.append(' '); p.append(mathText(part)); });
    } else p.textContent = block.text;
    fragment.append(p);
  }
  if (!page.segments.blocks.some(block => block.kind === 'text')) {
    const note = el('p', 'page-note'); note.textContent = '此页没有可读取的文本层（可能为扫描件），本轮不提供 PDF OCR。'; fragment.append(note);
  }
  page.reflow.replaceChildren(fragment);
  page.reflowBuilt = true;
  page.rfEls = new Map();
  paintReflowAll(page);
}
function paintReflowAll(page) {
  if (!page.reflowBuilt || !session.active) return;
  queuePaint(page.segments.blocks.filter(block => block.kind === 'text').map(block => blockId(page, block)));
}
function paintReflow(page, block) {
  const id = blockId(page, block);
  page.rfEls.get(block.id)?.remove();
  page.rfEls.delete(block.id);
  const entry = session.get(id);
  if (!entry || entry.state === 'skip' || entry.state === 'pending' || entry.same) return;
  const anchor = page.reflow.querySelector(`.rf[data-block="${block.id}"]`);
  if (!anchor) return;
  const node = el('span', 'rf-t');
  node.dataset.stage = entry.state;
  if (entry.state === 'error') {
    node.classList.add('error'); node.textContent = `翻译失败：${entry.error?.message || '未知错误'}（点击重试）`;
    node.addEventListener('click', () => { session.retry(id); stateChanged(); });
  } else {
    const atoms = page.sources.get(block.id)?.atoms || [];
    for (const n of entry.nodes) {
      if (n.t === 'text') node.append(document.createTextNode(n.v));
      else if (atoms[n.n]) node.append(mathText(atoms[n.n]));
    }
  }
  anchor.after(node);
  page.rfEls.set(block.id, node);
}

// ---- painting queue ------------------------------------------------------------------------
function queuePaint(ids) {
  for (const id of ids) paintQueue.add(id);
  if (!paintFrame) paintFrame = requestAnimationFrame(flushPaint);
}
function flushPaint() {
  paintFrame = 0;
  const start = performance.now();
  for (const id of paintQueue) {
    paintQueue.delete(id);
    const match = /^p(\d+)-b(\d+)$/.exec(id);
    const page = match && pages[Number(match[1]) - 1];
    const block = page?.segments?.blocks[Number(match[2])];
    if (!block) continue;
    const entry = session.get(id);
    if (entry?.state === 'draft' && !metrics.firstDraft) metrics.firstDraft = performance.now() - metrics.activated;
    if (entry?.state === 'final' && !metrics.firstFinal) metrics.firstFinal = performance.now() - metrics.activated;
    if (page.transBuilt) timed('paint', () => paintBlock(page, block));
    if (page.reflowBuilt) paintReflow(page, block);
    if (performance.now() - start > 12) break;
  }
  if (paintQueue.size) paintFrame = requestAnimationFrame(flushPaint);
  stateChanged();
}

// ---- translation ---------------------------------------------------------------------------
function requestSoon() {
  clearTimeout(requestTimer);
  requestTimer = setTimeout(requestTranslations, 60);
}
function requestTranslations() {
  if (!session.active || !pages.length) return;
  const shown = [...visible].map(page => page.number).sort((a, b) => a - b);
  if (!shown.length) return;
  // Jumping far away must not leave the new page queued behind pages nobody is reading.
  const low = Math.min(...shown) - 2, high = Math.max(...shown) + 2;
  session.release(id => { const n = Number(/^p(\d+)-/.exec(id)?.[1]); return n >= low && n <= high; });
  const order = [];
  const center = currentPage();
  for (const n of shown.sort((a, b) => Math.abs(a - center) - Math.abs(b - center))) order.push([n, PRIORITY.VISIBLE]);
  if (shown.at(-1) < pages.length) order.push([Math.max(...shown) + 1, PRIORITY.NEAR]);
  if (Math.min(...shown) > 1) order.push([Math.min(...shown) - 1, PRIORITY.NEAR]);
  for (const [number, priority] of order) {
    const page = pages[number - 1];
    if (!page?.segments) continue;
    const list = page.segments.blocks.filter(block => block.kind === 'text')
      .map(block => ({ id: blockId(page, block), source: page.sources.get(block.id) }));
    if (session.request(list, priority)) queuePaint(list.map(item => item.id));
  }
  stateChanged();
}
function activate() {
  if (!pdf) return;
  if (!session.active) {
    session.start();
    metrics.activated = performance.now(); metrics.firstDraft = metrics.firstFinal = 0;
    document.body.classList.add('translating');
    for (const page of resident) scheduleSheet(page);
    for (const page of pages) if (page.reflowBuilt) paintReflowAll(page);
  } else {
    for (const page of visible) {
      for (const block of page.segments?.blocks || []) if (block.kind === 'text') session.retry(blockId(page, block));
    }
  }
  requestTranslations();
  stateChanged();
}
function deactivate() {
  session.stop();
  paintQueue.clear();
  document.body.classList.remove('translating');
  for (const page of pages) {
    if (page.transBuilt) clearTranslated(page);
    for (const node of page.rfEls.values()) node.remove();
    page.rfEls = new Map();
  }
  hideHighlight();
  stateChanged();
  message('已恢复原文，停止待处理翻译。');
}
function retranslate() {
  if (!session.active) return;
  session.stop(); session.start();
  for (const page of pages) {
    if (page.transBuilt) { clearTranslated(page); scheduleSheet(page); }
    for (const node of page.rfEls.values()) node.remove();
    page.rfEls = new Map();
  }
  requestTranslations();
}

// ---- hover link: translated block -> original block -----------------------------------------
let highlight = null;
function hideHighlight() { highlight?.remove(); highlight = null; }
$('pdf-pages').addEventListener('pointerover', event => {
  const node = event.target.closest?.('.tb');
  if (!node || view !== 'side') { if (!event.target.closest?.('.tb')) hideHighlight(); return; }
  const page = pages[Number(node.closest('.pdf-page')?.dataset.page) - 1];
  const block = page?.segments?.blocks[Number(node.dataset.block)];
  if (!block || !page.ready) return;
  hideHighlight();
  highlight = el('div', 'hl');
  const s = page.renderScale, b = block.box;
  Object.assign(highlight.style, { left: `${b.left * s - 2}px`, top: `${b.top * s - 2}px`, width: `${(b.right - b.left) * s + 4}px`, height: `${(b.bottom - b.top) * s + 4}px` });
  page.orig.append(highlight);
});

// ---- views and zoom ------------------------------------------------------------------------
function applyView(next) {
  const previous = view;
  view = VIEWS.includes(next) ? next : 'side';
  document.body.dataset.view = view;
  $('mode').value = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ }
  hideHighlight();
  const columnsChanged = (previous === 'side') !== (view === 'side');
  if ($('zoom').value === 'fit' && columnsChanged) rescale();
  else setTimeout(pump, 0);
}
function rescale() {
  const next = chosenScale();
  if (!pdf || Math.abs(next - scale) < .005) { setTimeout(pump, 0); return; }
  const anchor = currentPage();
  const anchorRect = pages[anchor - 1]?.shell.getBoundingClientRect();
  const offset = anchorRect ? (innerHeight * .4 - anchorRect.top) / Math.max(1, anchorRect.height) : 0;
  revision++;
  scale = next;
  for (const page of pages) {
    page.renderTask?.cancel();
    if (resident.has(page)) evict(page);
    sizeSheets(page);
  }
  const shell = pages[anchor - 1]?.shell;
  if (shell) {
    const rect = shell.getBoundingClientRect();
    scrollBy(0, rect.top + offset * rect.height - innerHeight * .4);
  }
  setTimeout(pump, 0);
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('zoom').value === 'fit') rescale(); }, 200);
});
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (document.activeElement !== $('page-number') && pages.length) $('page-number').value = currentPage();
  });
}, { passive: true });

function watchPages() {
  nearObserver?.disconnect(); visibleObserver?.disconnect();
  near.clear(); visible.clear();
  nearObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const page = pages[Number(entry.target.dataset.page) - 1];
      if (!page) continue;
      if (entry.isIntersecting) { near.add(page); page.failed = false; } else near.delete(page);
    }
    setTimeout(pump, 0);
  }, { rootMargin: '120% 0px' });
  visibleObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const page = pages[Number(entry.target.dataset.page) - 1];
      if (!page) continue;
      if (entry.isIntersecting) visible.add(page); else visible.delete(page);
    }
    requestSoon();
  }, { rootMargin: '0px' });
  for (const page of pages) { nearObserver.observe(page.shell); visibleObserver.observe(page.shell); }
}

// ---- open ----------------------------------------------------------------------------------
async function open(data) {
  const generation = ++epoch;
  revision++;
  metrics.opened = performance.now(); metrics.firstPage = 0;
  nearObserver?.disconnect(); visibleObserver?.disconnect();
  session.stop(); paintQueue.clear();
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  $('translate').disabled = true; $('restore').disabled = true; ball.disabled = true;
  pdf = null;
  await task?.destroy();
  if (generation !== epoch) return;
  document.body.classList.remove('translating');
  pages = []; $('pdf-pages').replaceChildren();
  const loading = getDocument({ data: checkPDFBytes(data), isEvalSupported: false,
    enableXfa: false, wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href,
    useSystemFonts: true, stopAtErrors: true });
  // No annotation layer, document scripts, forms or automatic external links.
  task = loading;
  loading.onPassword = () => { message('加密 PDF 暂不支持，请先在本地解密后重新选择文件。', true); void loading.destroy(); };
  const opened = await loading.promise;
  if (generation !== epoch) { await loading.destroy(); return; }
  pdf = opened;
  if (pdf.numPages > 2000) { await task.destroy(); pdf = null; throw new Error('最多打开 2000 页 PDF；请先在本地拆分。'); }
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const size = { w: base.width, h: base.height };
  if (generation !== epoch) return;
  $('page-count').textContent = '/ ' + pdf.numPages; $('page-number').max = pdf.numPages;
  $('page-number').value = 1;
  scale = $('zoom').value === 'fit' ? fitScale(size.w) : Number($('zoom').value);
  const fragment = document.createDocumentFragment();
  for (let number = 1; number <= pdf.numPages; number++) {
    if (number % 40 === 0) { await yieldMain(); if (generation !== epoch) return; }
    const page = createPage(number, size);
    pages.push(page); fragment.append(page.shell);
  }
  $('pdf-pages').append(fragment);
  watchPages();
  $('translate').disabled = false; ball.disabled = false;
  stateChanged();
  message(`已打开 ${pdf.numPages} 页 PDF。确认模型设置后点击「翻译」。`);
}
async function guarded(fn, request = sourceRequest) {
  try { await fn(); } catch {
    if (request === sourceRequest) message('无法打开 PDF：文件无效、过大、加密，或链接需要登录/重定向。请先下载后选择本地文件；file:// 需允许访问文件网址。', true);
  }
}

// ---- controls ------------------------------------------------------------------------------
$('translate').addEventListener('click', activate);
$('restore').addEventListener('click', deactivate);
$('mode').value = view;
document.body.dataset.view = view;
$('mode').addEventListener('change', () => applyView($('mode').value));
$('theme').addEventListener('change', () => {
  if ($('theme').value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = $('theme').value;
});
$('zoom').addEventListener('change', rescale);
function jump() {
  const number = Math.min(pages.length, Math.max(1, Math.trunc(Number($('page-number').value)) || 1));
  $('page-number').value = number;
  const page = pages[number - 1];
  if (!page) return;
  page.failed = false;
  page.shell.scrollIntoView({ block: 'start' });
  near.add(page);
  setTimeout(pump, 0);
}
$('jump').addEventListener('click', jump);
$('page-number').addEventListener('keydown', e => { if (e.key === 'Enter') jump(); });
$('settings').addEventListener('click', () => platform.openSettings());
$('local-file').addEventListener('change', () => {
  const file = $('local-file').files[0];
  const request = ++sourceRequest;
  if (file) void guarded(async () => {
    if (file.size > MAX_PDF_BYTES) throw new Error('too large');
    const data = new Uint8Array(await file.arrayBuffer());
    if (request === sourceRequest) await open(data);
  }, request);
  $('local-file').value = '';
});
const unsubscribe = platform.settingsStore.onChange(() => { void guarded(async () => {
  const previous = settings; settings = await platform.settingsStore.load();
  const strip = value => JSON.stringify({ ...value, displayMode: null, style: null, floatBall: null });
  if (strip(previous) !== strip(settings)) retranslate();
  // The shared "bilingual / translation only" switch (popup, options) maps onto the PDF views.
  if (previous.displayMode !== settings.displayMode && view !== 'reflow') {
    applyView(settings.displayMode === 'translation-only' ? 'translated' : 'side');
  }
  if (settings.floatBall.enabled) floating.attach(); else floating.detach();
  stateChanged();
}); });
const removeMessages = platform.onMessage((msg, reply) => {
  if (msg?.type === 'get-state') {
    const stats = session.stats();
    reply({ translated: session.active, mode: view === 'translated' ? 'translation-only' : 'bilingual', view,
      units: stats.total, pending: stats.pending + stats.draft, failed: stats.failed,
      done: stats.done, dormant: false, ui: { floatBall: ball.isConnected }, comics: [] });
    return false;
  }
  if (msg?.type !== 'command' || !pdf) return false;
  if (msg.name === 'toggle-page') { if (session.active) deactivate(); else activate(); }
  else if (msg.name === 'toggle-translation-only') applyView(view === 'translated' ? 'side' : 'translated');
  stateChanged(); reply({ ok: true }); return false;
});
window.addEventListener('pagehide', () => {
  epoch++; sourceRequest++; unsubscribe(); nearObserver?.disconnect(); visibleObserver?.disconnect();
  session.stop(); removeMessages(); floating.detach();
  segmentWorker?.terminate(); segmentWorker = null;
  for (const job of segmentJobs.values()) job.reject(new Error('PDF reader closed'));
  segmentJobs.clear();
  cancelAnimationFrame(paintFrame);
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  void task?.destroy();
}, { once: true });
const file = new URL(location.href).searchParams.get('file');
if (file) {
  const request = ++sourceRequest;
  void guarded(async () => {
    const data = await readPDFURL(file, { fileAccess: () => chrome.extension.isAllowedFileSchemeAccess() });
    if (request === sourceRequest) await open(data);
  }, request);
}
else if (new URL(location.href).searchParams.get('notice') === 'not-pdf') {
  message('当前页面未确认是 PDF（或匿名探测失败）。请打开 PDF 文件后重试，也可选择已下载的本地 PDF。', true);
} else message('请选择本地 PDF，或从 PDF 标签页的 DualLens 弹出页/右键菜单打开。');

import { getDocument, GlobalWorkerOptions, TextLayer } from '../vendor/pdfjs/pdf.min.js';
import { createExtensionPlatform } from '../platform/extension.js';
import { PageTranslator } from '../content/controller.js';
import { segmentTextItems } from './segments.js';
import { checkPDFBytes, readPDFURL, MAX_PDF_BYTES } from './source.js';

GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const platform = createExtensionPlatform();
const $ = id => document.getElementById(id);
let settings = await platform.settingsStore.load();
let mode = settings.displayMode;
let pdf, task, pages = [], observer, translator;
let epoch = 0, serial = Promise.resolve();
let zoomRevision = 0;
const resident = new Map();
const effectiveSettings = () => ({ ...settings, displayMode: mode, inlineMaxChars: 0,
  siteRules: { always: [], never: [], custom: [{ match: '*', include: ['.paragraphs'], exclude: [] }] } });
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function stateChanged() {
  if (!translator) return;
  const state = translator.getState();
  $('translate').textContent = state.translated ? '继续翻译附近段落' : '翻译附近段落';
  $('restore').disabled = !state.translated;
  document.body.classList.toggle('only', state.translated && mode === 'translation-only');
  if (state.translated) message(`已翻译 ${state.done} 段 · 待处理 ${state.pending} · 失败 ${state.failed}（点击段落 ↻ 重试）`);
}
function buildTranslator() {
  translator = new PageTranslator({ platform, getSettings: effectiveSettings, onChange: stateChanged });
}
function watchPages() {
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) enqueue(pages[Number(e.target.dataset.page) - 1]);
  }, { rootMargin: '400px 0px' });
  for (const page of pages) observer.observe(page.shell);
}
function enqueue(page) {
  if (!page || page.queued || (page.rendered && resident.has(page.number))) return;
  page.queued = true;
  const generation = epoch;
  let revision = zoomRevision;
  serial = serial.catch(() => {}).then(async () => {
    try {
      revision = zoomRevision;
      if (generation === epoch) await render(page, generation, revision);
    } catch (error) {
      if (generation === epoch) {
        if (error.name !== 'RenderingCancelledException') {
          page.note.textContent = '此页解析失败；可点击页码跳转重试。';
          message('部分页面无法渲染，其他页面仍可阅读。', true);
        }
      }
    } finally {
      page.queued = false;
      if (generation === epoch && revision !== zoomRevision) {
        evict(page);
        page.visual.replaceChildren();
        const rect = page.shell.getBoundingClientRect();
        if (rect.bottom > -400 && rect.top < innerHeight + 400) enqueue(page);
      }
    }
  });
}
async function render(page, generation, revision) {
  const proxy = await pdf.getPage(page.number);
  if (generation !== epoch) return;
  const scale = Number($('zoom').value);
  const viewport = proxy.getViewport({ scale });
  // Evict before allocating the next surface, including the in-flight canvas in
  // the four-page bound (not only completed entries).
  while (resident.size >= 4) {
    const farthest = [...resident.keys()].sort((a, b) => Math.abs(b - page.number) - Math.abs(a - page.number))[0];
    evict(pages[farthest - 1]);
  }
  const surface = document.createElement('div'); surface.className = 'pdf-surface'; surface.setAttribute('translate', 'no');
  surface.style.width = viewport.width + 'px'; surface.style.height = viewport.height + 'px';
  surface.style.setProperty('--total-scale-factor', scale);
  const canvas = document.createElement('canvas');
  // Bound canvas backing memory independently of zoom and device pixel ratio.
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height)));
  canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
  canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
  canvas.setAttribute('aria-label', `PDF 原版第 ${page.number} 页`);
  const layer = document.createElement('div'); layer.className = 'textLayer'; layer.setAttribute('aria-hidden', 'true');
  surface.append(canvas, layer);
  page.visual.replaceChildren(surface);
  const rendering = proxy.render({ canvasContext: canvas.getContext('2d'), viewport,
    transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], annotationMode: 0 });
  page.renderTask = rendering;
  try { await rendering.promise; } finally { page.renderTask = null; }
  if (generation !== epoch || revision !== zoomRevision) { canvas.width = canvas.height = 0; return; }
  const text = await proxy.getTextContent();
  const textLayer = new TextLayer({ textContentSource: text, container: layer, viewport });
  await textLayer.render();
  if (generation !== epoch || revision !== zoomRevision) { textLayer.cancel(); canvas.width = canvas.height = 0; return; }
  if (!page.rendered) {
    const paragraphs = segmentTextItems(text.items);
    for (const paragraph of paragraphs) {
      const p = document.createElement('p'); p.textContent = paragraph.text;
      page.paragraphs.append(p);
    }
    page.note.textContent = paragraphs.length ? '' : '此页没有可读取的文本层（可能为扫描件），本轮不提供 PDF OCR。';
    page.shell.style.setProperty('--page-height', Math.max(viewport.height + 24, 180) + 'px');
    page.rendered = true;
  }
  page.shell.dataset.rendered = 'true';
  resident.delete(page.number);
  resident.set(page.number, { canvas, textLayer, proxy });
  // Keep at most four rendered surfaces. Paragraph DOM remains for restore/cache.
}
function evict(page) {
  const data = resident.get(page.number);
  if (!data) return;
  data.textLayer.cancel(); data.canvas.width = data.canvas.height = 0;
  data.proxy.cleanup(); resident.delete(page.number);
  page.visual.replaceChildren();
  const placeholder = document.createElement('div'); placeholder.className = 'placeholder';
  placeholder.textContent = '页面在靠近视口时重新渲染'; page.visual.append(placeholder);
  delete page.shell.dataset.rendered;
}
async function open(data) {
  const generation = ++epoch;
  observer?.disconnect(); translator?.destroy(); translator = null;
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  await task?.destroy();
  $('translate').disabled = true; $('restore').disabled = true;
  document.body.classList.remove('only');
  pages = []; $('pdf-pages').replaceChildren();
  task = getDocument({ data: checkPDFBytes(data), isEvalSupported: false,
    enableXfa: false, wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href,
    useSystemFonts: true, stopAtErrors: true });
  // No annotation layer, document scripts, forms or automatic external links.
  task.onPassword = () => { message('加密 PDF 暂不支持，请先在本地解密后重新选择文件。', true); void task.destroy(); };
  pdf = await task.promise;
  if (generation !== epoch) return;
  if (pdf.numPages > 2000) { await task.destroy(); throw new Error('最多打开 2000 页 PDF；请先在本地拆分。'); }
  $('page-count').textContent = '/ ' + pdf.numPages; $('page-number').max = pdf.numPages;
  $('page-number').value = 1;
  for (let number = 1; number <= pdf.numPages; number++) {
    const shell = document.createElement('section'); shell.className = 'pdf-page'; shell.dataset.page = number;
    const title = document.createElement('h2'); title.textContent = `第 ${number} 页`; title.setAttribute('translate', 'no');
    const layout = document.createElement('div'); layout.className = 'page-layout';
    const visual = document.createElement('div'); visual.className = 'visual'; visual.setAttribute('translate', 'no');
    const placeholder = document.createElement('div'); placeholder.className = 'placeholder'; placeholder.textContent = '靠近此页时加载'; visual.append(placeholder);
    const paragraphs = document.createElement('div'); paragraphs.className = 'paragraphs';
    const note = document.createElement('div'); note.className = 'page-note'; note.setAttribute('translate', 'no'); paragraphs.append(note);
    layout.append(visual, paragraphs); shell.append(title, layout); $('pdf-pages').append(shell);
    pages.push({ number, shell, visual, paragraphs, note, rendered: false, queued: false });
  }
  buildTranslator(); watchPages(); $('translate').disabled = false;
  message(`已打开 ${pdf.numPages} 页 PDF。先确认模型设置，再点击翻译。`);
}
async function guarded(fn) { try { await fn(); } catch { message('无法打开 PDF：文件无效、过大、加密，或链接需要登录/重定向。请先下载后选择本地文件；file:// 需允许访问文件网址。', true); } }
$('translate').addEventListener('click', () => { translator?.start(); stateChanged(); });
$('restore').addEventListener('click', () => { translator?.stop(); stateChanged(); message('已恢复原文，停止待处理翻译。'); });
$('mode').value = mode;
$('mode').addEventListener('change', () => { mode = $('mode').value; translator?.setDisplayMode(mode); stateChanged(); });
$('theme').addEventListener('change', () => {
  if ($('theme').value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = $('theme').value;
});
$('zoom').addEventListener('change', () => {
  zoomRevision++;
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  watchPages();
});
function jump() {
  const number = Math.min(pages.length, Math.max(1, Math.trunc(Number($('page-number').value)) || 1));
  $('page-number').value = number;
  const page = pages[number - 1]; page?.shell.scrollIntoView({ block: 'start' }); enqueue(page);
}
$('jump').addEventListener('click', jump);
$('page-number').addEventListener('keydown', e => { if (e.key === 'Enter') jump(); });
$('settings').addEventListener('click', () => platform.openSettings());
$('local-file').addEventListener('change', () => {
  const file = $('local-file').files[0];
  if (file) void guarded(async () => {
    if (file.size > MAX_PDF_BYTES) throw new Error('too large');
    await open(new Uint8Array(await file.arrayBuffer()));
  });
  $('local-file').value = '';
});
const unsubscribe = platform.settingsStore.onChange(() => { void guarded(async () => {
  settings = await platform.settingsStore.load(); translator?.retranslate();
}); });
window.addEventListener('pagehide', () => {
  epoch++; unsubscribe(); observer?.disconnect(); translator?.destroy();
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  void task?.destroy();
}, { once: true });
const file = new URL(location.href).searchParams.get('file');
if (file) void guarded(async () => open(await readPDFURL(file, {
  fileAccess: () => chrome.extension.isAllowedFileSchemeAccess(),
})));
else if (new URL(location.href).searchParams.get('notice') === 'not-pdf') {
  message('当前页面未确认是 PDF（或匿名探测失败）。请打开 PDF 文件后重试，也可选择已下载的本地 PDF。', true);
} else message('请选择本地 PDF，或从 PDF 标签页的 DualLens 弹出页/右键菜单打开。');

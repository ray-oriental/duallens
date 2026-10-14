import { getDocument, GlobalWorkerOptions, TextLayer } from '../vendor/pdfjs/pdf.min.js';
import { createExtensionPlatform } from '../platform/extension.js';
import { PageTranslator } from '../content/controller.js';
import { segmentTextItems } from './segments.js';
import { checkPDFBytes, readPDFURL, MAX_PDF_BYTES } from './source.js';
import { createOverlay } from '../content/overlay.js';
import { lensIcon } from '../content/visual.js';

GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
const platform = createExtensionPlatform();
const $ = id => document.getElementById(id);
let settings = await platform.settingsStore.load();
let mode = settings.displayMode;
let pdf, task, pages = [], observer, translator;
let epoch = 0, serial = Promise.resolve();
let zoomRevision = 0;
let alignmentFrame = 0;
const resident = new Map();
const floating = createOverlay(`.pdf-ball{position:fixed;right:max(6px,env(safe-area-inset-right));top:60vh;width:44px;height:44px;border:0;border-radius:50%;background:linear-gradient(135deg,#4263eb,#20c997);box-shadow:0 2px 10px #0004;cursor:pointer;pointer-events:auto;touch-action:none}.pdf-ball svg{width:22px;height:22px}.pdf-ball:disabled{opacity:.4}.pdf-ball[aria-pressed=true]{outline:2px solid #20c997;outline-offset:3px}`);
const ball = document.createElement('button');ball.className='pdf-ball';ball.type='button';
ball.setAttribute('aria-label','翻译或恢复当前 PDF');ball.title='翻译 / 恢复 PDF（拖动可移动，右键返回工具栏）';
ball.append(lensIcon(true));floating.el.append(ball);
if(settings.floatBall.enabled) floating.attach();
ball.disabled=true;
ball.addEventListener('click',()=> { if(!translator) return;translator.toggle();stateChanged(); });
ball.addEventListener('contextmenu',event=> {event.preventDefault();document.querySelector('header').scrollIntoView({block:'start'});$('translate').focus();});
ball.addEventListener('pointerdown',event=> {
  if(event.button!==0 || !event.isPrimary) return;
  const origin=ball.getBoundingClientRect();let moved=false;
  ball.setPointerCapture(event.pointerId);
  const move=e=> {
    if(e.pointerId!==event.pointerId) return;
    if(!moved && Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<5) return;
    moved=true;
    ball.style.left=Math.max(6,Math.min(innerWidth-50,origin.left+e.clientX-event.clientX))+'px';
    ball.style.top=Math.max(6,Math.min(innerHeight-50,origin.top+e.clientY-event.clientY))+'px';ball.style.right='auto';
  };
  const end=e=> {
    if(e.pointerId!==event.pointerId) return;
    ball.removeEventListener('pointermove',move);ball.removeEventListener('pointerup',end);ball.removeEventListener('pointercancel',end);
    if(ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    if(moved) ball.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();},{once:true,capture:true});
  };
  ball.addEventListener('pointermove',move);ball.addEventListener('pointerup',end);ball.addEventListener('pointercancel',end);
});
function alignParagraphs() {
  alignmentFrame = 0;
  // Flow layout gives long translations room; source coordinates add spacing, never absolute overlap.
  for (const page of pages) {
    if (!page.rendered) continue;
    const scale = Number($('zoom').value);
    let bottom = 0;
    for (const paragraph of page.paragraphs.querySelectorAll(':scope > p')) {
      const target = Number(paragraph.dataset.offset) * scale;
      const gap = document.body.classList.contains('only') ? 0 : Math.max(0, target - bottom);
      paragraph.style.marginBlockStart = `${gap}px`;
      bottom += gap + paragraph.getBoundingClientRect().height + 12;
    }
  }
}
function scheduleAlignment() {
  if (!alignmentFrame) alignmentFrame = requestAnimationFrame(alignParagraphs);
}
function appendMathContent(element,part) {
  if(!part.runs) {element.textContent=part.text;return;}
  for(const run of part.runs) {
    if(!run.script) element.append(document.createTextNode(run.text));
    else {const script=document.createElement(run.script);script.textContent=run.text;element.append(script);}
  }
}
const paragraphResize = new ResizeObserver(scheduleAlignment);
window.addEventListener('resize', scheduleAlignment);
const effectiveSettings = () => ({ ...settings, displayMode: mode, inlineMaxChars: 0,
  siteRules: { always: [], never: [], custom: [{ match: '*', include: ['.paragraphs'], exclude: [] }] } });
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function stateChanged() {
  if (!translator) return;
  const state = translator.getState();
  ball.disabled=false;ball.setAttribute('aria-pressed',String(state.translated));
  $('translate').textContent = state.translated ? '继续翻译附近段落' : '翻译附近段落';
  $('restore').disabled = !state.translated;
  document.body.classList.toggle('only', state.translated && mode === 'translation-only');
  scheduleAlignment();
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
    const paragraphs = segmentTextItems(text.items,{pageHeight:proxy.view[3]-proxy.view[1],pageNumber:page.number});
    for (const paragraph of paragraphs) {
      const p = document.createElement('p');
      p.dataset.offset = Math.max(0,proxy.view[3]-paragraph.y-paragraph.lines[0].height);
      if (paragraph.kind !== 'prose') {
        p.className = paragraph.kind === 'margin' ? 'pdf-margin' : 'pdf-formula';
        p.setAttribute('translate','no');
        appendMathContent(p,paragraph.parts[0]);
      } else for (const part of paragraph.parts) {
        if (part.type === 'text') p.append(document.createTextNode(part.text));
        else {
          const math = document.createElement('span');math.className='pdf-math';
          math.setAttribute('translate','no');appendMathContent(math,part);p.append(math);
        }
      }
      page.paragraphs.append(p);
      paragraphResize.observe(p);
    }
    page.note.textContent = paragraphs.length ? '' : '此页没有可读取的文本层（可能为扫描件），本轮不提供 PDF OCR。';
    page.shell.style.setProperty('--page-height', Math.max(viewport.height + 24, 180) + 'px');
    page.rendered = true;
  }
  page.shell.dataset.rendered = 'true';
  resident.delete(page.number);
  resident.set(page.number, { canvas, textLayer, proxy });
  scheduleAlignment();
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
  paragraphResize.disconnect();
  for (const page of pages) { page.renderTask?.cancel(); evict(page); }
  await task?.destroy();
  $('translate').disabled = true; $('restore').disabled = true;
  ball.disabled=true;
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
$('mode').addEventListener('change', () => { mode = $('mode').value; translator?.setDisplayMode(mode); stateChanged();void platform.settingsStore.save({displayMode:mode}); });
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
  const previous=settings;settings = await platform.settingsStore.load();
  mode=settings.displayMode;$('mode').value=mode;
  if(JSON.stringify({...previous,displayMode:null,style:null,floatBall:null}) === JSON.stringify({...settings,displayMode:null,style:null,floatBall:null})) {
    translator?.setDisplayMode(mode);translator?.setStyle(settings.style);
  } else translator?.retranslate();
  if(settings.floatBall.enabled) floating.attach();else floating.detach();
  stateChanged();
}); });
const removeMessages=platform.onMessage((msg,reply)=> {
  if(msg?.type==='get-state') {reply({...translator?.getState(),dormant:false,ui:{floatBall:ball.isConnected},comics:[]});return false;}
  if(msg?.type!=='command' || !translator) return false;
  if(msg.name==='toggle-page') translator.toggle();
  else if(msg.name==='toggle-translation-only') { $('mode').value=mode==='bilingual'?'translation-only':'bilingual';$('mode').dispatchEvent(new Event('change')); }
  stateChanged();reply({ok:true});return false;
});
window.addEventListener('pagehide', () => {
  epoch++; unsubscribe(); observer?.disconnect(); translator?.destroy();
  removeMessages();floating.detach();
  paragraphResize.disconnect();cancelAnimationFrame(alignmentFrame);
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

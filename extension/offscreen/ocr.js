import { ensureLanguage, languageRecord } from './language-store.js';
import { detectTextRegions } from './detector.js';
const manifestReady = fetch('./languages.json').then((res) => res.json());
const nativeWorker = globalThis.Worker;
const workers = new Map();
// Track native workers during createWorker initialization, so a timeout can terminate them too.
globalThis.Worker = class extends nativeWorker {
  constructor(url, options) {
    super(url,options);
    const key = new URL(url,location.href).searchParams.get('job');
    if (key) workers.set(key,this);
  }
};
let seq = 0;
let active = 0;
const queue = [];
function schedule(task) {
  return new Promise((resolve,reject) => { queue.push({ task,resolve,reject }); drain(); });
}
function drain() {
  while (active < 2 && queue.length) {
    const { task,resolve,reject } = queue.shift(); active++;
    Promise.resolve().then(task).then(resolve,reject).finally(() => { active--; drain(); });
  }
}
function imageBlob(base64, type) {
  if (typeof base64 !== 'string' || base64.length > 24*1024*1024) throw new Error('图片过大');
  const raw = atob(base64), bytes = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return new Blob([bytes], { type });
}
async function recognize(msg) {
  const manifest = await manifestReady;
  const lang = msg.lang;
  const loading = await ensureLanguage(lang,manifest);
  const job = String(++seq); let worker, timer; const bitmaps = [];
  let peakHeapBytes=performance.memory?.usedJSHeapSize ?? null;
  const heapSampler=setInterval(()=> { const value=performance.memory?.usedJSHeapSize;if(value!=null) peakHeapBytes=Math.max(peakHeapBytes||0,value); },100);
  const start = performance.now();
  let cancelled = false;
  try {
    const work = (async () => {
      const sources = msg.images || [{ base64: msg.base64, mime: msg.mime }];
      for (const image of sources) {
        const bitmap = await createImageBitmap(imageBlob(image.base64,image.mime));
        if (cancelled) { bitmap.close(); throw new Error('OCR 已取消'); }
        bitmaps.push(bitmap);
      }
      const width = msg.slices?.length ? msg.width : bitmaps[0].width;
      const height = msg.slices?.length ? msg.height : bitmaps[0].height;
      if (!(width > 0 && height > 0) || width*height > 24e6 || bitmaps.some((b) => b.width*b.height>24e6)) throw new Error('图片像素过大（上限 2400 万）');
      const scale = Math.min(1, Math.sqrt(6e6/(width*height)), 3200/Math.max(width,height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width*scale); canvas.height = Math.round(height*scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.scale(scale,scale);
      if (msg.slices?.length) {
        for (const slice of msg.slices) {
          const bitmap = bitmaps[slice.index]; if (!bitmap) throw new Error('画布切片无效');
          const crop = slice.crop || [0,0,bitmap.width,bitmap.height];
          const a = slice.args;
          ctx.save();if(slice.transform) ctx.transform(...slice.transform);
          if (a.length === 8) ctx.drawImage(bitmap, crop[0]+a[0],crop[1]+a[1],a[2],a[3],a[4],a[5],a[6],a[7]);
          else if (a.length === 4) ctx.drawImage(bitmap,...crop,...a);
          else if (a.length === 2) ctx.drawImage(bitmap,...crop,a[0],a[1],crop[2],crop[3]);
          else throw new Error('画布切片参数无效');
          ctx.restore();
        }
      } else ctx.drawImage(bitmaps[0],0,0);
      worker = await Tesseract.createWorker(lang,1, {
        workerPath: new URL(`./ocr-worker.js?job=${job}`,location.href).href,
        corePath: new URL('../vendor/tesseract/tesseract-core-simd-lstm.wasm.js',location.href).href,
        langPath: new URL('./languages',location.href).href,
        workerBlobURL: false, cacheMethod: 'none', gzip: false, logger() {}, errorHandler() {},
      });
      if (cancelled) { await worker.terminate(); throw new Error('OCR 已取消'); }
      const detection=document.createElement('canvas');
      const detectionScale=Math.min(1,800/Math.max(canvas.width,canvas.height));
      detection.width=Math.round(canvas.width*detectionScale);detection.height=Math.round(canvas.height*detectionScale);
      const detectCtx=detection.getContext('2d',{willReadFrequently:true});detectCtx.drawImage(canvas,0,0,detection.width,detection.height);
      const boxes=detectTextRegions(detectCtx.getImageData(0,0,detection.width,detection.height),{vertical:lang==='jpn_vert'});
      detection.width=detection.height=1;
      const regions=[];
      await worker.setParameters({ tessedit_pageseg_mode: lang === 'jpn_vert' ? '5' : boxes.length ? '7' : '11', user_defined_dpi: '150' });
      if(boxes.length) {
        for(const bbox of boxes) {
          if(cancelled) throw new Error('OCR 已取消');
          const rectangle={left:Math.floor(bbox.x0*canvas.width),top:Math.floor(bbox.y0*canvas.height),
            width:Math.ceil((bbox.x1-bbox.x0)*canvas.width),height:Math.ceil((bbox.y1-bbox.y0)*canvas.height)};
          rectangle.width=Math.min(rectangle.width,canvas.width-rectangle.left);rectangle.height=Math.min(rectangle.height,canvas.height-rectangle.top);
          const {data}=await worker.recognize(canvas,{rectangle},{text:true,blocks:false,hocr:false,tsv:false});
          regions.push({text:data.text,confidence:data.confidence,bbox});
        }
      } else {
        const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true,hocr:false,tsv:false});
        for(const p of data.paragraphs || []) regions.push({text:p.text,confidence:p.confidence,
          bbox:{x0:p.bbox.x0/canvas.width,y0:p.bbox.y0/canvas.height,x1:p.bbox.x1/canvas.width,y1:p.bbox.y1/canvas.height}});
      }
      canvas.width = canvas.height = 1;
      if(performance.memory?.usedJSHeapSize!=null) peakHeapBytes=Math.max(peakHeapBytes||0,performance.memory.usedJSHeapSize);
      return { ok: true, regions, width,height, metrics: { language: loading, ocrMs: performance.now()-start,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,peakHeapBytes } };
    })();
    return await Promise.race([work,new Promise((_,reject) => {
      timer = setTimeout(() => { cancelled=true; workers.get(job)?.terminate(); reject(new Error('本地 OCR 超时（20 秒）')); },20000);
    })]);
  } finally {
    clearTimeout(timer); cancelled=true;
    clearInterval(heapSampler);
    for (const bitmap of bitmaps) bitmap.close();
    if (worker) await worker.terminate();
    workers.get(job)?.terminate(); workers.delete(job);
  }
}
chrome.runtime.onMessage.addListener((msg,sender,reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background/service-worker.js')) || msg?.target !== 'comics-offscreen') return false;
  if (msg.type === 'comic-offscreen-ready') { reply({ ok:true }); return false; }
  const task = msg.type === 'comic-ocr-local' ? () => recognize(msg) : async () => {
    const manifest = await manifestReady;
    if (msg.type === 'comic-languages-delete') {
      if (!manifest[msg.lang]) throw new Error('不支持的 OCR 语言');
      await languageRecord(msg.lang,'delete');
    }
    const all = await languageRecord(null,'getAll');
    return { ok: true, languages: all.map(({ lang,bytes }) => ({ lang,bytes })) };
  };
  schedule(task).then(reply).catch((e) => reply({ ok:false,error:{ code:'ocr_failed',message:
    /^(语言包|本地 OCR|图片|画布|不支持|无法打开|OCR 语言)/.test(e?.message) ? `${e.message}；原图已保留` : '本地识别失败：解码或 WASM 不可用；原图已保留' } }));
  return true;
});

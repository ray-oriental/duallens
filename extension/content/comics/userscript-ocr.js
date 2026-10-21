import { t as l10n } from '../../shared/i18n.js';
import { createRuntimeLoader } from './runtime-resources.js';
import { LANGUAGES } from './languages.js';
import { verifyLanguage } from '../../offscreen/language-store.js';
import { detectTextRegions } from '../../offscreen/detector.js';

function fromBase64(value) {
  const raw=atob(value),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function toBase64(data) {
  const bytes=new Uint8Array(data);let raw='';
  for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
export function createUserscriptOCR({ storage,xmlhttpRequest,getResourceText }) {
  const runtime=createRuntimeLoader({storage,xmlhttpRequest,getResourceText});
  let work=Promise.resolve();
  const loading=new Map();
  async function language(lang) {
    const spec=LANGUAGES[lang];if(!spec) throw new Error(l10n('m3r'));
    if(loading.has(lang)) return loading.get(lang);
    const promise=(async()=> {
      const start=performance.now();let data;let downloaded=false;
      const record=(await storage.get(lang))[lang];
      if(record) {
        try { data=fromBase64(record.base64).buffer;await verifyLanguage(data,spec); }
        catch { await storage.remove(lang);data=null; }
      }
      if(!data) {
        downloaded=true;
        data=await new Promise((resolve,reject)=> {
          let handle;handle=xmlhttpRequest({url:spec.url,method:'GET',anonymous:true,responseType:'arraybuffer',timeout:60000,
          onprogress(r) {if(r.loaded>spec.bytes){handle?.abort();reject(new Error(l10n('m3s')));}},
          onload(r) { if(r.status===200) resolve(r.response);else reject(new Error(l10n('m3t'))); },
          onerror:()=>reject(new Error(l10n('m3t'))),ontimeout:()=>reject(new Error(l10n('m3u'))),onabort:()=>reject(new Error(l10n('m3v'))),
        });});
        await verifyLanguage(data,spec);
        await storage.set({[lang]:{base64:toBase64(data),bytes:spec.bytes}});
      }
      return { data,metrics:{downloaded,ms:performance.now()-start,bytes:spec.bytes} };
    })().finally(()=>loading.delete(lang));
    loading.set(lang,promise);return promise;
  }
  async function recognize(blob,{lang}) {
    const [CORE_SOURCE,WORKER_SOURCE]=await runtime();
    const trained=await language(lang);const start=performance.now();
    const workerURL=URL.createObjectURL(new Blob([CORE_SOURCE,'\n',WORKER_SOURCE],{type:'text/javascript'}));
    let worker,bitmap,timer,sequence=0,cancelled=false;const pending=new Map();
    try {
      worker=new Worker(workerURL);
      worker.onmessage=({data})=> {
        const waiting=pending.get(data.jobId);if(!waiting) return;
        if(data.status==='resolve') { pending.delete(data.jobId);waiting.resolve(data.data); }
        if(data.status==='reject') { pending.delete(data.jobId);waiting.reject(new Error(l10n('m3w'))); }
      };
      worker.onerror=()=> { for(const item of pending.values()) item.reject(new Error(l10n('m3x')));pending.clear(); };
      const rpc=(action,payload)=>new Promise((resolve,reject)=> {
        if(cancelled) {reject(new Error(l10n('m3y')));return;}
        const jobId=String(++sequence);pending.set(jobId,{resolve,reject});
        worker.postMessage({workerId:'duallens-local',jobId,action,payload});
      });
      const task=(async()=> {
        bitmap=await createImageBitmap(blob);
        if(cancelled) {bitmap.close();throw new Error(l10n('m3y'));}
        if(bitmap.width*bitmap.height>24e6) throw new Error(l10n('m3z'));
        const scale=Math.min(1,Math.sqrt(3e6/(bitmap.width*bitmap.height)),2400/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
        const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const small=document.createElement('canvas');const ratio=Math.min(1,800/Math.max(canvas.width,canvas.height));
        small.width=Math.round(canvas.width*ratio);small.height=Math.round(canvas.height*ratio);
        const smallCtx=small.getContext('2d',{willReadFrequently:true});smallCtx.drawImage(canvas,0,0,small.width,small.height);
        const boxes=detectTextRegions(smallCtx.getImageData(0,0,small.width,small.height),{vertical:lang==='jpn_vert'});
        small.width=small.height=1;
        const encoded=new Uint8Array(await (await new Promise((resolve)=>canvas.toBlob(resolve,'image/png'))).arrayBuffer());
        await rpc('load',{options:{lstmOnly:true,corePath:'local-bundled'}});
        await rpc('loadLanguage',{langs:[{code:lang,data:new Uint8Array(trained.data)}],options:{cacheMethod:'none',gzip:false,lstmOnly:true}});
        await rpc('initialize',{langs:lang,oem:1,config:{}});
        await rpc('setParameters',{params:{tessedit_pageseg_mode:lang==='jpn_vert'?'5':boxes.length?'7':'11',user_defined_dpi:'150'}});
        const regions=[];
        for(const box of boxes.length?boxes:[null]) {
          const rectangle=box?{left:Math.floor(box.x0*canvas.width),top:Math.floor(box.y0*canvas.height),width:Math.floor((box.x1-box.x0)*canvas.width),height:Math.floor((box.y1-box.y0)*canvas.height)}:null;
          const data=await rpc('recognize',{image:encoded,options:rectangle?{rectangle}:{},output:{text:true,blocks:!box,hocr:false,tsv:false}});
          if(box) regions.push({text:data.text,confidence:data.confidence,bbox:box});
          else for(const p of data.paragraphs||[]) regions.push({text:p.text,confidence:p.confidence,bbox:{x0:p.bbox.x0/canvas.width,y0:p.bbox.y0/canvas.height,x1:p.bbox.x1/canvas.width,y1:p.bbox.y1/canvas.height}});
        }
        canvas.width=canvas.height=1;
        return {ok:true,regions,width:bitmap.width,height:bitmap.height,metrics:{language:trained.metrics,ocrMs:performance.now()-start,heapBytes:performance.memory?.usedJSHeapSize??null}};
      })();
      return await Promise.race([task,new Promise((_,reject)=> {timer=setTimeout(()=>reject(new Error(l10n('m40'))),20000);})]);
    } finally {
      cancelled=true;
      clearTimeout(timer);worker?.terminate();bitmap?.close();URL.revokeObjectURL(workerURL);
      for(const item of pending.values()) item.reject(new Error(l10n('m3y')));pending.clear();
    }
  }
  return {
    recognize(blob,options) { const task=work.then(()=>recognize(blob,options));work=task.catch(()=>{});return task; },
    async languages(lang) {
      if(lang) { if(!LANGUAGES[lang]) return {ok:false};await work;await storage.remove(lang); }
      const all=await storage.get(null);
      return {ok:true,languages:Object.entries(all).filter(([key])=>LANGUAGES[key]).map(([key,record])=>({lang:key,bytes:record.bytes}))};
    },
  };
}

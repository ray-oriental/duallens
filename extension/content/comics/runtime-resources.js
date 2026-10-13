// Small descriptors only. Executable sources are never imported into the ordinary page bundle.
export const OCR_RESOURCES = Object.freeze([
  { name:'duallensOcrCore', file:'tesseract-core-simd-lstm.wasm.js', bytes:3938657,
    url:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js',
    sha256:'ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf' },
  { name:'duallensOcrWorker', file:'worker.min.js', bytes:123724,
    url:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    sha256:'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc' },
]);
export async function verifyRuntime(text,spec) {
  if(typeof text!=='string') throw new Error('OCR 运行时资源不可用');
  const bytes=new TextEncoder().encode(text);
  if(bytes.byteLength!==spec.bytes) throw new Error('OCR 运行时大小校验失败');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hex!==spec.sha256) throw new Error('OCR 运行时 SHA-256 校验失败');
  return text;
}
export function createRuntimeLoader({storage,xmlhttpRequest,getResourceText}) {
  let pending;
  async function load(spec) {
    // Call the GM API only on the user-triggered OCR path, never on page startup.
    try {
      const resource=await getResourceText?.(spec.name);
      if(resource) return await verifyRuntime(resource,spec);
    } catch { /* Unsupported resource API or failed integrity: use the pinned verified fallback. */ }
    const key='runtime:'+spec.name;
    const cached=(await storage.get(key))[key];
    if(cached) {
      try {return await verifyRuntime(cached,spec);} catch {await storage.remove(key);}
    }
    const bytes=await new Promise((resolve,reject)=> {
      let handle;
      handle=xmlhttpRequest({url:spec.url,method:'GET',anonymous:true,responseType:'arraybuffer',timeout:60000,
        onprogress(r){if(r.loaded>spec.bytes){handle?.abort();reject(new Error('OCR 运行时大小校验失败'));}},
        onload(r){if(r.status!==200)reject(new Error('OCR 运行时下载失败'));else resolve(r.response);},
        onerror:()=>reject(new Error('OCR 运行时下载失败')),ontimeout:()=>reject(new Error('OCR 运行时下载超时')),
        onabort:()=>reject(new Error('OCR 运行时下载已取消')),
      });
    });
    const text=await verifyRuntime(new TextDecoder().decode(bytes),spec);
    await storage.set({[key]:text});return text;
  }
  return () => {
    if(!pending) pending=Promise.all(OCR_RESOURCES.map(load)).catch(error=>{pending=null;throw error;});
    return pending;
  };
}

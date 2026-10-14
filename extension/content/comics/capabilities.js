export async function probeLocalOCR(env = globalThis) {
  if (!env.WebAssembly?.compile || !env.Worker) return { ok: false, reason: '此页无法本地识别' };
  try {
    await env.WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
    return { ok: true };
  } catch { return { ok: false, reason: '此页无法本地识别（WASM 被页面策略阻止）' }; }
}

export function createGMImageFetch(xmlhttpRequest) {
  return (url, referer = '') => new Promise((resolve,reject) => {
    let u;
    try { u = new URL(url); } catch { reject(new Error('图片地址无效')); return; }
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) { reject(new Error('图片地址无效')); return; }
    let handle;
    handle=xmlhttpRequest({ url: u.href, method: 'GET', anonymous: true, responseType: 'blob', timeout: 20000,
      ...(referer ? {headers:{Referer:referer}} : {}),
      onprogress(r) { if(r.loaded>16*1024*1024) {handle?.abort();reject(new Error('图片超过 16 MB'));} },
      onload(r) {
        if (r.status !== 200) reject(new Error(`图片下载失败（HTTP ${r.status}）`));
        else if (!r.response || !/^image\/(png|jpeg|webp|gif|bmp)(;|$)/i.test(r.response.type) || r.response.size > 16*1024*1024) reject(new Error('不支持的图片或图片过大'));
        else resolve(r.response);
      }, onerror: () => reject(new Error('此页无法取图')), ontimeout: () => reject(new Error('图片下载超时')),
      onabort: () => reject(new Error('图片下载已取消')),
    });
  });
}

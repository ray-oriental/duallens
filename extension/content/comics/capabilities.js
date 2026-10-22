import { t as l10n } from '../../shared/i18n.js';
export async function probeLocalOCR(env = globalThis) {
  if (!env.WebAssembly?.compile || !env.Worker) return { ok: false, get reason(){return l10n('m2f');} };
  try {
    await env.WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
    return { ok: true };
  } catch { return { ok: false, get reason(){return l10n('m2g');} }; }
}

export function createGMImageFetch(xmlhttpRequest) {
  return (url, referer = '') => new Promise((resolve,reject) => {
    let u;
    try { u = new URL(url); } catch { reject(new Error(l10n('m3'))); return; }
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) { reject(new Error(l10n('m3'))); return; }
    let handle;
    handle=xmlhttpRequest({ url: u.href, method: 'GET', anonymous: true, responseType: 'blob', timeout: 20000,
      ...(referer ? {headers:{Referer:referer}} : {}),
      onprogress(r) { if(r.loaded>16*1024*1024) {handle?.abort();reject(new Error(l10n('m6')));} },
      onload(r) {
        if (r.status !== 200) reject(new Error(l10n('m2h', [r.status])));
        else if (!r.response || !/^image\/(png|jpeg|webp|gif|bmp)(;|$)/i.test(r.response.type) || r.response.size > 16*1024*1024) reject(new Error(l10n('m2i')));
        else resolve(r.response);
      }, onerror: () => reject(new Error(l10n('m2j'))), ontimeout: () => reject(new Error(l10n('m2k'))),
      onabort: () => reject(new Error(l10n('m2l'))),
    });
  });
}

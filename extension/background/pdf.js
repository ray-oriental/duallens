import { t as l10n } from '../shared/i18n.js';
// PDF entry points: explicit user actions, no upload or automatic redirection.
import { pdfURL } from '../shared/pdf-url.js';
import { readPDFURL } from '../pdf/source.js';
import { createPDFHandoff } from '../pdf/handoff.js';
import { uiLanguage } from '../shared/i18n.js';
export { pdfURL };
const TEXT = { get permission(){return l10n('m16');} };
export function hasPDFExtension(value) {
  try { return /\.pdf$/i.test(new URL(value).pathname); } catch { return false; }
}
export function isPDFType(value) { return /^application\/pdf\s*(?:;|$)/i.test(value || ''); }

export function registerPDFHandoffCleanup(api, handoff) {
  // Worker wakes are opportunistic cleanup, never a promise of an exact expiry timer.
  const cleanup = () => Promise.resolve().then(() => handoff.prune()).catch(() => {});
  api.runtime.onStartup?.addListener(cleanup);
  api.runtime.onInstalled?.addListener(cleanup);
  // Also prune on worker initialization after an ordinary event wakes the worker.
  if (api.runtime.onStartup || api.runtime.onInstalled) void cleanup();
}

// Probe only after an explicit popup/menu action. Read headers, never buffer a
// response body; even a server ignoring Range is canceled at the header boundary.
export async function probePDFType(url, fetchImpl = globalThis.fetch, timeoutMs = 5000) {
  for (const method of ['HEAD', 'GET']) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: ctrl.signal,
        ...(method === 'GET' ? { headers: { Range: 'bytes=0-1023' } } : {}),
      });
      const type = response.headers.get('content-type');
      if (response.ok && type) return isPDFType(type);
    } catch { /* A failed HEAD gets one bounded Range GET; failed GET declines. */ }
    finally {
      clearTimeout(timer);
      if (response?.body) void response.body.cancel().catch(() => {});
      ctrl.abort();
    }
  }
  return false;
}

export function createPDFEntries(api, fetchImpl = globalThis.fetch, handoff = createPDFHandoff()) {
  registerPDFHandoffCleanup(api, handoff);
  const menuId = 'dl-open-pdf';
  let creatingOCR;
  const ocrJobs = new Map();
  async function pdfOCR(msg, sender) {
    // Only the packaged reader can provide raster bytes; page content cannot use this bridge.
    if (sender?.id !== api.runtime.id || sender.url?.split('?')[0] !== api.runtime.getURL('pdf/viewer.html') ||
        !['eng','jpn','kor'].includes(msg.lang) || !/^[a-f0-9-]{36}$/.test(msg.jobId) ||
        typeof msg.base64 !== 'string' || msg.base64.length > 24 * 1024 * 1024 || ocrJobs.size >= 2)
      return { ok: false };
    const job = { owner: sender.documentId || sender.tab?.id, cancelled: false };
    if (ocrJobs.has(msg.jobId)) return { ok: false };
    ocrJobs.set(msg.jobId, job);
    try {
      creatingOCR ||= (async () => {
        const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (!contexts.length) {
          try { await api.offscreen.createDocument({ url:'offscreen/ocr.html', reasons:['WORKERS'], justification:'Recognize explicitly selected PDF pages locally without uploading pixels' }); }
          catch (error) { if (!(await api.runtime.getContexts({ contextTypes:['OFFSCREEN_DOCUMENT'] })).length) throw error; }
        }
        for (let n = 0; n < 60; n++) {
          try { if ((await api.runtime.sendMessage({ target:'comics-offscreen',type:'comic-offscreen-ready' }))?.ok) return; } catch { /* loading */ }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('OCR unavailable');
      })().finally(() => { creatingOCR = null; });
      await creatingOCR;
      if (job.cancelled) return { ok:false };
      return await api.runtime.sendMessage({ target:'comics-offscreen',type:'pdf-ocr-local',
        base64:msg.base64,mime:'image/png',lang:msg.lang,jobId:msg.jobId,allowDownload:msg.allowDownload === true,uiLanguage:uiLanguage() });
    } finally { ocrJobs.delete(msg.jobId); }
  }
  async function status(tab) {
    const url = pdfURL(tab?.url);
    if (!url) return { ok: true, available: false };
    if (hasPDFExtension(url)) return { ok: true, available: true, url };
    if (new URL(url).protocol === 'file:') return { ok: true, available: false };
    return { ok: true, available: await probePDFType(url, fetchImpl), url };
  }
  async function open(tab) {
    const r = await status(tab);
    if (!r.available) return { ok: false, error: { get message(){return l10n('m17');} } };
    let token;
    try {
      // Fetch while the explicitly operated tab still has activeTab access.
      const data = await readPDFURL(r.url, {fetchImpl,
        fileAccess:()=>api.extension?.isAllowedFileSchemeAccess?.() || Promise.resolve(false)});
      let name = '';
      try { name = decodeURIComponent(new URL(r.url).pathname.split('/').at(-1) || ''); } catch { /* malformed display name */ }
      token = await handoff.put(data, name);
      await api.tabs.create({ url: api.runtime.getURL('pdf/viewer.html?token=' + encodeURIComponent(token)) });
      return { ok: true };
    } catch {
      if(token)await handoff.remove(token);
      return {ok:false,error:{code:'pdf_source',message:TEXT.permission}};
    }
  }
  async function openFromMenu(tab) {
    const result = await open(tab);
    if (!result.ok) {
      // An extension-owned notice works on pages where content injection is
      // forbidden, and needs no notifications permission or document mutation.
      await api.tabs.create({ url: api.runtime.getURL('pdf/viewer.html?notice=not-pdf') });
    }
    return result;
  }
  return {
    menu: { id: menuId, get title(){return l10n('m18');}, contexts: ['page'] },
    open, openFromMenu,
    handlers: {
      'pdf-ocr': pdfOCR,
      'pdf-ocr-cancel': async (msg,sender) => {
        if (sender?.id !== api.runtime.id || sender.url?.split('?')[0] !== api.runtime.getURL('pdf/viewer.html')) return {ok:false};
        const job = ocrJobs.get(msg.jobId);
        if (!job || job.owner !== (sender.documentId || sender.tab?.id)) return {ok:false};
        job.cancelled = true;
        return api.runtime.sendMessage({target:'comics-offscreen',type:'pdf-ocr-cancel',jobId:msg.jobId}).catch(()=>({ok:true}));
      },
      'pdf-status': async (msg,sender) => trusted(sender) ? status(await api.tabs.get(msg.tabId)) : {ok:false},
      'pdf-open': async (msg,sender) => trusted(sender) ? open(await api.tabs.get(msg.tabId)) : {ok:false},
    },
  };
  function trusted(sender) { return !!sender?.url?.startsWith(api.runtime.getURL('')); }
}

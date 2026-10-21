// PDF entry points: explicit user actions, no upload or automatic redirection.
import { pdfURL } from '../shared/pdf-url.js';
import { readPDFURL } from '../pdf/source.js';
import { createPDFHandoff } from '../pdf/handoff.js';
export { pdfURL };
const TEXT = { permission: '无法读取此 PDF。请允许该来源，或下载后在阅读页选择本地文件。' };
export function hasPDFExtension(value) {
  try { return /\.pdf$/i.test(new URL(value).pathname); } catch { return false; }
}
export function isPDFType(value) { return /^application\/pdf\s*(?:;|$)/i.test(value || ''); }

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
  const menuId = 'dl-open-pdf';
  async function status(tab) {
    const url = pdfURL(tab?.url);
    if (!url) return { ok: true, available: false };
    if (hasPDFExtension(url)) return { ok: true, available: true, url };
    if (new URL(url).protocol === 'file:') return { ok: true, available: false };
    return { ok: true, available: await probePDFType(url, fetchImpl), url };
  }
  async function open(tab) {
    const r = await status(tab);
    if (!r.available) return { ok: false, error: { message: '当前页面未确认是 PDF，请先打开 PDF 文件。' } };
    let token;
    try {
      // Fetch while the explicitly operated tab still has activeTab access.
      const data = await readPDFURL(r.url, {fetchImpl,
        fileAccess:()=>api.extension?.isAllowedFileSchemeAccess?.() || Promise.resolve(false)});
      token = await handoff.put(data);
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
    menu: { id: menuId, title: '用 DualLens 打开此 PDF', contexts: ['page'] },
    open, openFromMenu,
    handlers: {
      'pdf-status': async (msg,sender) => trusted(sender) ? status(await api.tabs.get(msg.tabId)) : {ok:false},
      'pdf-open': async (msg,sender) => trusted(sender) ? open(await api.tabs.get(msg.tabId)) : {ok:false},
    },
  };
  function trusted(sender) { return !!sender?.url?.startsWith(api.runtime.getURL('')); }
}

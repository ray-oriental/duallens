import { t } from '../shared/i18n.js';
import { DLError, classify } from '../shared/errors.js';
import { ERR } from '../shared/protocol.js';

export const MAX_BYTES = 4 * 1024 * 1024;
const bytes = text => new TextEncoder().encode(text).byteLength;
const getHeader = (h, n) => h?.get?.(n) ?? h?.[n] ?? h?.[n==='content-type'?'Content-Type':'Content-Length'];
export const sizeError = () => new DLError(ERR.RESPONSE_SIZE, t('errResponseSize'), {category:'size'});
export const redirectError = status => new DLError(ERR.REDIRECT, t('errRedirect'), {category:'redirect', ...(status >= 300 && status < 400 ? {status} : {})});

export function checkResponse(res, url) {
  if (res.status >= 300 && res.status < 400 || res.redirected) throw redirectError(res.status);
  if (res.url && url && new URL(res.url).origin !== new URL(url).origin) throw redirectError();
  if (Number(getHeader(res.headers, 'content-length')) > MAX_BYTES) throw sizeError();
}

// Read all native response bodies as bytes, including JSON, error prose and catalogues.
// The text() branch serves already-bounded GM replies and injected test transports only.
export async function readResponseText(res, { url, onText, stop } = {}) {
  try { checkResponse(res, url); }
  catch (error) { await res.body?.cancel?.().catch(()=>{}); throw error; }
  if (!res.body?.getReader) {
    const text = await res.text();
    if (bytes(text) > MAX_BYTES) throw sizeError();
    return text;
  }
  const r = res.body.getReader(), dec = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const part = await r.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw sizeError();
      const delta = dec.decode(part.value, {stream:true});
      text += delta; onText?.(delta);
      if (stop?.()) { await r.cancel(); break; }
    }
    const tail = dec.decode(); text += tail; if (tail) onText?.(tail);
    return text;
  } catch (error) { await r.cancel().catch(()=>{}); throw error; }
  finally { r.releaseLock(); }
}

export function responseHeaders(raw = '') {
  const values = new Map();
  for (const line of String(raw).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    values.set(name, values.has(name) ? values.get(name) + ', ' + value : value);
  }
  return { get: (name) => values.get(String(name).toLowerCase()) ?? null };
}

// The providers expect a fetch-shaped response. No webpage fetch is used by userscripts.
export function asFetch(http) {
  return async (url, options = {}) => {
    const res = await http({ url, method: options.method || 'GET', headers: options.headers,
      // Provider owns its timeout via AbortSignal (including longer configured timeouts).
      body: options.body, signal: options.signal, timeoutMs: 0, onText: options.onText, redirect:'error' });
    return { status: res.status, headers: res.headers, text: async () => res.text };
  };
}

export function createGMHttp(request) {
  return ({ url, method = 'GET', headers = {}, body, timeoutMs = 60000, signal, onText }) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    let handle;
    let settled = false, offset = 0, abortLate = false;
    const fail = error => { finish(reject,error); abortLate=true; handle?.abort(); };
    const inspect = r => {
      if (settled) return false;
      try {
        if (r.finalUrl && new URL(r.finalUrl, url).origin !== new URL(url).origin) throw redirectError(r.status);
        checkResponse({status:r.status,headers:responseHeaders(r.responseHeaders)});
        if (Number(r.loaded) > MAX_BYTES || typeof r.responseText === 'string' && bytes(r.responseText) > MAX_BYTES) throw sizeError();
        return true;
      } catch (error) { fail(error); return false; }
    };
    const progress = r => {
      if (!inspect(r) || !onText || !r.status || !r.responseHeaders || typeof r.responseText !== 'string') return;
      const delta = r.responseText.slice(offset); offset = r.responseText.length;
      if (!delta) return;
      try { onText(delta, r.status, responseHeaders(r.responseHeaders)); }
      catch (error) { fail(error); }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      finish(reject, new DOMException('Aborted', 'AbortError'));
      handle?.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid URL');
      handle = request({ url: target.href, method, headers, data: body, timeout: timeoutMs, redirect:'error',
        anonymous: true, responseType: 'text',
        onprogress: progress, onreadystatechange: progress,
        onload: r => { progress(r); if (!settled) finish(resolve, { status: r.status, headers: responseHeaders(r.responseHeaders), text: r.responseText || '' }); },
        onerror: r => { if (inspect(r || {})) finish(reject, new Error('Network request failed')); },
        ontimeout: () => finish(reject, new Error('Network request timed out')),
        onabort: () => finish(reject, new DOMException('Aborted', 'AbortError')),
      });
      if (abortLate) handle?.abort();
      if (signal?.aborted) abort();
    } catch { finish(reject, new Error('Network request failed')); }
  });
}

// This adapter is for a service-worker caller, never for userscript requests.
export function createFetchHttp(fetchImpl) {
  return async ({ url, method = 'GET', headers, body, timeoutMs = 60000, signal, onText }) => {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = timeoutMs > 0 ? setTimeout(abort, timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal, credentials: 'omit', cache: 'no-store', redirect:'error' });
      const text = await readResponseText(res, {url, onText: onText && /text\/event-stream/i.test(getHeader(res.headers,'content-type') || '') ? delta=>onText(delta,res.status,res.headers) : undefined});
      return { status: res.status, headers: res.headers, text };
    } catch (error) {
      if (classify(error).category === 'redirect') throw redirectError();
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}

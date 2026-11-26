import { MAX_PDF_BYTES, checkPDFBytes } from '../pdf/source.js';
import { pdfURL } from '../shared/pdf-url.js';
import { t } from '../shared/i18n.js';

export const PDF_CHUNK_BYTES = 8 * 1024 * 1024;

// These functions are serialized by scripting; keep their dependencies in args.
export function identifyPDFTab() {
  return { href: location.href, contentType: document.contentType };
}
export async function stagePDFTab(jobId, href, limit) {
  if (location.href !== href || document.contentType !== 'application/pdf') return { error: 'changed' };
  // Abort after 30 s without data or 5 min in total, so slow but steady large files still arrive.
  const ctrl = new AbortController(), total = setTimeout(() => ctrl.abort(), 300000);
  let idle = setTimeout(() => ctrl.abort(), 30000);
  const alive = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), 30000); };
  let reader;
  try {
    const response = await fetch(location.href, { credentials: 'include', cache: 'force-cache',
      redirect: 'follow', signal: ctrl.signal });
    if (!response.ok) return { error: 'response' };
    if (Number(response.headers.get('content-length')) > limit) return { error: 'too-large' };
    reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        alive();
        size += value.byteLength;
        if (size > limit) return { error: 'too-large' };
        chunks.push(value);
      }
    } else {
      const value = new Uint8Array(await response.arrayBuffer());
      size = value.byteLength;
      if (size > limit) return { error: 'too-large' };
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) return { error: 'not-pdf' };
    const cleanup = setTimeout(() => { delete globalThis[jobId]; }, 60000);
    globalThis[jobId] = { bytes, cleanup };
    return { size };
  } catch { return { error: 'read' }; }
  finally { clearTimeout(total); clearTimeout(idle); ctrl.abort(); await reader?.cancel().catch(() => {}); }
}
export function takePDFTabChunk(jobId, offset, length) {
  const job = globalThis[jobId];
  if (!job || !Number.isInteger(offset) || offset < 0 || length <= 0) throw new Error('PDF transfer expired');
  const bytes = job.bytes.subarray(offset, offset + length);
  let base64;
  if (typeof bytes.toBase64 === 'function') base64 = bytes.toBase64();
  else {
    const parts = [];
    for (let n = 0; n < bytes.length; n += 32768) parts.push(String.fromCharCode(...bytes.subarray(n, n + 32768)));
    base64 = btoa(parts.join(''));
  }
  if (offset + length >= job.bytes.length) { clearTimeout(job.cleanup); delete globalThis[jobId]; }
  return base64;
}
export function clearPDFTab(jobId) {
  const job = globalThis[jobId];
  if (job) { clearTimeout(job.cleanup); delete globalThis[jobId]; }
}
export async function inspectPDFTab(api, tabId) {
  try {
    const [frame] = await api.scripting.executeScript({ target: { tabId, frameIds: [0] },
      world: 'ISOLATED', func: identifyPDFTab });
    if (!frame?.result || !pdfURL(frame.result.href)) return null;
    return { ...frame.result, documentId: frame.documentId };
  } catch { return null; }
}
export async function readPDFTab(api, tabId, identity) {
  if (!identity || identity.contentType !== 'application/pdf') throw new Error('PDF tab unavailable');
  const jobId = '__duallens_pdf_' + crypto.randomUUID();
  const target = identity.documentId ? { tabId, documentIds: [identity.documentId] } : { tabId, frameIds: [0] };
  const call = async (func, args) => {
    const [frame] = await api.scripting.executeScript({ target, world: 'ISOLATED', func, args });
    if (!frame || !Object.hasOwn(frame, 'result')) throw new Error('PDF tab unavailable');
    return frame.result;
  };
  try {
    const staged = await call(stagePDFTab, [jobId, identity.href, MAX_PDF_BYTES]);
    if (staged?.error === 'too-large' || staged?.size > MAX_PDF_BYTES) {
      throw Object.assign(new Error(t('m6k')), { code: 'pdf_too_large' });
    }
    if (!Number.isInteger(staged?.size) || staged.size <= 0) throw new Error('PDF tab read failed');
    const bytes = new Uint8Array(staged.size);
    for (let offset = 0; offset < bytes.length; offset += PDF_CHUNK_BYTES) {
      const length = Math.min(PDF_CHUNK_BYTES, bytes.length - offset);
      const encoded = await call(takePDFTabChunk, [jobId, offset, length]);
      if (typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil(length / 3)) throw new Error('PDF chunk incomplete');
      const binary = atob(encoded);
      if (binary.length !== length) throw new Error('PDF chunk incomplete');
      for (let n = 0; n < length; n++) bytes[offset + n] = binary.charCodeAt(n);
    }
    return checkPDFBytes(bytes);
  } finally { await call(clearPDFTab, [jobId]).catch(() => {}); }
}

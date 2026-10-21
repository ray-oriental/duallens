import { t as l10n } from '../shared/i18n.js';
import { pdfURL } from '../shared/pdf-url.js';

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export function checkPDFBytes(data) {
  if (!data.byteLength || data.byteLength > MAX_PDF_BYTES) throw new Error(l10n('m6k'));
  const header = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  if (!header.includes('%PDF-')) throw new Error(l10n('m6l'));
  return data;
}
export async function readPDFURL(value, { fetchImpl = fetch, fileAccess = async () => false } = {}) {
  const url = pdfURL(value);
  if (!url) throw new Error(l10n('m6m'));
  if (new URL(url).protocol === 'file:' && !await fileAccess()) {
    throw new Error(l10n('m6n'));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let reader;
  try {
    const r = await fetchImpl(url, { credentials: 'omit', redirect: 'error', signal: ctrl.signal });
    if (!r.ok) throw new Error(l10n('m6o'));
    if (Number(r.headers.get('content-length')) > MAX_PDF_BYTES) throw new Error(l10n('m6k'));
    if (!r.body) return checkPDFBytes(new Uint8Array(await r.arrayBuffer()));
    reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_PDF_BYTES) throw new Error(l10n('m6k'));
      chunks.push(chunk);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return checkPDFBytes(data);
  } finally { clearTimeout(timer); ctrl.abort(); await reader?.cancel().catch(() => {}); }
}

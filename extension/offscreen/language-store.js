import { t as l10n } from '../shared/i18n.js';
export const LANGUAGE_DB = 'duallens-ocr-languages';
export function openLanguages(idb = globalThis.indexedDB) {
  return new Promise((resolve,reject) => {
    const req = idb.open(LANGUAGE_DB,1);
    req.onupgradeneeded = () => req.result.createObjectStore('languages', { keyPath: 'lang' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(l10n('m69')));
  });
}
export async function languageRecord(lang, action = 'get', value) {
  const db = await openLanguages();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('languages', action === 'get' || action === 'getAll' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('languages');
      const req = action === 'getAll' ? store.getAll() : action === 'put' ? store.put(value) : store[action](lang);
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error(l10n('m6a')));
    });
  } finally { db.close(); }
}
export async function verifyLanguage(data, spec) {
  if (data.byteLength !== spec.bytes) throw new Error(l10n('m3s'));
  const hash = await crypto.subtle.digest('SHA-256',data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,'0')).join('');
  if (hex !== spec.sha256) throw new Error(l10n('m6b'));
}
export async function ensureLanguage(lang, manifest, fetchImpl = fetch) {
  const spec = manifest[lang];
  if (!spec) throw new Error(l10n('m3r'));
  const start = performance.now();
  const cached = await languageRecord(lang);
  if (cached) {
    try { await verifyLanguage(cached.data,spec); return { downloaded: false, ms: performance.now()-start, bytes: spec.bytes }; }
    catch { await languageRecord(lang,'delete'); }
  }
  const res = await fetchImpl(spec.url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(l10n('m6c', [res.status]));
  const reader = res.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done,value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > spec.bytes) { await reader.cancel(); throw new Error(l10n('m3s')); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  await verifyLanguage(bytes.buffer,spec);
  await languageRecord(lang,'put',{ lang, data: bytes.buffer, bytes: size, sha256: spec.sha256 });
  return { downloaded: true, ms: performance.now()-start, bytes: size };
}

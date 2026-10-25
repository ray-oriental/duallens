import { t as l10n } from '../shared/i18n.js';
// Extension-origin IndexedDB only. Bytes never cross JSON messaging or enter sync storage.
import { checkPDFBytes } from './source.js';
const TTL = 5 * 60 * 1000;
const valid = token => typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token);

export function createPDFHandoff({ database = globalThis.indexedDB, now = Date.now,
  randomUUID = () => crypto.randomUUID() } = {}) {
  let pending;
  function db() {
    return pending ||= new Promise((resolve, reject) => {
      const request = database.open('duallens-pdf-handoff', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { pending = null; reject(request.error); };
    });
  }
  async function transact(run) {
    const opened = await db();
    return new Promise((resolve, reject) => {
      const tx = opened.transaction('files', 'readwrite'), store = tx.objectStore('files');
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error(l10n('pdfCacheUnavailable')));
      run(store, value => { result = value; });
    });
  }
  function sweep(store, done) {
    const request = store.openCursor(), entries = [], cutoff = now();
    let removed = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done({ entries, removed }); return; }
      const expires = cursor.value?.expires;
      if (!Number.isFinite(expires) || expires <= cutoff) { cursor.delete(); removed++; }
      else entries.push({ key:cursor.key, expires });
      cursor.continue();
    };
  }
  return {
    async prune() { return transact((store, done) => sweep(store, ({ removed }) => done(removed))); },
    async put(bytes, name = '') {
      checkPDFBytes(bytes);
      const token = randomUUID();
      await transact((store, done) => {
        sweep(store, ({ entries }) => {
          // Purge expired bytes before inserting, keeping at most three live handoffs.
          entries.sort((a,b)=>a.expires-b.expires);
          for (const entry of entries.slice(0, Math.max(0, entries.length - 2))) store.delete(entry.key);
          store.put({bytes, name:String(name).slice(0,200), expires:now()+TTL}, token); done(token);
        });
      });
      return token;
    },
    async take(token) { return (await this.takeFile(token)).bytes; },
    async takeFile(token) {
      if (!valid(token)) throw new Error(l10n('pdfTokenInvalid'));
      const value = await transact((store, done) => {
        sweep(store, () => {
          const request = store.get(token);
          request.onsuccess = () => { store.delete(token); done(request.result); };
        });
      });
      if (!value || value.expires <= now()) throw new Error(l10n('pdfTokenExpired'));
      return { bytes:checkPDFBytes(new Uint8Array(value.bytes)), name:value.name || '' };
    },
    async remove(token) { if(valid(token))await transact(store=>store.delete(token)); },
  };
}

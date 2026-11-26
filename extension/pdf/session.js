import { checkPDFBytes } from './source.js';
import { t } from '../shared/i18n.js';

const TTL = 24 * 60 * 60 * 1000;
const valid = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export function createPDFSessions({ database = globalThis.indexedDB, now = Date.now,
  randomUUID = () => crypto.randomUUID() } = {}) {
  let pending;
  function db() {
    return pending ||= new Promise((resolve, reject) => {
      const request = database.open('duallens-pdf-sessions', 1);
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
      tx.onerror = tx.onabort = () => reject(tx.error || new Error(t('pdfCacheUnavailable')));
      run(store, value => { result = value; });
    });
  }
  function sweep(store, done, tabId) {
    const request = store.openCursor(), entries = [], cutoff = now();
    let removed = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done({ entries, removed }); return; }
      const value = cursor.value;
      if (!Number.isFinite(value?.expires) || value.expires <= cutoff ||
          (Number.isInteger(tabId) && value.tabId === tabId)) { cursor.delete(); removed++; }
      else entries.push({ key: cursor.key, updated: value.updated });
      cursor.continue();
    };
  }
  return {
    async prune() { return transact((store, done) => sweep(store, ({ removed }) => done(removed))); },
    async removeTab(tabId) {
      if (Number.isInteger(tabId)) return transact((store, done) => sweep(store, ({ removed }) => done(removed), tabId));
    },
    async put(bytes, name = '', { id, tabId } = {}) {
      checkPDFBytes(bytes);
      id = valid(id) ? id : randomUUID();
      await transact((store, done) => sweep(store, ({ entries }) => {
        const others = entries.filter(entry => entry.key !== id).sort((a,b) => a.updated - b.updated);
        for (const entry of others.slice(0, Math.max(0, others.length - 2))) store.delete(entry.key);
        store.put({ bytes, name: String(name).slice(0,200), tabId: Number.isInteger(tabId) ? tabId : null,
          updated: now(), expires: now() + TTL }, id);
        done(id);
      }));
      return id;
    },
    async get(id) {
      if (!valid(id)) return null;
      return transact((store, done) => sweep(store, () => {
        const request = store.get(id);
        request.onsuccess = () => {
          const value = request.result;
          done(value && value.expires > now() ? { bytes: new Uint8Array(value.bytes), name: value.name, tabId: value.tabId } : null);
        };
      }));
    },
  };
}

import { t as l10n } from '../shared/i18n.js';
// Translation cache, SPEC §8. IndexedDB database `duallens`, store `tr`, rows { k, t, ts }.
//
// Cache interface (the translator only depends on this shape):
//   getMany(keys, { ttlMs })            -> Promise<Map<key, text>>   expired rows count as misses
//   putMany(entries, { maxEntries, ttlMs }) -> Promise<void>          entries: [{ k, t }]; prunes afterwards
//   count()                             -> Promise<number>
//   clear()                             -> Promise<void>
// Pruning drops expired rows first, then the oldest `ts` rows once the store exceeds maxEntries
// (down to 90% of it, so it does not run on every insert). ttlMs <= 0 / undefined means no expiry.

import { sha256Hex } from '../shared/hash.js';
import { PROMPT_VERSION } from '../shared/prompt.js';

export const DB_NAME = 'duallens';
export const STORE = 'tr';
const KEEP_RATIO = 0.9;
const SEP = '\u001f';

export async function glossaryHash(glossary, sha = sha256Hex) {
  const pairs = (Array.isArray(glossary) ? glossary : [])
    .filter((g) => g && g.src && g.dst)
    .map((g) => [String(g.src), String(g.dst)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return pairs.length ? (await sha(JSON.stringify(pairs))).slice(0, 16) : '';
}

// Returns keyOf(text) -> Promise<hex>. Everything but the text is hashed once up front.
// The user's custom prompt is folded into the preset component so editing it invalidates old rows.
export async function makeKeyer({ profileId, model, to, from = 'auto', context = {}, preset, custom, glossary }, sha = sha256Hex) {
  const gh = await glossaryHash(glossary, sha);
  const presetTag = preset === 'custom' ? 'custom:' + (await sha(String(custom ?? ''))).slice(0, 16) : String(preset);
  const titleHash = (await sha(String(context.title || '').replace(/\s+/g,' ').trim().slice(0,200))).slice(0,16);
  const prefix = [PROMPT_VERSION, profileId, model, from, to, presetTag, gh, titleHash].join(SEP) + SEP;
  return (text) => sha(prefix + text);
}

function cutoffOf(now, ttlMs) {
  return ttlMs > 0 ? now() - ttlMs : 0;
}

export function createMemoryCache({ now = () => Date.now() } = {}) {
  const rows = new Map();
  return {
    async getMany(keys, { ttlMs } = {}) {
      const cutoff = cutoffOf(now, ttlMs);
      const out = new Map();
      for (const k of keys) {
        const row = rows.get(k);
        if (row && row.ts >= cutoff) out.set(k, row.t);
      }
      return out;
    },
    async putMany(entries, { maxEntries, ttlMs } = {}) {
      const ts = now();
      for (const { k, t } of entries) rows.set(k, { t, ts });
      const cutoff = cutoffOf(now, ttlMs);
      if (cutoff) for (const [k, row] of rows) if (row.ts < cutoff) rows.delete(k);
      if (maxEntries > 0 && rows.size > maxEntries) {
        const keep = Math.floor(maxEntries * KEEP_RATIO);
        const oldestFirst = [...rows.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < oldestFirst.length - keep; i++) rows.delete(oldestFirst[i][0]);
      }
    },
    async count() {
      return rows.size;
    },
    async clear() {
      rows.clear();
    },
  };
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error(l10n('cacheOperationFailed')));
  });
}

export function createIdbCache({ indexedDB = globalThis.indexedDB, dbName = DB_NAME, now = () => Date.now() } = {}) {
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'k' }).createIndex('ts', 'ts');
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          db.onclose = () => {
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          dbPromise = null;
          reject(req.error);
        };
      });
    }
    return dbPromise;
  }

  function prune(db, { maxEntries, cutoff }) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const byTs = store.index('ts');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(l10n('cacheOperationFailed')));

      const evictOldest = () => {
        const counting = store.count();
        counting.onsuccess = () => {
          const total = counting.result;
          if (!(maxEntries > 0) || total <= maxEntries) return;
          let excess = total - Math.floor(maxEntries * KEEP_RATIO);
          const cursor = byTs.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c && excess > 0) {
              c.delete();
              excess--;
              c.continue();
            }
          };
        };
      };

      if (cutoff) {
        const cursor = byTs.openCursor(IDBKeyRange.upperBound(cutoff, true));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) {
            c.delete();
            c.continue();
          } else evictOldest();
        };
      } else evictOldest();
    });
  }

  return {
    async getMany(keys, { ttlMs } = {}) {
      const out = new Map();
      if (!keys.length) return out;
      const cutoff = cutoffOf(now, ttlMs);
      const db = await open();
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      for (const k of keys) {
        const req = store.get(k);
        req.onsuccess = () => {
          const row = req.result;
          if (row && typeof row.t === 'string' && row.ts >= cutoff) out.set(k, row.t);
        };
      }
      await txDone(tx);
      return out;
    },
    async putMany(entries, { maxEntries, ttlMs } = {}) {
      if (!entries.length) return;
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const ts = now();
      for (const { k, t } of entries) store.put({ k, t, ts });
      await txDone(tx);
      await prune(db, { maxEntries, cutoff: cutoffOf(now, ttlMs) });
    },
    async count() {
      const db = await open();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      await txDone(tx);
      return req.result;
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await txDone(tx);
    },
  };
}

export function createCache(options = {}) {
  const idb = options.indexedDB || globalThis.indexedDB;
  return idb ? createIdbCache({ ...options, indexedDB: idb }) : createMemoryCache(options);
}

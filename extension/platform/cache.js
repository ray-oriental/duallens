// In-memory LRU with bounded GM persistence; no host-page database or web storage.
export function createStoredCache(localArea, { maxBytes = 2 * 1024 * 1024, now = () => Date.now() } = {}) {
  const KEY = 'translation-cache';
  const rows = new Map();
  const bytesOf = (r) => new TextEncoder().encode(JSON.stringify(r)).length + 1;
  let bytes = 2;
  let writes = Promise.resolve();
  function drop(k) { const r = rows.get(k); if (r) { bytes -= r.bytes; rows.delete(k); } }
  function insert(r) {
    drop(r.k);
    const size = bytesOf(r);
    if (size + 2 > maxBytes) return;
    rows.set(r.k, { ...r, bytes: size }); bytes += size;
  }
  const ready = localArea.get(KEY).then((got) => {
    for (const row of Array.isArray(got[KEY]) ? got[KEY] : []) {
      if (typeof row.k === 'string' && typeof row.t === 'string' && Number.isFinite(row.ts)) insert({ k: row.k, t: row.t, ts: row.ts });
    }
    prune({});
  }).catch(() => {});
  function prune({ maxEntries, ttlMs }) {
    const cutoff = ttlMs > 0 ? now() - ttlMs : 0;
    for (const [k, r] of rows) if (r.ts < cutoff) drop(k);
    // Timestamp eviction for the persisted budget. Map order supplies LRU ties.
    const oldest = [...rows.values()].sort((a, b) => a.ts - b.ts);
    for (const r of oldest) {
      if (bytes <= maxBytes && (!(maxEntries > 0) || rows.size <= maxEntries)) break;
      drop(r.k);
    }
  }
  function persist() {
    const run = () => localArea.set({ [KEY]: [...rows.values()].map(({ k, t, ts }) => ({ k, t, ts })) });
    writes = writes.then(run, run).catch(() => {});
    return writes;
  }
  return {
    async getMany(keys, { ttlMs } = {}) {
      await ready;
      const out = new Map();
      const cutoff = ttlMs > 0 ? now() - ttlMs : 0;
      for (const k of keys) {
        const r = rows.get(k);
        if (!r || r.ts < cutoff) continue;
        rows.delete(k); rows.set(k, r); out.set(k, r.t);
      }
      return out;
    },
    async putMany(entries, opts = {}) {
      await ready;
      for (const { k, t } of entries) insert({ k, t, ts: now() });
      prune(opts); await persist();
    },
    async count() { await ready; return rows.size; },
    async clear() { await ready; rows.clear(); bytes = 2; await persist(); },
  };
}

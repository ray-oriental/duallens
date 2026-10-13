// GM areas are separate namespaced records, not localStorage/IndexedDB on the host site.
export function createGMStorageArea(gm, namespace) {
  const listeners = new Set();
  const copy = (v) => v === undefined ? undefined : structuredClone(v);
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const record = async () => (await gm.getValue(namespace, {})) || {};
  let writes = Promise.resolve();
  let listening = false;
  function emit(oldValue = {}, newValue = {}) {
    const changes = {};
    for (const key of new Set([...Object.keys(oldValue || {}), ...Object.keys(newValue || {})])) {
      if (JSON.stringify(oldValue?.[key]) === JSON.stringify(newValue?.[key])) continue;
      Object.defineProperty(changes, key, { value: { oldValue: copy(oldValue?.[key]), newValue: copy(newValue?.[key]) }, enumerable: true });
    }
    if (Object.keys(changes).length) for (const cb of listeners) cb(changes);
  }
  function update(fn) {
    const run = async () => {
      const old = await record();
      const next = fn(copy(old));
      if (Object.keys(next).length) await gm.setValue(namespace, next);
      else await gm.deleteValue(namespace);
      // GM listener covers both this tab and other tabs; fallback is only for missing API.
      if (!listening) emit(old, next);
    };
    const result = writes.then(run, run);
    writes = result.catch(() => {});
    return result;
  }
  return {
    async get(keys = null) {
      const all = await record();
      if (keys === null) return copy(all);
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const key of names) if (own(all, key) || (!Array.isArray(keys) && typeof keys === 'object')) {
        Object.defineProperty(out, key, { value: copy(own(all, key) ? all[key] : keys[key]), enumerable: true });
      }
      return out;
    },
    set(items) { return update((all) => ({ ...all, ...copy(items) })); },
    remove(keys) { return update((all) => { for (const k of typeof keys === 'string' ? [keys] : keys) delete all[k]; return all; }); },
    onChanged(cb) {
      listeners.add(cb);
      if (!listening && gm.addValueChangeListener) {
        gm.addValueChangeListener(namespace, (_name, old, next) => emit(old, next));
        listening = true;
      }
      return () => listeners.delete(cb);
    },
  };
}

export function createChromeStorageArea(storage, name) {
  const area = storage[name];
  return {
    get: (keys) => area.get(keys), set: (items) => area.set(items), remove: (keys) => area.remove(keys),
    onChanged(cb) {
      const listener = (changes, changedArea) => { if (changedArea === name) cb(changes); };
      storage.onChanged.addListener(listener);
      return () => storage.onChanged.removeListener(listener);
    },
  };
}

// Prefix fallback keys so a sync failure cannot overwrite v1 settings or local secrets.
export function withLocalFallback(sync, local) {
  const marker = 'dl-sync-fallback';
  const prefix = 'dl-sync:';
  const key = (k) => prefix + k;
  const fallback = {
    async get(keys) {
      const got = await local.get(null);
      const all = Object.fromEntries(Object.entries(got).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
      if (keys == null) return all;
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(names.filter((k) => k in all || (!Array.isArray(keys) && typeof keys === 'object')).map((k) => [k, k in all ? all[k] : keys[k]]));
    },
    set: (items) => local.set(Object.fromEntries(Object.entries(items).map(([k, v]) => [key(k), v]))),
    remove: (keys) => local.remove((typeof keys === 'string' ? [keys] : keys).map(key)),
  };
  const inFallback = async () => !!(await local.get(marker))[marker];
  return {
    async get(keys) {
      if (await inFallback()) return fallback.get(keys);
      try { return await sync.get(keys); } catch { return fallback.get(keys); }
    },
    async set(items) {
      if (await inFallback()) return fallback.set(items);
      try { await sync.set(items); } catch {
        let old = {};
        try { old = await sync.get(null); } catch { /* sync unavailable */ }
        await fallback.set({ ...old, ...items });
        await local.set({ [marker]: true });
      }
    },
    async remove(keys) { return (await inFallback() ? fallback : sync).remove(keys); },
    onChanged(cb) {
      const a = sync.onChanged((changes) => { inFallback().then((v) => { if (!v) cb(changes); }); });
      const b = local.onChanged((changes) => {
        const out = Object.fromEntries(Object.entries(changes).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
        if (Object.keys(out).length) cb(out);
      });
      return () => { a(); b(); };
    },
  };
}

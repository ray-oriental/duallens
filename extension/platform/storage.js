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

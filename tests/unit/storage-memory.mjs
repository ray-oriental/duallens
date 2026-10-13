export function memoryArea(seed = {}, { failSet = false, failGet = false } = {}) {
  const data = structuredClone(seed), writes = [], listeners = new Set();
  return {
    data, writes,
    async get(keys) {
      if (failGet) throw new Error('Storage unavailable');
      return Object.fromEntries((keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys])
        .filter(k => Object.hasOwn(data, k)).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) {
      if (failSet) throw new Error('Quota exceeded');
      writes.push(structuredClone(items));
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) };
        data[key] = structuredClone(value);
      }
      listeners.forEach(cb => cb(changes));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    onChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

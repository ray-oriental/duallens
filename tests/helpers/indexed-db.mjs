// Minimal async IndexedDB adapter for the handoff's cursor/get/put/delete contract.
// Transactions are serialized; the browser suite additionally exercises real IndexedDB.
export function memoryDatabase() {
  const records = new Map();
  let tail = Promise.resolve();
  const db = {
    transaction() {
      const tx = {}, queue = [];
      let active = false, scheduled = false, release;
      const previous = tail;
      tail = new Promise(resolve => { release = resolve; });
      const pump = () => {
        if (!active || scheduled) return;
        scheduled = true;
        setImmediate(() => {
          scheduled = false;
          if (queue.length) { queue.shift()(); pump(); }
          else { active = false; tx.oncomplete?.(); release(); }
        });
      };
      const request = action => {
        const req = {};
        queue.push(() => { req.result = action(); req.onsuccess?.(); }); pump();
        return req;
      };
      const store = {
        get: key => request(() => structuredClone(records.get(key))),
        put: (value, key) => request(() => records.set(key, structuredClone(value))),
        delete: key => request(() => records.delete(key)),
        openCursor() {
          const keys = [...records.keys()]; let index = 0;
          const req = {};
          const next = () => {
            queue.push(() => {
              const key = keys[index++];
              req.result = key === undefined ? null : { key, value:structuredClone(records.get(key)),
                delete:() => store.delete(key), continue:next };
              req.onsuccess?.();
            }); pump();
          };
          next(); return req;
        },
      };
      tx.objectStore = () => store;
      previous.then(() => { active = true; pump(); });
      return tx;
    },
  };
  return { records, database:{ open() { const req = {}; queueMicrotask(() => { req.result=db;req.onsuccess(); });return req; } } };
}


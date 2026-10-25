import test from 'node:test';
import assert from 'node:assert/strict';
import { createPDFHandoff } from '../../extension/pdf/handoff.js';
import { createPDFEntries, registerPDFHandoffCleanup } from '../../extension/background/pdf.js';

// Minimal async IndexedDB adapter for the handoff's cursor/get/put/delete contract.
// Transactions are serialized; the browser suite additionally exercises real IndexedDB.
function memoryDatabase() {
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

const bytes = new TextEncoder().encode('%PDF-1.4\noriginal local fixture');
const TTL = 300000;
function fixture() {
  const memory = memoryDatabase(); let clock = 1000, sequence = 0;
  const handoff = createPDFHandoff({ database:memory.database, now:() => clock,
    randomUUID:() => `00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}` });
  return { ...memory, handoff, advance:ms => { clock += ms; } };
}

test('PDF handoff startup and install cleanup remove expired bytes and retain live entries', async () => {
  const f = fixture(), expired = await f.handoff.put(bytes);
  f.advance(TTL - 1);
  const live = await f.handoff.put(bytes);
  f.advance(1);
  const listeners = {};
  const api = { runtime:{ onStartup:{addListener:fn => { listeners.startup=fn; }},
    onInstalled:{addListener:fn => { listeners.installed=fn; }} } };
  createPDFEntries(api, undefined, f.handoff);
  await listeners.startup();
  assert.equal(f.records.has(expired), false);
  assert.equal(f.records.has(live), true);
  f.advance(TTL);
  await listeners.installed();
  assert.equal(f.records.size, 0);
});

test('PDF handoff initialization prunes without waiting for a browser startup event', async () => {
  const f=fixture();await f.handoff.put(bytes);f.advance(TTL);
  let finish;
  const cleaned=new Promise(resolve => { finish=resolve; });
  registerPDFHandoffCleanup({runtime:{onStartup:{addListener(){}}}},
    {prune:async()=>{await f.handoff.prune();finish();}});
  await cleaned;assert.equal(f.records.size,0);
});

test('PDF handoff put removes all expired entries before insertion and preserves live bytes', async () => {
  const f=fixture(),expired=await f.handoff.put(bytes);
  f.advance(TTL - 1);const live=await f.handoff.put(bytes,'live.pdf');
  f.advance(1);const fresh=await f.handoff.put(bytes);
  assert.equal(f.records.has(expired),false);
  assert.deepEqual([...f.records.keys()],[live,fresh]);
  assert.deepEqual(f.records.get(live).bytes,bytes);
});

test('PDF handoff successful take deletes its bytes before resolving and sweeps unrelated expiry', async () => {
  const f=fixture(),expired=await f.handoff.put(bytes);
  f.advance(TTL - 1);const live=await f.handoff.put(bytes,'source.pdf');
  const keep=await f.handoff.put(bytes);
  f.advance(1);
  const file=await f.handoff.takeFile(live);
  assert.deepEqual(file,{bytes,name:'source.pdf'});
  assert.equal(f.records.has(live),false);
  assert.equal(f.records.has(expired),false);
  assert.equal(f.records.has(keep),true);
  await assert.rejects(f.handoff.take(live));
});

test('PDF handoff expired tokens cannot return bytes and concurrent reads are single-use', async () => {
  const f=fixture(),expired=await f.handoff.put(bytes);
  f.advance(TTL);await assert.rejects(f.handoff.take(expired));
  assert.equal(f.records.size,0);
  const token=await f.handoff.put(bytes);
  const reads=await Promise.allSettled([f.handoff.take(token),f.handoff.take(token)]);
  assert.equal(reads.filter(read=>read.status==='fulfilled').length,1);
  assert.equal(f.records.has(token),false);
});

test('PDF handoff lifecycle cleanup failure is contained and later events can retry', async () => {
  const listeners={};let calls=0;
  registerPDFHandoffCleanup({runtime:{onStartup:{addListener:fn=>{listeners.start=fn;}}}},
    {prune:()=>{calls++;throw new Error('synthetic storage failure');}});
  await listeners.start();await listeners.start();
  assert.equal(calls,3);
});

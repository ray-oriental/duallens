// Draft/final results across the content client, the extension port and the userscript platform.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslateClient } from '../../extension/content/client.js';
import { ExtensionTranslateClient } from '../../extension/platform/port-client.js';
import { createUserscriptPlatform } from '../../extension/platform/userscript.js';

function event() {
  const listeners = new Set();
  return { addListener: (cb) => listeners.add(cb), removeListener: (cb) => listeners.delete(cb),
    emit(...args) { for (const cb of listeners) cb(...args); } };
}

test('content client: a draft leaves the id open, the final (or an error) closes it', () => {
  let partial;
  const client = new TranslateClient({ translator: () => ({ translateBatch(_req, cb) { partial = cb; return { cancel() {}, done: new Promise(() => {}) }; } }) });
  const seen = []; let done = 0;
  client.request({ items: [{ id: 'a' }, { id: 'b' }] }, { onResults: (r) => seen.push(...r.map(x => `${x.id}:${x.stage || 'final'}`)), onDone: () => done++ });
  partial([{ id: 'a', text: 'a-draft', stage: 'draft' }, { id: 'b', text: 'b-draft', stage: 'draft' }]);
  assert.equal(client.outstanding(), 1, 'still waiting for the finals');
  partial([{ id: 'a', text: 'a-final', stage: 'final' }]);
  partial([{ id: 'a', text: 'late draft', stage: 'draft' }]); // after the final: ignored
  assert.equal(client.outstanding(), 1);
  partial([{ id: 'b', error: { code: 'provider_error', message: 'x' } }]);
  assert.equal(client.outstanding(), 0);
  assert.equal(done, 1);
  assert.deepEqual(seen, ['a:draft', 'b:draft', 'a:final', 'b:final']);
});

test('content client: once every visible id has a draft, nearby requests start without waiting for the LLM', () => {
  const started = []; const sinks = new Map();
  const client = new TranslateClient({ translator: () => ({ translateBatch(req, cb) {
    started.push(req.tag); sinks.set(req.tag, cb); return { cancel() {}, done: new Promise(() => {}) };
  } }) });
  client.request({ tag: 'visible', priority: 0, items: [{ id: 'a' }, { id: 'b' }] }, {});
  client.request({ tag: 'near', priority: 1, items: [{ id: 'c' }] }, {});
  assert.deepEqual(started, ['visible'], 'lower priority waits behind the visible request');
  sinks.get('visible')([{ id: 'a', text: 'A', stage: 'draft' }]);
  assert.deepEqual(started, ['visible'], 'one answered id is not enough');
  sinks.get('visible')([{ id: 'b', text: 'B', stage: 'draft' }]);
  assert.deepEqual(started, ['visible', 'near'], 'all ids have a draft: the next request may start');
  sinks.get('visible')([{ id: 'a', text: 'A2', stage: 'final' }, { id: 'b', text: 'B2', stage: 'final' }]);
  assert.equal(client.outstanding(), 1);
  assert.equal(client.visible, 0, 'the visible slot was released exactly once');
  client.cancelAll();
});

test('extension port: drafts keep ids pending, hints travel with the request and survive a resend', async () => {
  const ports = [];
  const api = { runtime: { id: 'test-extension', connect() {
    const port = { sent: [], onMessage: event(), onDisconnect: event(), postMessage(m) { this.sent.push(m); }, disconnect() {} };
    ports.push(port); return port;
  } } };
  const client = new ExtensionTranslateClient(api); const received = []; let done = 0;
  const id = client.request({ items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }], to: 'zh-CN', draft: true, purpose: 'page', mode: 'mt+llm' },
    { onResults: (r) => received.push(...r.map(x => `${x.id}:${x.stage || 'final'}`)), onDone: () => done++ });
  assert.deepEqual([ports[0].sent[0].draft, ports[0].sent[0].purpose, ports[0].sent[0].mode], [true, 'page', 'mt+llm']);
  ports[0].onMessage.emit({ type: 'partial', reqId: id, results: [{ id: 'a', text: 'A', stage: 'draft' }, { id: 'b', text: 'B', stage: 'draft' }] });
  ports[0].onMessage.emit({ type: 'partial', reqId: id, results: [{ id: 'a', text: 'A2', stage: 'final' }] });
  ports[0].onDisconnect.emit();
  await new Promise((resolve) => setTimeout(resolve, 230));
  assert.deepEqual(ports[1].sent[0].items, [{ id: 'b', text: 'two' }], 'b has only a draft, so it is asked for again');
  assert.equal(ports[1].sent[0].draft, true);
  ports[1].onMessage.emit({ type: 'partial', reqId: id, results: [{ id: 'b', text: 'B2', stage: 'final' }] });
  ports[1].onMessage.emit({ type: 'done', reqId: id });
  assert.deepEqual(received, ['a:draft', 'b:draft', 'a:final', 'b:final']);
  assert.equal(done, 1);
  // The worker finishing with only a draft for an id reports the id as unanswered, never silently drops it.
  const lonely = [];
  const id2 = client.request({ items: [{ id: 'c', text: 'three' }] }, { onResults: (r) => lonely.push(...r) });
  ports[1].onMessage.emit({ type: 'partial', reqId: id2, results: [{ id: 'c', text: 'C', stage: 'draft' }] });
  ports[1].onMessage.emit({ type: 'done', reqId: id2 });
  assert.equal(lonely.length, 2);
  assert.equal(lonely[1].error.code, 'parse_error');
  client.dispose();
});

// A minimal Tampermonkey stand-in whose network is a scripted Microsoft endpoint.
function gmWithMicrosoft() {
  const values = new Map(); const requests = [];
  return {
    requests,
    getValue: async (k, def) => structuredClone(values.get(k) ?? def),
    async setValue(k, v) { values.set(k, structuredClone(v)); },
    async deleteValue(k) { values.delete(k); },
    addValueChangeListener() {},
    registerMenuCommand() {},
    xmlhttpRequest(details) {
      requests.push(details);
      const texts = JSON.parse(details.data);
      queueMicrotask(() => details.onload({ status: 200, responseHeaders: 'content-type: application/json', responseText: JSON.stringify(texts.map(t => ({ translations: [{ text: '机译:' + t }] }))) }));
      return { abort() {} };
    },
  };
}

test('userscript: with no model configured the default settings still translate, via anonymous GM requests', async () => {
  const gm = gmWithMicrosoft();
  const platform = createUserscriptPlatform(gm);
  await platform.ready;
  const results = [];
  await new Promise((resolve) => {
    const handle = platform.translator().translateBatch(
      { items: [{ id: '1', text: 'Hello <g0>world</g0>' }, { id: '2', text: 'Plain' }], to: 'zh-CN', from: 'auto', priority: 0, context: {}, draft: true, purpose: 'page' },
      (r) => results.push(...r));
    handle.done.then(resolve);
  });
  assert.equal(gm.requests.length, 2, 'one html and one plain request');
  assert.ok(gm.requests.every(r => r.anonymous === true && r.url.startsWith('https://edge.microsoft.com/translate/translatetext?')));
  assert.deepEqual(results.map(r => [r.id, r.stage, r.text]).sort(), [['1', 'final', '机译:Hello <g0>world</g0>'], ['2', 'final', '机译:Plain']]);
  const quick = await platform.translator().translateText({ text: 'Hi there', to: 'zh-CN', purpose: 'selection' });
  assert.deepEqual([quick.ok, quick.text, quick.by], [true, '机译:Hi there', 'mt']);
});

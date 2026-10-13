import test from 'node:test';
import assert from 'node:assert/strict';
import { createGMStorageArea } from '../../extension/platform/storage.js';
import { createGMHttp, asFetch } from '../../extension/platform/http.js';
import { performanceSettings, settingsEqual } from '../../extension/platform/settings-store.js';
import { createStoredCache } from '../../extension/platform/cache.js';
import { createUserscriptPlatform } from '../../extension/platform/userscript.js';
import { DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
import { TranslateClient } from '../../extension/content/client.js';
import { ExtensionTranslateClient } from '../../extension/platform/port-client.js';
import { createExtensionPlatform } from '../../extension/platform/extension.js';
import { memoryArea } from './storage-memory.mjs';

function event() {
  const listeners = new Set();
  return { addListener: (cb) => listeners.add(cb), removeListener: (cb) => listeners.delete(cb),
    emit(...args) { for (const cb of listeners) cb(...args); } };
}

function fakeGM() {
  const values = new Map(), watchers = new Map();
  return {
    values,
    getValue: async (k, def) => structuredClone(values.get(k) ?? def),
    async setValue(k, v) {
      const old = values.get(k); values.set(k, structuredClone(v));
      for (const cb of watchers.get(k) || []) cb(k, old, v, false);
    },
    async deleteValue(k) { const old = values.get(k); values.delete(k); for (const cb of watchers.get(k) || []) cb(k, old, {}, false); },
    addValueChangeListener(k, cb) { if (!watchers.has(k)) watchers.set(k, []); watchers.get(k).push(cb); },
    registerMenuCommand() {},
    xmlhttpRequest() { throw new Error('mock profile must not call HTTP'); },
  };
}

test('GM StorageArea get defaults, remove, serialized writes and area isolation', async () => {
  const gm = fakeGM(), local = createGMStorageArea(gm, 'local'), sync = createGMStorageArea(gm, 'sync');
  const changes = []; const off = local.onChanged((c) => changes.push(c));
  await Promise.all([local.set({ a: 1 }), local.set({ b: 2 })]);
  assert.deepEqual(await local.get(null), { a: 1, b: 2 });
  assert.deepEqual(await local.get({ a: 0, missing: 5 }), { a: 1, missing: 5 });
  assert.deepEqual(await sync.get(null), {});
  await local.remove('a');
  assert.equal(changes.length, 3); assert.equal(changes[2].a.oldValue, 1);
  off(); await local.remove('b'); assert.equal(changes.length, 3);
});

test('GM changes from a second adapter reach the first adapter once', async () => {
  const gm = fakeGM(), a = createGMStorageArea(gm, 'area'), b = createGMStorageArea(gm, 'area');
  let count = 0; a.onChanged((c) => { if (c.settings) count++; });
  await b.set({ settings: { targetLang: 'ja' } });
  assert.equal(count, 1);
});

test('user settings strip public keys and persist credentials only in localArea', async () => {
  const gm = fakeGM(), platform = createUserscriptPlatform(gm);
  const store = platform.settingsStore;
  await store.save({ provider: { active: 'custom', profiles: [{ id: 'custom', kind: 'openai', apiKey: 'sk-test-not-real' }] } });
  const data = gm.values.get('duallens:local');
  for (const key of ['settings', 'settings.core', 'settings.glossary', 'settings.sites']) assert.equal(JSON.stringify(data[key]).includes('sk-test-not-real'), false);
  assert.equal(platform.syncArea, platform.localArea);
  assert.equal(store.syncStatus.synced, false);
  assert.equal((await store.load()).provider.profiles[0].apiKey, undefined);
  assert.equal(await store.getSecret('custom'), 'sk-test-not-real');
});

test('concurrent secret writes for different profiles do not lose another profile', async () => {
  const platform = createUserscriptPlatform(fakeGM());
  await Promise.all([platform.settingsStore.setSecret('a', 'sk-test-not-real'), platform.settingsStore.setSecret('b', 'sk-test-not-real')]);
  assert.equal(await platform.settingsStore.getSecret('a'), 'sk-test-not-real');
  assert.equal(await platform.settingsStore.getSecret('b'), 'sk-test-not-real');
});

test('mobile caps concurrency/batch size/margin without changing desktop defaults', () => {
  const s = performanceSettings(DEFAULT_SETTINGS, true);
  assert.equal(s.lazy.rootMarginPx, 400);
  assert.ok(s.provider.profiles.every((p) => p.concurrency <= 2 && p.maxItems <= 12));
  assert.equal(performanceSettings(DEFAULT_SETTINGS, false), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.lazy.rootMarginPx, 600);
});

test('settings equality ignores object key order but preserves chain/glossary array order', () => {
  assert.equal(settingsEqual({ profiles: [{ id: 'a', model: 'm' }] }, { profiles: [{ model: 'm', id: 'a' }] }), true);
  assert.equal(settingsEqual([{ profileId: 'a' }, { profileId: 'b' }], [{ profileId: 'b' }, { profileId: 'a' }]), false);
  assert.equal(settingsEqual({ style: 'plain' }, { style: 'muted' }), false);
});

test('userscript migrates the transitional GM namespace once and retains newer local secrets', async () => {
  const gm = fakeGM();
  gm.values.set('duallens:sync', { settings: { targetLang: 'ja', provider: { active: 'mock' } } });
  gm.values.set('duallens:local', { secrets: { openai: { apiKey: 'sk-test-not-real' } } });
  const platform = createUserscriptPlatform(gm);
  await platform.ready;
  assert.equal((await platform.settingsStore.load()).targetLang, 'ja');
  assert.equal(await platform.settingsStore.getSecret('openai'), 'sk-test-not-real');
  await platform.settingsStore.save({ targetLang: 'en' });
  const second = createUserscriptPlatform(gm); await second.ready;
  assert.equal((await second.settingsStore.load()).targetLang, 'en');
  assert.equal(gm.values.get('duallens:local')['settings.core'].version, 2);
});

test('extension platform follows sync-only v2 updates and uses the shared whole-store local fallback', async () => {
  const changed = event(), local = memoryArea(), sync = memoryArea();
  const api = { storage: { local, sync, onChanged: changed }, runtime: {} };
  const store = createExtensionPlatform(api).settingsStore;
  await store.save({ targetLang: 'en' });
  sync.data['settings.core'].targetLang = 'ja';
  sync.data['settings.glossary'] = [{ src: 'kernel', dst: '内核' }];
  let notifications = 0;
  const off = store.onChange(() => notifications++);
  changed.emit({ 'settings.core': {} }, 'sync');
  assert.equal(notifications, 1);
  assert.equal((await store.load()).targetLang, 'ja');
  assert.equal((await store.load()).glossary[0].dst, '内核');
  await store.save({ glossary: [{ src: 'x'.repeat(9000), dst: 'y' }], style: 'plain' });
  assert.equal(store.syncStatus.synced, false);
  assert.equal(store.syncStatus.reason, 'quota');
  assert.equal((await store.load()).style, 'plain');
  off(); changed.emit({ secrets: {} }, 'local'); assert.equal(notifications, 1);
});

test('userscript cross-profile fallback resolves each v2 secret without hydrating public profiles', async () => {
  const gm = fakeGM(), calls = [];
  gm.xmlhttpRequest = req => {
    calls.push(req.url);
    const primary = req.url.includes('primary.invalid');
    assert.equal(req.headers.Authorization, primary ? 'Bearer sk-primary-not-real' : 'Bearer sk-backup-not-real');
    queueMicrotask(() => req.onload(primary
      ? { status: 429, responseHeaders: 'Retry-After: 60', responseText: '{}' }
      : { status: 200, responseHeaders: '', responseText: JSON.stringify({ choices: [{ message: { content: '{"t":["【译】Hello"]}' } }] }) }));
    return { abort() {} };
  };
  const platform = createUserscriptPlatform(gm); await platform.ready;
  const profiles = ['primary', 'backup'].map(id => ({ id, kind: 'openai', requiresKey: true,
    baseUrl: `https://${id}.invalid/v1`, model: 'same-model', concurrency: 1, maxItems: 12, maxChars: 4000 }));
  await platform.settingsStore.save({ provider: { profiles, chain: profiles.map(p => ({ profileId: p.id, model: p.model })) } });
  await platform.settingsStore.setSecret('primary', 'sk-primary-not-real');
  await platform.settingsStore.setSecret('backup', 'sk-backup-not-real');
  const result = await platform.translator().translateText({ text: 'Hello', to: 'zh-CN' });
  assert.equal(result.ok, true); assert.equal(result.text, '【译】Hello'); assert.equal(calls.length, 2);
  assert.equal(JSON.stringify((await platform.settingsStore.load()).provider).includes('sk-'), false);
});

test('GM HTTP adapter parses headers and omits webpage cookies', async () => {
  let request;
  const http = createGMHttp((req) => { request = req; queueMicrotask(() => req.onload({ status: 200, responseHeaders: 'Content-Type: application/json\r\nRetry-After: 2\r\n', responseText: 'hello' })); return { abort() {} }; });
  const r = await asFetch(http)('https://mock.invalid/v1', { method: 'POST', body: '{}' });
  assert.equal(request.anonymous, true); assert.equal(request.data, '{}');
  assert.equal(r.headers.get('RETRY-AFTER'), '2'); assert.equal(await r.text(), 'hello');
});

test('GM HTTP abort and timeout reject without reflecting request data', async () => {
  const ctrl = new AbortController(); let aborted = false;
  const http = createGMHttp(() => ({ abort() { aborted = true; } }));
  const pending = http({ url: 'https://mock.invalid', signal: ctrl.signal }); ctrl.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(aborted, true);
  const timeout = createGMHttp((req) => { queueMicrotask(() => req.ontimeout()); return {}; });
  await assert.rejects(timeout({ url: 'https://mock.invalid', body: 'private' }), /timed out/);
  await assert.rejects(http({ url: 'javascript:alert(1)' }), /Network request failed/);
});

test('stored cache evicts by timestamp, enforces UTF-8 byte budget, persists and expires', async () => {
  const gm = fakeGM(), area = createGMStorageArea(gm, 'cache'); let clock = 1;
  const cache = createStoredCache(area, { maxBytes: 160, now: () => clock });
  await cache.putMany([{ k: 'a', t: '你好' }]); clock = 2;
  await cache.putMany([{ k: 'b', t: '译'.repeat(25) }]);
  assert.ok(new TextEncoder().encode(JSON.stringify((await area.get('translation-cache'))['translation-cache'])).length <= 160);
  const reloaded = createStoredCache(area, { maxBytes: 160, now: () => 100 });
  assert.equal((await reloaded.getMany(['a', 'b'], { ttlMs: 10 })).size, 0);
  await cache.putMany([{ k: 'large', t: '译'.repeat(100) }]); assert.equal((await cache.getMany(['large'])).size, 0);
  await cache.clear(); assert.equal(await cache.count(), 0);
});

test('userscript service translates batch/text with shared mock engine, supports cancellation', async () => {
  const gm = fakeGM(); const platform = createUserscriptPlatform(gm);
  await platform.settingsStore.save({ provider: { active: 'mock' } });
  const service = platform.translator(), results = [];
  const handle = service.translateBatch({ items: [{ id: 'a', text: 'The world is changing.' }], to: 'zh-CN' }, (r) => results.push(...r));
  await handle.done; assert.equal(results[0].text, '【译】The world is changing.');
  assert.equal((await service.translateText({ text: 'Hello', to: 'zh-CN' })).text, '【译】Hello');
  const cancelled = [];
  const cancel = service.translateBatch({ items: [{ id: 'c', text: 'Another text' }] }, (r) => cancelled.push(...r));
  cancel.cancel(); await cancel.done; assert.deepEqual(cancelled, []);
});

test('userscript provider uses only injected GM transport and v2 secrets injected independently of public settings', async () => {
  const gm = fakeGM(); let calls = 0;
  gm.xmlhttpRequest = (req) => {
    calls++;
    assert.equal(req.headers.Authorization, 'Bearer sk-test-not-real');
    const body = JSON.parse(req.data); const user = body.messages.find((m) => m.role === 'user').content;
    const data = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));
    queueMicrotask(() => req.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ t: data.t.map((t) => '【译】' + t) }) } }] }), responseHeaders: '' }));
    return { abort() {} };
  };
  const platform = createUserscriptPlatform(gm);
  await platform.settingsStore.save({ provider: { active: 'p', profiles: [{ id: 'p', kind: 'openai', model: 'mock', baseUrl: 'https://mock.invalid/v1', apiKey: 'sk-test-not-real', concurrency: 2, maxItems: 12, maxChars: 4000 }] } });
  const result = await platform.translator().translateText({ text: 'Hello', to: 'zh-CN' });
  assert.equal(result.ok, true); assert.equal(calls, 1);
});

test('content client routes cancellation through platform and drains requests', async () => {
  let partial, resolve, cancelled = 0;
  const client = new TranslateClient({ translator: () => ({ translateBatch(_req, cb) { partial = cb; return { cancel() { cancelled++; }, done: new Promise((r) => { resolve = r; }) }; } }) });
  let done = 0;
  const id = client.request({ items: [{ id: 'a' }, { id: 'b' }] }, { onDone: () => done++ });
  partial([{ id: 'a', text: 'a' }]); assert.equal(client.outstanding(), 1);
  partial([{ id: 'b', text: 'b' }]); assert.equal(client.outstanding(), 0); assert.equal(done, 1); resolve();
  const id2 = client.request({ items: [{ id: 'c' }] }, {}); client.cancel(id2);
  assert.notEqual(id, id2); assert.equal(cancelled, 1);
});

test('extension port reconnect resends only unanswered items and retains cancellation', async () => {
  const ports = [];
  const api = { runtime: { id: 'test-extension', connect() {
    const port = { sent: [], onMessage: event(), onDisconnect: event(), postMessage(m) { this.sent.push(m); }, disconnect() {} };
    ports.push(port); return port;
  } } };
  const client = new ExtensionTranslateClient(api); const received = []; let done = 0;
  const id = client.request({ items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }], to: 'zh-CN' },
    { onResults: (r) => received.push(...r), onDone: () => done++ });
  ports[0].onMessage.emit({ type: 'partial', reqId: id, results: [{ id: 'a', text: 'translated' }] });
  ports[0].onDisconnect.emit();
  await new Promise((resolve) => setTimeout(resolve, 230));
  assert.deepEqual(ports[1].sent[0].items, [{ id: 'b', text: 'two' }]);
  ports[1].onMessage.emit({ type: 'partial', reqId: id, results: [{ id: 'a', text: 'duplicate' }, { id: 'b', text: 'translated' }] });
  ports[1].onMessage.emit({ type: 'done', reqId: id });
  assert.equal(received.length, 2); assert.equal(done, 1);
  const cancel = client.request({ items: [{ id: 'c', text: 'three' }] }, {}); client.cancel(cancel);
  assert.equal(ports[1].sent.at(-1).type, 'cancel'); assert.equal(client.outstanding(), 0); client.dispose();
});

test('extension adapter preserves language confidence and one-shot message shapes', async () => {
  const gm = fakeGM(); const storageEvent = event(), messages = [];
  const area = createGMStorageArea(gm, 'area');
  const api = { storage: { sync: area, local: area, onChanged: storageEvent },
    runtime: { id: 'test-extension', onMessage: event(), async sendMessage(msg) { messages.push(msg); return { ok: true, text: 'result' }; } },
    i18n: { detectLanguage(_text, cb) { cb({ isReliable: true, languages: [{ language: 'en', percentage: 75 }] }); } } };
  const platform = createExtensionPlatform(api);
  assert.deepEqual(await platform.detectLanguage('text'), { lang: 'en', reliable: true, percentage: 75 });
  assert.equal((await platform.translator().translateText({ text: 'hello', purpose: 'input' })).ok, true);
  assert.deepEqual(messages[0], { type: 'translate-text', text: 'hello', purpose: 'input' });
  let calls = 0; const off = platform.onMessage(() => { calls++; return false; });
  api.runtime.onMessage.emit({ type: 'get-state' }, { id: 'other-extension' }, () => {});
  api.runtime.onMessage.emit({ type: 'get-state' }, { id: 'test-extension' }, () => {});
  off(); assert.equal(calls, 1);
});

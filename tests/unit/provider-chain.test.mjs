import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../../extension/background/queue.js';
import { createTranslator } from '../../extension/background/translator.js';
import { createMemoryCache } from '../../extension/background/cache.js';
import { mergeSettings, DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
import { testProfile, err, ERR, readSegs } from './helpers.mjs';
const a = testProfile({ id: 'a', model: 'same-model', fallbackModels: [], concurrency: 1 });
const b = testProfile({ id: 'b', model: 'same-model', fallbackModels: [], concurrency: 1 });
const chain = [{ profile: a, model: a.model }, { profile: b, model: b.model }];
const settings = mergeSettings(DEFAULT_SETTINGS, { provider: { active: 'a', profiles: [a, b], chain: chain.map(c => ({ profileId: c.profile.id, model: c.model })) } });

test('429/502/503/network failures immediately switch profile, even with the same model name', async () => {
  for (const failure of [err(ERR.RATE_LIMITED, '429', { retryAfterMs: 1000 }), err(ERR.PROVIDER, '502', { status: 502 }), err(ERR.PROVIDER, '503', { status: 503 }), err(ERR.NETWORK)]) {
    const queue = createQueue(), seen = [], start = Date.now();
    const result = await queue.enqueue({ profile: a, chain, run: async ({ profile }) => { seen.push(profile.id); if (profile.id === 'a') throw failure; return profile.id; } });
    assert.equal(result, 'b'); assert.deepEqual(seen, ['a', 'b']); assert.ok(Date.now() - start < 300);
    assert.equal(queue.currentCandidate(a, chain).profile.id, 'b');
    assert.equal(queue.currentModel(b), 'same-model');
  }
});
test('per-profile concurrency is honored across jobs with different chain heads', async () => {
  const queue = createQueue(); let release, running = 0, maximum = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const task = async () => { running++; maximum = Math.max(maximum, running); await gate; running--; };
  const first = queue.enqueue({ profile: b, run: task });
  const second = queue.enqueue({ profile: a, chain: [{ profile: b, model: b.model }], run: task });
  await new Promise(r => setTimeout(r, 5)); release(); await Promise.all([first, second]); assert.equal(maximum, 1);
});
test('a busy primary queues without calling backups; non-transient HTTP errors do not retry', async () => {
  const queue = createQueue(); let release; const seen = [];
  const gate = new Promise(resolve => { release = resolve; });
  const first = queue.enqueue({ profile: a, chain, run: async ({ profile }) => { seen.push(profile.id); await gate; } });
  const second = queue.enqueue({ profile: a, chain, run: async ({ profile }) => { seen.push(profile.id); } });
  await new Promise(r => setTimeout(r, 5)); assert.deepEqual(seen, ['a']);
  release(); await Promise.all([first, second]); assert.deepEqual(seen, ['a', 'a']);
  let calls = 0;
  await assert.rejects(queue.enqueue({ profile: a, chain, run: async () => { calls++; throw err(ERR.PROVIDER, '400', { status: 400 }); } }));
  assert.equal(calls, 1);
});
test('whole chain cooling waits for earliest profile; queued cancellation removes timers', async () => {
  const queue = createQueue({ cooldownMs: 20 }); let count = 0;
  const start = Date.now();
  await queue.enqueue({ profile: a, chain, run: async () => { if (count++ < 2) throw err(ERR.NETWORK); return 'ok'; } });
  assert.ok(Date.now() - start >= 15); assert.equal(count, 3);
  const ctrl = new AbortController();
  const task = queue.enqueue({ profile: a, chain, signal: ctrl.signal, run: async () => { throw err(ERR.RATE_LIMITED, '429', { retryAfterMs: 10000 }); } });
  await new Promise(r => setTimeout(r, 5)); ctrl.abort(); await assert.rejects(task, e => e.code === ERR.CANCELLED);
});
test('fallback cache is keyed by actual profile and is reused without another request', async () => {
  const queue = createQueue(), cache = createMemoryCache(); let calls = 0;
  const translator = createTranslator({ queue, cache, getSettings: async () => settings, provider: async ({ profile, messages }) => {
    calls++; if (profile.id === 'a') throw err(ERR.NETWORK);
    return JSON.stringify({ t: readSegs(messages).map(s => '【译】' + s.text) });
  } });
  const request = { items: [{ id: 1, text: 'Original paragraph' }], to: 'zh-CN' }, results = [];
  await translator.translate(request, { onPartial: r => results.push(...r) });
  assert.equal(calls, 2); assert.equal(results[0].text, '【译】Original paragraph');
  await translator.translate(request); assert.equal(calls, 2);
  const onlyA = mergeSettings(settings, { provider: { chain: [{ profileId: 'a', model: a.model }] } });
  const fromA = createTranslator({ queue: createQueue(), cache, getSettings: async () => onlyA,
    provider: async ({ messages }) => { calls++; return JSON.stringify({ t: readSegs(messages).map(s => 'A:' + s.text) }); } });
  await fromA.translate(request); assert.equal(calls, 3);
});
test('profiles lacking this device key are skipped without sending a request', async () => {
  const required = { ...a, kind: 'openai', requiresKey: true, baseUrl: 'https://example.com/v1' };
  const s = mergeSettings(settings, { provider: { profiles: [required, b] } });
  const seen = [];
  const translator = createTranslator({ queue: createQueue(), getSettings: async () => s, getSecret: async () => '',
    provider: async ({ profile, messages }) => { seen.push(profile.id); return JSON.stringify({ t: readSegs(messages).map(x => '【译】' + x.text) }); } });
  await translator.translate({ items: [{ id: 1, text: 'Hello world' }] }); assert.deepEqual(seen, ['b']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../../extension/background/handlers.js';
import { createProviders } from '../../extension/background/providers.js';
import { createMemoryCache } from '../../extension/background/cache.js';
import { createQueue } from '../../extension/background/queue.js';
import { createTranslator } from '../../extension/background/translator.js';
import { mergeSettings, DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
import { ERR } from '../../extension/shared/protocol.js';
import {
  MSG_TRANSLATE_TEXT,
  MSG_LIST_MODELS,
  MSG_PROVIDER_TEST,
  MSG_CACHE_STATS,
  MSG_CACHE_CLEAR,
  MSG_OPEN_OPTIONS,
} from '../../extension/shared/protocol.js';
import { FAST_QUEUE } from './helpers.mjs';

// End to end through the real mock provider: handlers -> translator -> queue -> cache -> mock.
function setup(overrides = {}) {
  const settings = mergeSettings(DEFAULT_SETTINGS, { provider: { active: 'mock' }, ...overrides });
  const providers = createProviders({ sleep: async () => {}, random: () => 0 });
  const cache = createMemoryCache();
  const queue = createQueue(FAST_QUEUE);
  const translator = createTranslator({ provider: providers.chat, cache, queue, getSettings: async () => settings });
  const opened = [];
  const handlers = createHandlers({
    translator,
    cache,
    providers,
    getSettings: async () => settings,
    openOptions: async () => opened.push(1),
  });
  return { handlers, cache, opened, settings };
}

test('translate-text through the mock backend', async () => {
  const { handlers } = setup();
  const res = await handlers[MSG_TRANSLATE_TEXT]({ type: MSG_TRANSLATE_TEXT, text: 'Hello <world>', to: 'zh-CN', purpose: 'selection' });
  assert.deepEqual(res, { ok: true, text: '【译】Hello <world>' });
});

test('translate-text validates input', async () => {
  const { handlers } = setup();
  const empty = await handlers[MSG_TRANSLATE_TEXT]({ text: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, ERR.CONFIG);
  const huge = await handlers[MSG_TRANSLATE_TEXT]({ text: 'x'.repeat(20001) });
  assert.equal(huge.ok, false);
  const missing = await handlers[MSG_TRANSLATE_TEXT](undefined);
  assert.equal(missing.ok, false);
});

test('translate-text falls back to the configured target language', async () => {
  const { handlers, cache } = setup({ targetLang: 'ja' });
  await handlers[MSG_TRANSLATE_TEXT]({ text: 'Hi' });
  await handlers[MSG_TRANSLATE_TEXT]({ text: 'Hi', to: 'fr' });
  assert.equal(await cache.count(), 2, 'ja and fr are separate cache rows');
});

test('cache-stats and cache-clear', async () => {
  const { handlers } = setup();
  await handlers[MSG_TRANSLATE_TEXT]({ text: 'one' });
  await handlers[MSG_TRANSLATE_TEXT]({ text: 'two' });
  assert.deepEqual(await handlers[MSG_CACHE_STATS]({}), { ok: true, entries: 2 });
  assert.deepEqual(await handlers[MSG_CACHE_CLEAR]({}), { ok: true, entries: 0 });
  assert.deepEqual(await handlers[MSG_CACHE_STATS]({}), { ok: true, entries: 0 });
});

test('provider-test reports latency and a parsed sample', async () => {
  let t = 1000;
  const settings = mergeSettings(DEFAULT_SETTINGS, {});
  const providers = createProviders({ sleep: async () => {}, random: () => 0 });
  const handlers = createHandlers({
    translator: null,
    cache: createMemoryCache(),
    providers,
    getSettings: async () => settings,
    now: () => (t += 25),
  });
  const res = await handlers[MSG_PROVIDER_TEST]({ profileId: 'mock' });
  assert.equal(res.ok, true);
  assert.equal(res.latencyMs, 25);
  assert.equal(res.sample, '【译】Hello, world.');
});

test('provider-test: unknown profile and unusable profile give config errors', async () => {
  const { handlers } = setup();
  const unknown = await handlers[MSG_PROVIDER_TEST]({ profileId: 'nope' });
  assert.deepEqual([unknown.ok, unknown.error.code], [false, ERR.CONFIG]);
  const unset = await handlers[MSG_PROVIDER_TEST]({ profileId: 'openai' }); // default openai profile has no baseUrl
  assert.deepEqual([unset.ok, unset.error.code], [false, ERR.CONFIG]);
});

test('provider-test surfaces provider failures', async () => {
  const { handlers } = setup({ provider: { profiles: DEFAULT_SETTINGS.provider.profiles.map((p) => (p.id === 'mock' ? { ...p, model: 'mock-error' } : p)) } });
  const res = await handlers[MSG_PROVIDER_TEST]({ profileId: 'mock' });
  assert.deepEqual([res.ok, res.error.code], [false, ERR.PROVIDER]);
});

test('list-models', async () => {
  const { handlers } = setup();
  const res = await handlers[MSG_LIST_MODELS]({ profileId: 'mock' });
  assert.equal(res.ok, true);
  assert.ok(res.models.some((m) => m.id === 'mock'));
  assert.equal((await handlers[MSG_LIST_MODELS]({ profileId: 'nope' })).ok, false);
});

test('open-options calls the injected opener and replies ok', async () => {
  const { handlers, opened } = setup();
  assert.deepEqual(await handlers[MSG_OPEN_OPTIONS]({}), { ok: true });
  assert.equal(opened.length, 1);
});

test('every one-shot message type from the protocol has a handler', () => {
  const { handlers } = setup();
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [MSG_TRANSLATE_TEXT, MSG_LIST_MODELS, MSG_PROVIDER_TEST, MSG_CACHE_STATS, MSG_CACHE_CLEAR, MSG_OPEN_OPTIONS].sort(),
  );
});

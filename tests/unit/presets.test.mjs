import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROVIDER_PRESETS, profileFromPreset, recommendedFreeChain } from '../../extension/shared/presets.js';
import { createProviders, freeOpenRouterModels } from '../../extension/background/providers.js';
import { createHandlers } from '../../extension/background/handlers.js';
import { DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
const fixture = JSON.parse(await readFile(new URL('./fixtures/openrouter-models.json', import.meta.url)));
const response = body => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });

test('all required presets have key instructions, conservative JSON defaults and batch parameters', () => {
  for (const id of ['openrouter', 'deepseek', 'openai', 'ollama', 'lmstudio', 'custom']) {
    const p = PROVIDER_PRESETS.find(p => p.id === id); assert.ok(p);
    assert.equal(typeof p.requiresKey, 'boolean'); assert.equal(typeof p.jsonMode, 'boolean'); assert.ok(p.maxItems <= 12 && p.concurrency <= 2);
    if (p.requiresKey) { assert.ok(p.baseUrl.startsWith('https://')); assert.ok(p.keyUrl.startsWith('https://')); }
  }
  assert.equal(PROVIDER_PRESETS.length, 6);
  assert.equal(profileFromPreset('ollama').baseUrl, 'http://localhost:11434/v1');
  assert.equal(profileFromPreset('lmstudio').baseUrl, 'http://localhost:1234/v1');
  assert.match(PROVIDER_PRESETS.find(p => p.id === 'ollama').description, /OLLAMA_ORIGINS/);
  assert.throws(() => profileFromPreset('unknown'));
});
test('OpenRouter filters only zero input AND output prices, sorts JSON support/context, and recommends diverse vendors', () => {
  const models = freeOpenRouterModels(fixture.data);
  assert.deepEqual(models.map(m => m.id), ['vendor-a/large:free', 'vendor-c/medium:free', 'vendor-a/small:free', 'vendor-b/huge:free']);
  assert.deepEqual(recommendedFreeChain(models, 'or').map(c => c.model), ['vendor-a/large:free', 'vendor-c/medium:free', 'vendor-b/huge:free']);
  assert.equal(freeOpenRouterModels([{ id: 'missing-price', pricing: { prompt: null, completion: '' } }]).length, 0);
});
test('OpenRouter discovery is public and X-Title is added to discovery and authorized chat', async () => {
  const seen = [], provider = createProviders({ getSecret: async () => 'sk-test-not-real', fetchImpl: async (url, init) => {
    seen.push({ url, init }); return response(url.endsWith('/models') ? fixture : { choices: [{ message: { content: '{"t":["你好"]}' } }] });
  } });
  assert.equal((await provider.listModels('openrouter')).length, 4);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/models'); assert.equal(seen[0].init.headers.Authorization, undefined);
  const profile = { ...profileFromPreset('openrouter'), model: 'vendor-a/large:free' };
  await provider.chat({ profile, messages: [{ role: 'user', content: 'JSON test' }] });
  assert.equal(seen[1].init.headers.Authorization, 'Bearer sk-test-not-real');
  for (const call of seen) assert.equal(call.init.headers['X-Title'], 'DualLens');
  assert.equal(profile.apiKey, undefined);
});
test('preset model-list handler works without a saved profile and no request happens at construction', async () => {
  let requests = 0;
  const providers = createProviders({ fetchImpl: async () => { requests++; return response(fixture); } });
  const handlers = createHandlers({ providers, getSettings: async () => DEFAULT_SETTINGS });
  assert.equal(requests, 0);
  const r = await handlers['list-models']({ presetId: 'openrouter' });
  assert.equal(r.ok, true); assert.equal(r.models.length, 4); assert.equal(requests, 1);
});
test('requires-key requests fail before fetch; one-character echoed credentials are redacted', async () => {
  let requests = 0;
  const p = { ...profileFromPreset('openrouter'), model: 'x' };
  const providers = createProviders({ getSecret: async () => '', fetchImpl: async () => { requests++; } });
  await assert.rejects(providers.chat({ profile: p, messages: [] }), /API key/); assert.equal(requests, 0);
  const keyed = createProviders({ getSecret: async () => 'x', fetchImpl: async () => ({ status: 401, headers: { get: () => null }, text: async () => '{"error":{"message":"x"}}' }) });
  await assert.rejects(keyed.chat({ profile: p, messages: [] }), e => !e.message.includes('：x'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createSettingsStore, publicSettings } from '../../extension/shared/settings.js';
import { exportConfig, importConfig } from '../../extension/shared/configcrypto.js';
import { createProviders } from '../../extension/background/providers.js';
import { parsePairing, pairingUrl, gatewayProfile, gatewayChain, discoverGateway, compactConfig, PAIR_PREFIX } from '../../extension/ui/forms/gateway.js';
import { importSettings, validateSettings } from '../../extension/ui/forms/validation.js';
import { qrcodegen } from '../../extension/ui/forms/qrcodegen.js';
const TOKEN = 'A'.repeat(43);
const pairText = data => PAIR_PREFIX + Buffer.from(JSON.stringify(data)).toString('base64url');
function area() {
  const items = {};
  return { items, get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(k => [k, items[k]])), set: async values => Object.assign(items, structuredClone(values)) };
}

test('pairing imports only strict loopback and Tailscale IPv4 endpoints', () => {
  const data = { urls: ['http://127.0.0.1:18790/v1', 'http://100.100.1.2:18791/v1'], token: TOKEN };
  assert.deepEqual(parsePairing(pairText(data)), { token: TOKEN, usb: data.urls[0], tailscale: data.urls[1] });
  for (const url of ['http://0.0.0.0:18791/v1', 'http://192.168.1.2:18791/v1', 'http://100.128.1.1:18791/v1', 'http://[::]:18791/v1', 'http://100.100.1.2:18791/v1?key=x', 'https://evil.test:18791/v1', 'http://user:pass@127.0.0.1:18790/v1']) assert.throws(() => pairingUrl(url));
  assert.throws(() => parsePairing(pairText({ ...data, token: 'bad' })));
  assert.throws(() => parsePairing(pairText({ ...data, urls: [data.urls[1]] })));
  assert.throws(() => parsePairing('not a pairing code'));
  assert.equal(parsePairing(pairText({ urls: [data.urls[0]], token: TOKEN })).tailscale, undefined);
});

test('recommended gateway chain uses discovered SJTU then approved free Hermes then qwen3:4b; subscriptions manual only', () => {
  const models = ['codex/default', 'claude/haiku', 'ollama/gpt-oss:20b', 'hermes/paid', 'ollama/qwen3:4b', 'hermes/upstage/solar-mini4:free', 'sjtu/deepseek-chat'];
  assert.deepEqual(gatewayChain(models.map(id => ({ id })), 'gateway'), ['sjtu/deepseek-chat', 'hermes/upstage/solar-mini4:free', 'ollama/qwen3:4b'].map(model => ({ profileId: 'gateway', model })));
});

test('one-click discovery calls only health and model catalog, never completions', async () => {
  const calls = [];
  const models = [{ id: 'ollama/qwen3:4b' }];
  const found = await discoverGateway(async req => {
    calls.push(req);
    return { status: 200, text: JSON.stringify(req.url.endsWith('/health') ? { ok: true, name: 'DualLens' } : { data: models }) };
  });
  assert.deepEqual(found, models);
  assert.deepEqual(calls.map(r => r.url), ['http://127.0.0.1:18790/health', 'http://127.0.0.1:18790/v1/models']);
  assert.ok(calls.every(r => !r.headers.Authorization));
  await assert.rejects(discoverGateway(async () => ({ status: 200, text: '{"ok":true,"name":"other"}' })));
});

test('pairing credential is local only, encrypted export roundtrips, plaintext removes tokens', async () => {
  const local = area(), sync = area(), store = createSettingsStore({ localArea: local, syncArea: sync });
  const settings = structuredClone(DEFAULT_SETTINGS);
  const p = gatewayProfile('remote', '电脑网关（Tailscale）', 'http://100.100.1.2:18791/v1');
  settings.provider.profiles.push(p); settings.provider.active = p.id; settings.provider.chain = [{ profileId: p.id, model: p.model }];
  await store.save(settings); await store.setSecret(p.id, TOKEN);
  assert.equal(await store.getSecret(p.id), TOKEN);
  assert.ok(!JSON.stringify(sync.items).includes(TOKEN));
  assert.ok(!JSON.stringify(await store.load()).includes(TOKEN));
  assert.ok(!JSON.stringify(publicSettings({ pairingToken: TOKEN, remote_token: TOKEN, ...settings })).includes(TOKEN));
  const encrypted = await exportConfig(settings, { password: 'test passphrase', secrets: { remote: { apiKey: TOKEN } } });
  const imported = await importConfig(encrypted, 'test passphrase');
  assert.equal(imported.secrets.remote.apiKey, TOKEN);
  assert.equal(importSettings(imported.settings, DEFAULT_SETTINGS).provider.profiles.at(-1).kind, 'gateway');
  assert.ok(!(await exportConfig(settings, { secrets: { remote: { apiKey: TOKEN } } })).includes(TOKEN));
});

test('gateway transport resolves paired credentials for models and chat, redacts echoed tokens, and blocks token exfiltration', async () => {
  const calls = [];
  const providers = createProviders({ getSecret: async () => TOKEN, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(url.endsWith('/models') ? { data: [{ id: 'ollama/qwen3:4b' }] } : { choices: [{ message: { content: 'result ' + TOKEN } }] }) };
  } });
  const profile = gatewayProfile('remote', 'remote', 'http://100.100.1.2:18791/v1');
  await providers.listModels(profile);
  const text = await providers.chat({ profile, messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(text, 'result ***');
  assert.ok(calls.every(c => c.init.headers.Authorization === 'Bearer ' + TOKEN));
  await assert.rejects(providers.chat({ profile: { ...profile, baseUrl: 'http://evil.test/v1' }, messages: [] }), /Tailscale/);
  assert.equal(calls.length, 2);
});

test('mobile compact encrypted backup restores settings and fits a real QR with pairing profiles', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  for (const [id, url] of [['usb', 'http://127.0.0.1:18790/v1'], ['tailscale', 'http://100.100.1.2:18791/v1']]) settings.provider.profiles.push(gatewayProfile(id, id, url));
  settings.provider.active = 'tailscale'; settings.provider.chain = [{ profileId: 'tailscale', model: 'ollama/qwen3:4b' }];
  const text = await exportConfig(compactConfig(settings), { password: 'test passphrase', secrets: { usb: { apiKey: TOKEN }, tailscale: { apiKey: TOKEN } } });
  const decoded = await importConfig(text, 'test passphrase');
  const restored = importSettings(decoded.settings, DEFAULT_SETTINGS);
  assert.equal(restored.provider.profiles.length, settings.provider.profiles.length);
  assert.equal(restored.provider.profiles.at(-1).baseUrl, settings.provider.profiles.at(-1).baseUrl);
  assert.equal(restored.provider.profiles.at(-1).kind, 'gateway');
  assert.equal(restored.provider.active, 'tailscale');
  assert.equal(restored.provider.profiles[0].timeoutMs, settings.provider.profiles[0].timeoutMs);
  assert.doesNotThrow(() => qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.LOW));
  assert.doesNotThrow(() => validateSettings(restored));
  assert.throws(() => qrcodegen.QrCode.encodeText('a'.repeat(4000), qrcodegen.QrCode.Ecc.LOW));
});

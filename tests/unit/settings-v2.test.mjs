import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, DEFAULT_SETTINGS, SETTINGS_KEYS, providerChain } from '../../extension/shared/settings.js';
import { memoryArea } from './storage-memory.mjs';

const setup = (local = memoryArea(), sync = memoryArea()) => ({ local, sync, store: createSettingsStore({ localArea: local, syncArea: sync }) });
test('v2 splits sync keys and never writes credentials to sync or compatibility mirror', async () => {
  const { store, local, sync } = setup();
  await store.setSecret('openai', 'sk-test-not-real');
  await store.save({ glossary: [{ src: 'kernel', dst: '内核' }], siteRules: { always: ['example.com'] },
    provider: { profiles: DEFAULT_SETTINGS.provider.profiles.map(p => p.id === 'openai' ? { ...p, apiKey: 'sk-test-not-real' } : p) },
    nested: { password: 'sk-test-not-real' }, secrets: { bad: { apiKey: 'sk-test-not-real' } } });
  assert.deepEqual(Object.keys(sync.data).sort(), [...SETTINGS_KEYS].sort());
  assert.equal(JSON.stringify(sync.writes).includes('sk-test-not-real'), false);
  assert.equal(JSON.stringify(local.data.settings).includes('sk-test-not-real'), false);
  assert.equal(local.data.secrets.openai.apiKey, 'sk-test-not-real');
  assert.deepEqual(sync.data['settings.glossary'], [{ src: 'kernel', dst: '内核' }]);
  assert.equal(sync.data['settings.core'].siteRules, undefined);
  assert.equal(sync.data['settings.core'].glossary, undefined);
  assert.deepEqual((await store.load()).siteRules.always, ['example.com']);
  assert.equal(await store.getSecret('openai'), 'sk-test-not-real');
  assert.equal(store.syncStatus.synced, true);
});
test('8KB item limit is measured in UTF-8 bytes and falls back as a whole', async () => {
  const { store, local, sync } = setup();
  await store.save({ glossary: [{ src: '字'.repeat(2800), dst: 'translation' }] });
  assert.equal(sync.writes.length, 0);
  for (const key of SETTINGS_KEYS) assert.ok(Object.hasOwn(local.data, key));
  assert.equal(store.syncStatus.synced, false);
  assert.equal(store.syncStatus.reason, 'quota');
  assert.equal((await store.load()).glossary[0].src.length, 2800);
});
test('quota and unavailable sync preserve complete local config and other devices last valid sync data', async () => {
  for (const sync of [undefined, memoryArea({}, { failSet: true }), memoryArea({}, { failGet: true })]) {
    const local = memoryArea(), store = createSettingsStore({ localArea: local, syncArea: sync });
    await store.save({ targetLang: 'ja', glossary: [{ src: 'a', dst: 'b' }] });
    assert.equal((await store.load()).targetLang, 'ja');
    assert.equal(store.syncStatus.synced, false);
  }
  const { store, sync } = setup();
  await store.save({ targetLang: 'en' });
  await store.save({ targetLang: 'ja', glossary: [{ src: 'a'.repeat(9000), dst: 'b' }] });
  assert.equal(sync.data['settings.core'].targetLang, 'en');
  assert.equal((await store.load()).targetLang, 'ja');
});
test('v1 migration is idempotent across store recreation; newer v2 secrets win', async () => {
  const legacy = structuredClone(DEFAULT_SETTINGS); legacy.version = 1;
  legacy.provider.active = 'openai'; legacy.provider.profiles[0].apiKey = 'sk-test-not-real';
  const local = memoryArea({ settings: legacy }), sync = memoryArea();
  let store = createSettingsStore({ localArea: local, syncArea: sync });
  assert.equal((await store.load()).version, 3);
  assert.equal(await store.getSecret('openai'), 'sk-test-not-real');
  const writes = local.writes.length + sync.writes.length;
  store = createSettingsStore({ localArea: local, syncArea: sync });
  await store.load(); await store.getSecret('openai');
  assert.equal(local.writes.length + sync.writes.length, writes);
  await store.setSecret('openai', 'sk-new-test-not-real');
  await local.set({ settings: legacy }); await store.load();
  assert.equal(await store.getSecret('openai'), 'sk-new-test-not-real');
  assert.equal(JSON.stringify(sync.writes).includes('sk-test-not-real'), false);
});
test('storage key reordering does not trigger re-migration or overwrite newer sync settings', async () => {
  const { store, local, sync } = setup();
  await store.save({ targetLang: 'en' });
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value;
  local.data.settings = sort(local.data.settings);
  sync.data['settings.core'].targetLang = 'ja';
  const writes = local.writes.length + sync.writes.length;
  assert.equal((await store.load()).targetLang, 'ja');
  assert.equal(local.writes.length + sync.writes.length, writes);
});
test('clearing a key before migration or re-reading an old v1 snapshot cannot resurrect it', async () => {
  const legacy = structuredClone(DEFAULT_SETTINGS); legacy.version = 1;
  legacy.provider.profiles[0].apiKey = 'sk-test-not-real';
  const { store, local } = setup(memoryArea({ settings: legacy }));
  await store.setSecret('openai', '');
  await store.load(); assert.equal(await store.getSecret('openai'), '');
  await local.set({ settings: legacy });
  await store.load(); assert.equal(await store.getSecret('openai'), '');
});
test('synchronized profiles require a separate key on a second device', async () => {
  const { store, sync } = setup();
  await store.setSecret('openai', 'sk-test-not-real');
  await store.save({ targetLang: 'ja' });
  const second = createSettingsStore({ localArea: memoryArea(), syncArea: sync });
  assert.equal((await second.load()).targetLang, 'ja');
  assert.equal(await second.getSecret('openai'), '');
});
test('change subscription covers local and sync and unsubscribes; shared local area is not cloud sync', async () => {
  const { store, local, sync } = setup(); let changes = 0;
  const off = store.onChange(() => changes++);
  await store.setSecret('mock', ''); await sync.set({ 'settings.glossary': [] });
  assert.equal(changes, 2); off(); await local.set({ secrets: {} }); assert.equal(changes, 2);
  const scriptStore = createSettingsStore({ localArea: local, syncArea: local });
  await scriptStore.save({ targetLang: 'en' }); assert.equal(scriptStore.syncStatus.synced, false);
});
test('concurrent partial saves serialize; plaintext imports cannot overwrite existing secrets', async () => {
  const { store } = setup();
  await Promise.all([store.save({ targetLang: 'ja' }), store.save({ style: 'plain' }), store.setSecret('openai', 'sk-test-not-real')]);
  const s = await store.load(); assert.equal(s.targetLang, 'ja'); assert.equal(s.style, 'plain');
  await store.save({ secrets: { openai: { apiKey: 'ignored' } } });
  assert.equal(await store.getSecret('openai'), 'sk-test-not-real');
});
test('prototype keys and credential-bearing endpoints are refused before sync', async () => {
  const { store, sync } = setup();
  await assert.rejects(store.setSecret('__proto__', 'sk-test-not-real'));
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider.profiles[0].baseUrl = 'https://example.com/v1?apiKey=sk-test-not-real';
  await assert.rejects(store.save(settings)); assert.equal(sync.writes.length, 0);
});
test('chain spans profiles and retains arbitrary compatible-service model names', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.provider.chain = [{ profileId: 'openai', model: 'vendor/a' }, { profileId: 'mock', model: 'mock' }];
  assert.deepEqual(providerChain(s).map(c => c.profile.id), ['openai', 'mock']);
});
test('saving an explicit chain keeps legacy active profile/model aligned with its actual head', async () => {
  const { store } = setup();
  const s = await store.save({ provider: { chain: [{ profileId: 'mock', model: 'mock-slow' }, { profileId: 'openai', model: 'local/model' }] } });
  assert.equal(s.provider.active, 'mock');
  assert.equal(s.provider.profiles.find(p => p.id === 'mock').model, 'mock-slow');
  await assert.rejects(store.save({ provider: { chain: [{ profileId: 'missing', model: 'x' }] } }));
});

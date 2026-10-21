import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache, createCache, makeKeyer, glossaryHash } from '../../extension/background/cache.js';
import { sha256Hex } from '../../extension/shared/hash.js';

test('sha256Hex matches known vectors', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal((await sha256Hex('译文')).length, 64);
});

test('makeKeyer: every input dimension changes the key; identical inputs agree', async () => {
  const base = { profileId: 'compatible', model: 'm', to: 'zh-CN', preset: 'general', custom: '', glossary: [] };
  const key = async (over = {}, text = 'Hello') => (await makeKeyer({ ...base, ...over }))(text);
  const k0 = await key();
  assert.equal(k0.length, 64);
  assert.equal(await key(), k0);
  const others = [
    await key({ profileId: 'other' }),
    await key({ model: 'm2' }),
    await key({ to: 'ja' }),
    await key({ preset: 'tech' }),
    await key({ glossary: [{ src: 'a', dst: 'b' }] }),
    await key({}, 'Hello!'),
  ];
  for (const k of others) assert.notEqual(k, k0);
  assert.equal(new Set([k0, ...others]).size, others.length + 1);
});

test('makeKeyer: custom prompt text matters only for the custom preset', async () => {
  const base = { profileId: 'p', model: 'm', to: 'en', glossary: [] };
  const k = async (preset, custom) => (await makeKeyer({ ...base, preset, custom }))('x');
  assert.notEqual(await k('custom', 'be formal'), await k('custom', 'be casual'));
  assert.equal(await k('general', 'be formal'), await k('general', 'be casual'));
});

test('glossaryHash ignores order and invalid rows, is empty for none', async () => {
  assert.equal(await glossaryHash([]), '');
  assert.equal(await glossaryHash(undefined), '');
  assert.equal(await glossaryHash([{ src: '', dst: 'x' }]), '');
  const a = await glossaryHash([{ src: 'a', dst: '1' }, { src: 'b', dst: '2' }]);
  const b = await glossaryHash([{ src: 'b', dst: '2' }, { src: 'a', dst: '1' }, { src: '', dst: 'ignored' }]);
  assert.equal(a, b);
  assert.notEqual(a, await glossaryHash([{ src: 'a', dst: '1' }]));
});

test('memory cache: put, get, count, clear', async () => {
  const c = createMemoryCache();
  await c.putMany([{ k: 'a', t: '一' }, { k: 'b', t: '二' }]);
  const got = await c.getMany(['a', 'b', 'zzz']);
  assert.deepEqual([...got], [['a', '一'], ['b', '二']]);
  assert.equal(await c.count(), 2);
  await c.putMany([{ k: 'a', t: '新' }]);
  assert.equal((await c.getMany(['a'])).get('a'), '新');
  assert.equal(await c.count(), 2);
  await c.clear();
  assert.equal(await c.count(), 0);
});

test('memory cache: entries older than the TTL are misses and are purged on the next write', async () => {
  let clock = 1_000_000;
  const c = createMemoryCache({ now: () => clock });
  const day = 86400000;
  await c.putMany([{ k: 'old', t: 'x' }]);
  clock += 10 * day;
  await c.putMany([{ k: 'new', t: 'y' }]);
  assert.equal((await c.getMany(['old', 'new'], { ttlMs: 30 * day })).size, 2);
  clock += 25 * day; // old is now 35 days, new is 25
  const got = await c.getMany(['old', 'new'], { ttlMs: 30 * day });
  assert.deepEqual([...got.keys()], ['new']);
  assert.equal(await c.count(), 2); // still stored until a write prunes
  await c.putMany([{ k: 'fresh', t: 'z' }], { ttlMs: 30 * day });
  assert.equal(await c.count(), 2);
  assert.equal((await c.getMany(['old'])).size, 0);
  assert.equal((await c.getMany(['old', 'new'], { ttlMs: 0 })).size, 1); // ttl 0 = no expiry (old is gone anyway)
});

test('memory cache: over maxEntries evicts the oldest down to 90%', async () => {
  let clock = 0;
  const c = createMemoryCache({ now: () => clock });
  for (let i = 0; i < 10; i++) {
    clock = i;
    await c.putMany([{ k: `k${i}`, t: String(i) }], { maxEntries: 10 });
  }
  assert.equal(await c.count(), 10);
  clock = 100;
  await c.putMany([{ k: 'k10', t: '10' }], { maxEntries: 10 });
  assert.equal(await c.count(), 9);
  const got = await c.getMany(['k0', 'k1', 'k2', 'k10']);
  assert.deepEqual([...got.keys()], ['k2', 'k10']); // k0, k1 (oldest) are gone
});

test('createCache falls back to the memory cache when IndexedDB is absent', async () => {
  const c = createCache({ indexedDB: null });
  await c.putMany([{ k: 'a', t: 'b' }]);
  assert.equal(await c.count(), 1);
});

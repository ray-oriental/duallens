import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  hostMatches,
  siteRuleFor,
  activeProfile,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
} from '../../extension/shared/settings.js';

test('hostMatches: exact and wildcard', () => {
  assert.equal(hostMatches('example.com', 'example.com'), true);
  assert.equal(hostMatches('example.com', 'www.example.com'), false);
  assert.equal(hostMatches('*.example.com', 'example.com'), true);
  assert.equal(hostMatches('*.example.com', 'a.b.example.com'), true);
  assert.equal(hostMatches('*.example.com', 'badexample.com'), false);
  assert.equal(hostMatches('  Example.COM ', 'EXAMPLE.com'), true);
  assert.equal(hostMatches('', 'example.com'), false);
});

test('mergeSettings: deep merge, arrays and scalars replace, base is not mutated', () => {
  const base = { a: 1, o: { x: 1, y: 2 }, arr: [1, 2] };
  const out = mergeSettings(base, { o: { y: 3 }, arr: [9], z: 'new' });
  assert.deepEqual(out, { a: 1, o: { x: 1, y: 3 }, arr: [9], z: 'new' });
  assert.deepEqual(base, { a: 1, o: { x: 1, y: 2 }, arr: [1, 2] });
  assert.deepEqual(mergeSettings(base, null), base);
  assert.notEqual(mergeSettings(base, undefined), base);
});

test('mergeSettings keeps defaults for fields a stored settings object lacks', () => {
  const stored = { targetLang: 'ja', cache: { enabled: false } };
  const s = mergeSettings(DEFAULT_SETTINGS, stored);
  assert.equal(s.targetLang, 'ja');
  assert.equal(s.cache.enabled, false);
  assert.equal(s.cache.maxEntries, DEFAULT_SETTINGS.cache.maxEntries);
  assert.equal(s.cache.ttlDays, 30);
  assert.equal(s.provider.profiles.length, 2);
});

test('siteRuleFor: never beats always, custom rule is independent', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    siteRules: {
      always: ['a.com', '*.news.org'],
      never: ['b.com', 'a.com'],
      custom: [{ match: '*.news.org', include: ['article'], exclude: ['.ad'], style: 'card' }],
    },
  });
  assert.deepEqual(siteRuleFor(s, 'a.com'), { mode: 'never', custom: null });
  assert.deepEqual(siteRuleFor(s, 'b.com'), { mode: 'never', custom: null });
  const news = siteRuleFor(s, 'www.news.org');
  assert.equal(news.mode, 'always');
  assert.equal(news.custom.style, 'card');
  assert.deepEqual(siteRuleFor(s, 'other.net'), { mode: null, custom: null });
});

test('activeProfile picks the active one and falls back to the first', () => {
  assert.equal(activeProfile(DEFAULT_SETTINGS), undefined);
  const s = mergeSettings(DEFAULT_SETTINGS, { provider: { active: 'mock' } });
  assert.equal(activeProfile(s).id, 'mock');
  const gone = mergeSettings(DEFAULT_SETTINGS, { provider: { active: 'nope' } });
  assert.equal(activeProfile(gone).id, 'openai');
});

test('loadSettings / saveSettings round trip against a fake chrome.storage', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])]));
        },
        async set(obj) {
          Object.assign(store, structuredClone(obj));
        },
      },
    },
  };
  try {
    assert.equal((await loadSettings()).targetLang, 'zh-CN');
    const next = await saveSettings({ targetLang: 'fr', siteRules: { always: ['x.com'] } });
    assert.equal(next.targetLang, 'fr');
    assert.deepEqual(store[SETTINGS_KEY].siteRules.always, ['x.com']);
    const again = await saveSettings({ siteRules: { never: ['y.com'] } });
    assert.deepEqual(again.siteRules.always, ['x.com']); // untouched list survives a partial patch
    assert.deepEqual(again.siteRules.never, ['y.com']);
  } finally {
    delete globalThis.chrome;
  }
});

test('fresh installation requires a configured provider instead of borrowing local accounts', () => {
  assert.equal(DEFAULT_SETTINGS.provider.active, '');
  assert.deepEqual(DEFAULT_SETTINGS.provider.chain, []);
  const profile = DEFAULT_SETTINGS.provider.profiles.find(p => p.id === 'openai');
  assert.equal(profile.kind, 'openai');
  assert.equal(profile.baseUrl, '');
  assert.equal(profile.apiKey, undefined);
  assert.equal(DEFAULT_SETTINGS.provider.profiles.some(p => p.kind === 'gateway'), false);
});

// Settings schema, defaults and storage helpers.
// v2 contract: docs/PLATFORMS.md §3. Credentials stay in localArea only.
import { chromeStorageArea } from './storage-areas.js';
import { sha256Hex } from './hash.js';

export const SETTINGS_KEY = 'settings';
export const SETTINGS_VERSION = 2;
export const SETTINGS_KEYS = ['settings.core', 'settings.glossary', 'settings.sites'];
export const SECRETS_KEY = 'secrets';
const STORAGE_KEY = 'settings.storage';

export const LANGS = Object.freeze([
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'ar', name: 'العربية' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
]);

// Visual styles for inserted translations; CSS lives in styles/content.css as .dl-s-<id>.
export const STYLES = Object.freeze([
  { id: 'plain', name: '无装饰' },
  { id: 'muted', name: '弱化（灰色）' },
  { id: 'underline', name: '下划线' },
  { id: 'dashed', name: '虚线下划线' },
  { id: 'dotted', name: '点状下划线' },
  { id: 'wavy', name: '波浪线' },
  { id: 'highlight', name: '背景高亮' },
  { id: 'marker', name: '马克笔' },
  { id: 'quote', name: '引用块' },
  { id: 'card', name: '卡片' },
  { id: 'divider', name: '分隔线' },
  { id: 'italic', name: '斜体' },
  { id: 'bold', name: '加粗' },
  { id: 'blur', name: '模糊（悬停显示）' },
  { id: 'mask', name: '遮罩（悬停显示）' },
]);

export const PROMPT_PRESETS = Object.freeze(['general', 'tech', 'academic', 'news', 'social', 'custom']);

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  displayMode: 'bilingual', // 'bilingual' | 'translation-only'
  style: 'muted',
  minChars: 2,
  inlineMaxChars: 24, // units shorter than this get the inline layout
  lazy: { rootMarginPx: 600, batchDelayMs: 80 },
  comics: { language: 'jpn', visionEnabled: false },

  provider: {
    active: '',
    chain: [],
    profiles: [
      {
        id: 'gateway',
        kind: 'gateway', // OpenAI-compatible local gateway, no key held by the extension
        name: '本机网关',
        baseUrl: 'http://127.0.0.1:18790/v1',
        model: 'ollama/qwen3:4b',
        // claude/* and codex/* draw on paid subscriptions; they are never in the default chain.
        fallbackModels: [],
        jsonMode: true,
        maxItems: 20, // SJTU: keep one batch's output under ~900 tokens so a call stays < 1 min
        maxChars: 3000,
        concurrency: 2,
        timeoutMs: 130000,
      },
      {
        id: 'openai',
        kind: 'openai', // any OpenAI-compatible endpoint the user supplies
        name: '自定义 OpenAI 兼容接口',
        baseUrl: '',
        model: '',
        fallbackModels: [],
        jsonMode: false,
        maxItems: 20,
        maxChars: 4000,
        concurrency: 3,
        timeoutMs: 60000,
      },
      {
        id: 'mock',
        kind: 'mock', // deterministic fake translation, no network; for tests and demos
        name: '演示（不调用模型）',
        model: 'mock',
        fallbackModels: [],
        maxItems: 50,
        maxChars: 8000,
        concurrency: 4,
        timeoutMs: 5000,
      },
    ],
  },

  prompt: { preset: 'general', custom: '' },
  glossary: [], // [{ src, dst }]

  hover: { enabled: true, modifier: 'Shift' }, // 'Shift' | 'Alt' | 'Control' | 'none'
  selection: { enabled: true, showIcon: true },
  // A leading "/xx " (e.g. "/ja ") overrides targetLang for that one translation.
  input: { enabled: true, trigger: 'triple-space', targetLang: 'en', prefixOverride: true },
  floatBall: { enabled: true, side: 'right', topRatio: 0.6 },

  siteRules: {
    always: [], // host patterns to auto-translate on load
    never: [], // host patterns where DualLens stays dormant
    custom: [], // [{ match, include, exclude, style }] — CSS selectors, user-authored
  },
  autoTranslateLangs: [], // page languages that trigger auto-translate everywhere

  cache: { enabled: true, maxEntries: 50000, ttlDays: 30 },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep merge where arrays and scalars from `patch` replace those in `base`.
export function mergeSettings(base, patch) {
  if (!isPlainObject(patch)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : structuredClone(v);
  }
  return out;
}

// Also used for plaintext exports. Never mutate a caller's settings.
export function publicSettings(value) {
  if (Array.isArray(value)) return value.map(publicSettings);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/^(secrets|apiKey|api_key|token|password|authorization|proxy_token|__proto__|constructor|prototype)$/i.test(key)) continue;
    out[key] = publicSettings(val);
  }
  return out;
}

export function providerChain(settings) {
  const { profiles = [], chain = [] } = settings.provider || {};
  const selected = chain.length ? chain : (() => {
    const p = activeProfile(settings);
    return p ? [p.model, ...(p.fallbackModels || [])].map(model => ({ profileId: p.id, model })) : [];
  })();
  const seen = new Set();
  return selected.flatMap(entry => {
    const profile = profiles.find(p => p.id === entry.profileId);
    const model = entry.model;
    const key = JSON.stringify([entry.profileId, model]);
    if (!profile || typeof model !== 'string' || !model.trim() || seen.has(key)) return [];
    // Subscription tools are explicit-only, including when settings came from an older caller.
    if (/^(claude|codex)\//.test(selected[0]?.model || '') && entry !== selected[0]) return [];
    if (entry !== selected[0] && /^(claude|codex)\//.test(model)) return [];
    seen.add(key);
    return [{ profile, model }];
  });
}

function splitSettings(settings) {
  const { glossary, siteRules, autoTranslateLangs, ...core } = settings;
  return { 'settings.core': core, 'settings.glossary': glossary,
    'settings.sites': { siteRules, autoTranslateLangs } };
}
function combine(items) {
  return mergeSettings(DEFAULT_SETTINGS, { ...items['settings.core'],
    glossary: items['settings.glossary'] || [], ...items['settings.sites'] });
}
function fitsSync(items) {
  const bytes = Object.entries(items).map(([key, value]) => new TextEncoder().encode(key + JSON.stringify(value)).length);
  return bytes.every(n => n <= 8192) && bytes.reduce((a, b) => a + b, 0) <= 102400;
}
function safeId(id) {
  if (typeof id !== 'string' || !id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('接口标识无效');
  return id;
}
function mirrorDigest(value) {
  // Chrome storage may reorder object keys. Hash a canonical representation, not insertion order.
  const canonical = v => Array.isArray(v) ? v.map(canonical) : isPlainObject(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return sha256Hex(JSON.stringify(canonical(value)));
}

export function createSettingsStore({ syncArea, localArea }) {
  if (!localArea) throw new Error('需要本机设置存储');
  let serial = Promise.resolve();
  let status = { synced: false, reason: 'unavailable' };
  const exclusive = fn => {
    const next = serial.then(fn, fn);
    serial = next.catch(() => {});
    return next;
  };
  async function persist(input, legacySecrets = {}) {
    const settings = publicSettings(mergeSettings(DEFAULT_SETTINGS, input));
    settings.version = SETTINGS_VERSION;
    for (const p of settings.provider.profiles) {
      safeId(p.id);
      if (p.baseUrl) {
        const u = new URL(p.baseUrl);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('接口地址不能包含凭据或查询参数');
      }
    }
    if (settings.provider.chain.length) {
      const head = settings.provider.chain[0];
      const primary = settings.provider.profiles.find(p => p.id === head.profileId);
      if (!primary || typeof head.model !== 'string' || !head.model.trim()) throw new Error('备选链的首个接口或模型无效');
      settings.provider.active = primary.id;
      primary.model = head.model;
    }
    if (Object.keys(legacySecrets).length) {
      const got = await localArea.get(SECRETS_KEY);
      // Existing v2 keys win on re-migration; an old mirror cannot overwrite a newer secret.
      await localArea.set({ [SECRETS_KEY]: { ...legacySecrets, ...(got[SECRETS_KEY] || {}) } });
    }
    const split = splitSettings(settings);
    status = { synced: false, reason: fitsSync(split) ? 'unavailable' : 'quota' };
    if (syncArea && syncArea !== localArea && fitsSync(split)) {
      try { await syncArea.set(split); status = { synced: true, reason: null }; }
      catch { status.reason = 'quota-or-unavailable'; }
    }
    // The mode marker is device-local. Keep the last valid sync config for other devices.
    const meta = { ...status, mirrorHash: await mirrorDigest(settings) };
    await localArea.set({ ...split, [SETTINGS_KEY]: settings, [STORAGE_KEY]: meta });
    return settings;
  }
  async function read() {
    const got = await localArea.get([...SETTINGS_KEYS, SETTINGS_KEY, STORAGE_KEY]);
    const meta = got[STORAGE_KEY];
    const legacy = got[SETTINGS_KEY];
    // Local v1 and old callers writing the compatibility key are migrated once, idempotently.
    if (legacy && (!meta || await mirrorDigest(legacy) !== meta.mirrorHash)) {
      const secrets = {};
      for (const p of legacy.provider?.profiles || []) if (p.apiKey) secrets[safeId(p.id)] = { apiKey: String(p.apiKey) };
      return persist(legacy, secrets);
    }
    status = meta ? { synced: meta.synced, reason: meta.reason } : { synced: false, reason: 'unavailable' };
    if (syncArea && syncArea !== localArea && (!meta || meta.synced)) {
      try {
        const synced = await syncArea.get(SETTINGS_KEYS);
        if (synced['settings.core']) {
          status = { synced: true, reason: null };
          return publicSettings(combine(synced));
        }
        status = { synced: false, reason: 'unavailable' };
      } catch { status = { synced: false, reason: 'unavailable' }; }
    }
    return publicSettings(got['settings.core'] ? combine(got) : structuredClone(DEFAULT_SETTINGS));
  }
  const store = {
    load: () => exclusive(read),
    save: patch => exclusive(async () => {
      const current = await read();
      const next = mergeSettings(current, publicSettings(patch));
      // Preserve legacy profile switching semantics when no explicit v2 chain was supplied.
      if (patch?.provider && !Object.hasOwn(patch.provider, 'chain') &&
          (Object.hasOwn(patch.provider, 'active') || Object.hasOwn(patch.provider, 'profiles'))) next.provider.chain = [];
      const secrets = {};
      for (const p of patch?.provider?.profiles || []) if (Object.hasOwn(p, 'apiKey')) {
        const got = await localArea.get(SECRETS_KEY);
        secrets[safeId(p.id)] = { apiKey: String(p.apiKey || '') };
        await localArea.set({ [SECRETS_KEY]: { ...(got[SECRETS_KEY] || {}), ...secrets } });
      }
      return persist(next);
    }),
    getSecret: id => exclusive(async () => {
      safeId(id);
      await read();
      return (await localArea.get(SECRETS_KEY))[SECRETS_KEY]?.[id]?.apiKey || '';
    }),
    setSecret: (id, key) => exclusive(async () => {
      safeId(id);
      const got = await localArea.get(SECRETS_KEY);
      const secrets = { ...(got[SECRETS_KEY] || {}) };
      // An empty-key tombstone prevents an old v1 snapshot from resurrecting a cleared key.
      secrets[id] = { apiKey: String(key || '') };
      await localArea.set({ [SECRETS_KEY]: secrets });
    }),
    onChange(cb) {
      const listener = changes => {
        if (Object.keys(changes).some(k => [...SETTINGS_KEYS, SETTINGS_KEY, STORAGE_KEY, SECRETS_KEY].includes(k))) cb();
      };
      const off = [localArea.onChanged?.(listener), syncArea !== localArea && syncArea?.onChanged?.(listener)];
      return () => off.forEach(fn => { if (typeof fn === 'function') fn(); });
    },
    get syncStatus() { return { ...status }; },
  };
  return store;
}

let defaultStore, defaultStorage;
export function getDefaultSettingsStore() {
  const storage = globalThis.chrome?.storage;
  if (!storage?.local) throw new Error('默认扩展存储不可用，请传入 SettingsStore');
  if (defaultStorage !== storage) {
    defaultStorage = storage;
    defaultStore = createSettingsStore({ localArea: chromeStorageArea(storage.local, 'local', storage.onChanged),
      syncArea: storage.sync && chromeStorageArea(storage.sync, 'sync', storage.onChanged) });
  }
  return defaultStore;
}
export async function loadSettings() { return getDefaultSettingsStore().load(); }
export async function saveSettings(patch) { return getDefaultSettingsStore().save(patch); }

export function activeProfile(settings) {
  const { active, profiles } = settings.provider;
  if (!active) return undefined;
  return profiles.find((p) => p.id === active) || profiles[0];
}

// Host pattern: exact host, or "*.example.com" for the domain and its subdomains.
export function hostMatches(pattern, host) {
  const p = String(pattern).trim().toLowerCase();
  const h = String(host).toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  return h === p;
}

// Returns { mode: 'always' | 'never' | null, custom: rule | null } for a host.
export function siteRuleFor(settings, host) {
  const { always, never, custom } = settings.siteRules;
  const mode = never.some((p) => hostMatches(p, host))
    ? 'never'
    : always.some((p) => hostMatches(p, host))
      ? 'always'
      : null;
  const rule = custom.find((r) => hostMatches(r.match, host)) || null;
  return { mode, custom: rule };
}

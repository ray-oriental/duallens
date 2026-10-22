import { t as l10n } from './i18n.js';
// Settings schema, defaults and storage helpers.
// v3 contract: docs/PLATFORMS.md §3. Credentials stay in localArea only.
import { chromeStorageArea } from './storage-areas.js';
import { sha256Hex } from './hash.js';
import { parsePattern, patternMatches, comparePatterns } from './site-pattern.js';

export const SETTINGS_KEY = 'settings';
export const SETTINGS_VERSION = 3;
export const SETTINGS_KEYS = ['settings.core', 'settings.glossary', 'settings.sites'];
export const SECRETS_KEY = 'secrets';
const STORAGE_KEY = 'settings.storage';

export const LANGS = Object.freeze([
  { code: 'zh-CN', get name(){return l10n('m8r');} },
  { code: 'zh-TW', get name(){return l10n('m8s');} },
  { code: 'en', name: 'English' },
  { code: 'ja', get name(){return l10n('m8t');} },
  { code: 'ko', get name(){return l10n('languageKo');} },
  { code: 'fr', get name(){return l10n('languageFr');} },
  { code: 'de', get name(){return l10n('languageDe');} },
  { code: 'es', get name(){return l10n('languageEs');} },
  { code: 'ru', get name(){return l10n('languageRu');} },
  { code: 'pt', get name(){return l10n('languagePt');} },
  { code: 'it', get name(){return l10n('languageIt');} },
  { code: 'ar', get name(){return l10n('languageAr');} },
  { code: 'vi', get name(){return l10n('languageVi');} },
  { code: 'th', get name(){return l10n('languageTh');} },
]);

// Match the browser UI language once for fresh settings; persisted choices always win.
export function defaultTargetLanguage(language = globalThis.navigator?.language) {
  const tag = String(language || '').toLowerCase().replace(/_/g, '-');
  const exact = LANGS.find(l => l.code.toLowerCase() === tag);
  if (exact) return exact.code;
  if (/^zh(?:-|$)/.test(tag)) return /(?:tw|hk|mo|hant)/.test(tag) ? 'zh-TW' : 'zh-CN';
  return LANGS.find(l => l.code.toLowerCase() === tag.split('-')[0])?.code || 'zh-CN';
}

// Visual styles for inserted translations; CSS lives in styles/content.css as .dl-s-<id>.
export const STYLES = Object.freeze([
  { id: 'muted', get name() { return l10n('m8u'); }, legacyIds: ['italic', 'bold'] },
  { id: 'plain', get name() { return l10n('m8v'); } },
  { id: 'dashed', get name() { return l10n('m8w'); }, legacyIds: ['underline', 'dotted', 'wavy'] },
  { id: 'highlight', get name() { return l10n('m8x'); }, legacyIds: ['marker', 'card'] },
  { id: 'blur', get name() { return l10n('m8y'); }, legacyIds: ['mask'] },
  { id: 'quote', get name() { return l10n('m8z'); }, legacyIds: ['divider'] },
]);

export const PROMPT_PRESETS = Object.freeze(['general', 'tech', 'academic', 'news', 'social', 'custom']);

// translation.mode (SPEC §8.1). The default needs no key: with no usable LLM it behaves as 'mt'.
export const TRANSLATION_MODES = Object.freeze([
  { id: 'mt+llm', get name() { return l10n('m90'); } },
  { id: 'mt', get name() { return l10n('m91'); } },
  { id: 'llm', get name() { return l10n('m92'); } },
  { id: 'auto', get name() { return l10n('m93'); } },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  uiLanguage: 'zh-CN',
  targetLang: defaultTargetLanguage(),
  sourceLang: 'auto',
  displayMode: 'bilingual', // 'bilingual' | 'translation-only'
  style: 'muted',
  minChars: 2,
  translateShortText: true,
  inlineMaxChars: 24, // units shorter than this get the inline layout
  lazy: { rootMarginPx: 600, batchDelayMs: 80 },
  comics: { enabled:false, language: 'jpn', canvasSites:['*.pixiv.net'], visionEnabled: false },
  subtitles: { enabled: false, mode: 'bilingual', fontSize: 22, position: 'bottom' },
  // Double-engine translation: machine translation (MT) shows a draft at once, the LLM refines it.
  // mt.engine: microsoft | google (free, unofficial) | microsoft-api | deepl (keyed) | mock (tests).
  // refineTimeoutMs: after this long without an LLM result the machine translation becomes the result.
  translation: { mode: 'mt+llm', refineTimeoutMs: 90000, mt: { engine: 'microsoft', fallback: true, region: '' } },

  provider: {
    active: '',
    chain: [],
    profiles: [
      {
        id: 'openai',
        kind: 'openai', // any OpenAI-compatible endpoint the user supplies
        get name(){return l10n('m8o');},
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
        get name(){return l10n('m94');},
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

  hover: { enabled: false, modifier: 'Shift', profileId: '', model: '' }, // empty = inherit page
  selection: { enabled: false, showIcon: true },
  // A leading "/xx " (e.g. "/ja ") overrides targetLang for that one translation.
  input: { enabled: false, trigger: 'triple-space', targetLang: 'en', prefixOverride: true,
    mode: 'replace', order: 'source-first', profileId: '', model: '' },
  floatBall: { autoHide: true, enabled: false, side: 'right', topRatio: 0.6 },

  siteRules: {
    always: [], // host patterns to auto-translate on load
    never: [], // patterns blocking automatic page translation and the floating button
    custom: [], // [{ match, page?, selection?, hover?, input?, include?, exclude?, style? }]
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

// Shared by extension storage, GM storage and configuration import. Never mutate input.
export function migrateSettings(input) {
  const s = mergeSettings(DEFAULT_SETTINGS, input);
  for (const p of s.provider.profiles) if (p.kind === 'gateway') p.kind = 'openai';
  if ((input?.version ?? 1) < 3) {
    for (const feature of ['floatBall', 'selection', 'hover', 'input', 'comics']) s[feature].enabled = false;
  }
  s.version = SETTINGS_VERSION;
  return s;
}

// Also used for plaintext exports. Never mutate a caller's settings.
export function publicSettings(value) {
  if (Array.isArray(value)) return value.map(publicSettings);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/^(ui(?:\..*)?|secrets|apiKey|api_key|pairingToken|remote_token|token|password|authorization|proxy_token|__proto__|constructor|prototype)$/i.test(key)) continue;
    out[key] = publicSettings(val);
  }
  return out;
}

export function providerChain(s) {
  const { profiles = [], chain = [] } = s.provider || {};
  const selected = chain.length ? chain : (() => {
    const p = activeProfile(s);
    return p ? [p.model, ...(p.fallbackModels || [])].map(model => ({ profileId: p.id, model })) : [];
  })();
  const seen = new Set();
  return selected.flatMap(entry => {
    const profile = profiles.find(p => p.id === entry.profileId);
    const model = entry.model;
    const key = JSON.stringify([entry.profileId, model]);
    if (!profile || typeof model !== 'string' || !model.trim() || seen.has(key)) return [];
    seen.add(key);
    return [{ profile, model }];
  });
}

function splitSettings(s) {
  const { glossary, siteRules, autoTranslateLangs, ...core } = s;
  return { 'settings.core': core, 'settings.glossary': glossary,
    'settings.sites': { siteRules, autoTranslateLangs } };
}
function combine(items) {
  return mergeSettings(DEFAULT_SETTINGS, { ...items['settings.core'],
    version: items['settings.core']?.version ?? 1,
    glossary: items['settings.glossary'] || [], ...items['settings.sites'] });
}
function fitsSync(items) {
  const bytes = Object.entries(items).map(([key, value]) => new TextEncoder().encode(key + JSON.stringify(value)).length);
  return bytes.every(n => n <= 8192) && bytes.reduce((a, b) => a + b, 0) <= 102400;
}
function safeId(id) {
  if (typeof id !== 'string' || !id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error(l10n('m95'));
  return id;
}
function mirrorDigest(value) {
  // Chrome storage may reorder object keys. Hash a canonical representation, not insertion order.
  const canonical = v => Array.isArray(v) ? v.map(canonical) : isPlainObject(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return sha256Hex(JSON.stringify(canonical(value)));
}

export function createSettingsStore({ syncArea, localArea, browserLanguage }) {
  if (!localArea) throw new Error(l10n('m96'));
  let serial = Promise.resolve();
  let status = { synced: false, reason: 'unavailable' };
  const exclusive = fn => {
    const next = serial.then(fn, fn);
    serial = next.catch(() => {});
    return next;
  };
  async function persist(input, legacySecrets = {}, preserveProvider = false) {
    preserveProvider ||= (input?.version ?? 1) < SETTINGS_VERSION;
    if (input && (input.version ?? 1) < 3 && ['floatBall','selection','hover','input','comics'].some(f => input[f]?.enabled)) {
      const state = (await localArea.get('ui.device'))['ui.device'];
      if (!state) await localArea.set({ 'ui.device': { onboarded: true, acked: [], upgradeNoticeSeen: false } });
    }
    const s = publicSettings(migrateSettings(input));
    s.version = SETTINGS_VERSION;
    if (!['zh-CN','en','auto'].includes(s.uiLanguage)) throw new Error(l10n('uiLanguageInvalid'));
    validateSiteRules(s.siteRules);
    validateInteractionSettings(s);
    for (const p of s.provider.profiles) {
      safeId(p.id);
      if (p.baseUrl) {
        const u = new URL(p.baseUrl);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(l10n('m1d'));
      }
    }
    if (s.provider.chain.length) {
      const head = s.provider.chain[0];
      const primary = s.provider.profiles.find(p => p.id === head.profileId);
      if (!primary || typeof head.model !== 'string' || !head.model.trim()) throw new Error(l10n('m97'));
      if (!preserveProvider) {
        s.provider.active = primary.id;
        primary.model = head.model;
      }
    }
    if (Object.keys(legacySecrets).length) {
      const got = await localArea.get(SECRETS_KEY);
      // Existing v2 keys win on re-migration; an old mirror cannot overwrite a newer secret.
      await localArea.set({ [SECRETS_KEY]: { ...legacySecrets, ...(got[SECRETS_KEY] || {}) } });
    }
    const split = splitSettings(s);
    status = { synced: false, reason: fitsSync(split) ? 'unavailable' : 'quota' };
    if (syncArea && syncArea !== localArea && fitsSync(split)) {
      try { await syncArea.set(split); status = { synced: true, reason: null }; }
      catch { status.reason = 'quota-or-unavailable'; }
    }
    // The mode marker is device-local. Keep the last valid sync config for other devices.
    const meta = { ...status, mirrorHash: await mirrorDigest(s) };
    await localArea.set({ ...split, [SETTINGS_KEY]: s, [STORAGE_KEY]: meta });
    return s;
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
          const combined = combine(synced);
          return combined.version < SETTINGS_VERSION ? persist(combined) : publicSettings(combined);
        }
        status = { synced: false, reason: 'unavailable' };
      } catch { status = { synced: false, reason: 'unavailable' }; }
    }
    const combined = got['settings.core'] ? combine(got) : {...structuredClone(DEFAULT_SETTINGS),targetLang:defaultTargetLanguage(browserLanguage)};
    return combined.version < SETTINGS_VERSION ? persist(combined) : publicSettings(combined);
  }
  const store = {
    load: () => exclusive(read),
    save: (patch, { preserveProvider = false } = {}) => exclusive(async () => {
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
      return persist(next, {}, preserveProvider);
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
  if (!storage?.local) throw new Error(l10n('m98'));
  if (defaultStorage !== storage) {
    defaultStorage = storage;
    defaultStore = createSettingsStore({ browserLanguage:globalThis.chrome?.i18n?.getUILanguage?.(),localArea: chromeStorageArea(storage.local, 'local', storage.onChanged),
      syncArea: storage.sync && chromeStorageArea(storage.sync, 'sync', storage.onChanged) });
  }
  return defaultStore;
}
export async function loadSettings() { return getDefaultSettingsStore().load(); }
export async function saveSettings(patch) { return getDefaultSettingsStore().save(patch); }

export function activeProfile(s) {
  const { active, profiles } = s.provider;
  if (!active) return undefined;
  return profiles.find((p) => p.id === active) || profiles[0];
}

// Legacy name retained; accepts URL patterns as well as plain hostnames.
export function hostMatches(pattern, host) {
  return patternMatches(pattern, host);
}

// Returns { mode: 'always' | 'never' | null, custom: rule | null } for a URL or host.
export function siteRuleFor(s, url) {
  const { always = [], never = [], custom = [] } = s.siteRules || {};
  const best = entries => entries.filter(r => patternMatches(r.match, url))
    .sort((a, b) => comparePatterns(b.match, a.match))[0] || null;
  const rule = best(custom);
  const modeRule = best([
    ...custom.filter(r => r.page != null),
    ...never.map(match => ({ match, page: 'never' })),
    ...always.map(match => ({ match, page: 'always' })),
  ]);
  return { mode: modeRule?.page === 'default' ? null : modeRule?.page || null, custom: rule };
}

// Runtime view only: global preferences and stored rules stay untouched. The selected CSS rule
// is bound to the current host for legacy controller callers that still pass just a hostname.
export function settingsForSite(s, url) {
  const { mode, custom } = siteRuleFor(s, url);
  const out = { ...s, floatBall: { ...s.floatBall, enabled: mode !== 'never' && s.floatBall.enabled },
    siteRules: { ...s.siteRules, custom: custom ? [{ ...custom, match: new URL(url).hostname }] : [] } };
  for (const feature of ['selection', 'hover', 'input']) {
    const value = custom?.[feature];
    out[feature] = { ...s[feature], enabled: value === 'on' ? true : value === 'off' ? false : s[feature].enabled };
  }
  return out;
}

export function setSitePageRule(s, match, mode) {
  const rules = structuredClone(s.siteRules);
  const same = p => JSON.stringify(parsePattern(p)) === JSON.stringify(parsePattern(match));
  for (const key of ['always', 'never']) rules[key] = rules[key].filter(p => !same(p));
  const found = rules.custom.find(r => same(r.match));
  if (found) found.page = mode || 'default';
  else rules.custom.push({ match, page: mode || 'default' });
  return rules;
}

export function validateSiteRules(rules) {
  if (!rules || !['always', 'never', 'custom'].every(k => Array.isArray(rules[k]))) throw new Error(l10n('m99'));
  const valid = p => { if (!parsePattern(p)) throw new Error(l10n('m9a')); };
  rules.always.forEach(valid); rules.never.forEach(valid);
  for (const r of rules.custom) {
    if (!r || typeof r !== 'object') throw new Error(l10n('m9b'));
    valid(r.match);
    if (r.page != null && !['always', 'never', 'default'].includes(r.page)) throw new Error(l10n('m9c'));
    for (const f of ['selection', 'hover', 'input']) if (r[f] != null && !['on', 'off', 'default'].includes(r[f])) throw new Error(l10n('m9d'));
  }
}

export function validateInteractionSettings(s) {
  if (typeof s.floatBall?.autoHide !== 'boolean') throw new Error(l10n('m9e'));
  if (!['replace', 'bilingual'].includes(s.input?.mode) ||
      !['source-first', 'translation-first'].includes(s.input?.order)) throw new Error(l10n('m9f'));
  for (const name of ['hover', 'input']) {
    const c = s[name];
    if (typeof c?.profileId !== 'string' || typeof c.model !== 'string' ||
        c.model.length > 256 || /[\x00-\x1f\x7f]/.test(c.model) ||
        c.profileId && !s.provider?.profiles?.some(p => p.id === c.profileId)) throw new Error(l10n('m9g'));
  }
}

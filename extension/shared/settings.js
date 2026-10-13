// Settings schema, defaults and storage helpers.
// Owned by leader; see docs/SPEC.md §3. Every reader goes through loadSettings().

export const SETTINGS_KEY = 'settings';
export const SETTINGS_VERSION = 1;

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

  provider: {
    active: 'openai',
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
        apiKey: '', // stays in chrome.storage.local; never exported
        model: '',
        fallbackModels: [],
        jsonMode: true,
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
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : structuredClone(v);
  }
  return out;
}

export async function loadSettings() {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(DEFAULT_SETTINGS, got[SETTINGS_KEY] || {});
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = mergeSettings(current, patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function activeProfile(settings) {
  const { active, profiles } = settings.provider;
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

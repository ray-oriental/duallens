import { DEFAULT_SETTINGS, LANGS, STYLES, PROMPT_PRESETS, TRANSLATION_MODES, mergeSettings, publicSettings, SETTINGS_VERSION, migrateSettings, validateSiteRules, validateInteractionSettings } from '../shared/settings.js';
import { isMtEngine } from '../background/mt.js';
import { comicSites } from '../content/comics/sites.js';

// User-visible copy is centralized for the next localization pass.
const COPY=Object.freeze({s0:"术语表每行使用 原词 → 译词",s1:"漫画开关或源语言无效",s2:"字幕设置无效",s3:"翻译方式或机器翻译设置无效",s4:"请选择有效的源语言和目标语言",s5:"显示模式无效",s6:"翻译短文本开关无效",s7:"译文样式无效",s8:"提示词设置无效",s9:"最短段落",s10:"行内阈值",s11:"预加载距离",s12:"合批等待",s13:"缓存条数",s14:"缓存天数",s15:"术语表最多500项，每项须包含原词和译词",s16:"悬停快捷键无效",s17:"输入框设置无效",s18:"悬浮球位置无效",s19:"开关设置无效",s20:"自动翻译语言无效",s21:"自定义规则须是JSON数组",s22:"include/exclude 须是选择器字符串或字符串数组",s23:"自定义规则样式无效",s24:"活动接口无效",s25:"接口标识重复或类型无效",s26:"接口名称或模型无效",s27:"接口地址无效",s28:"接口须使用不含凭据或查询参数的HTTP(S)地址",s29:"JSON模式无效",s30:"备选模型须为非空字符串",s31:"批量段数",s32:"批量字符",s33:"并发数",s34:"超时",s35:"备选链须为数组",s36:"备选链的接口或模型无效",s37:"设置文件须是JSON对象"});
const badKeys = new Set(['__proto__', 'constructor', 'prototype']);
export function safeExport(value) {
  return publicSettings(value);
}
function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function lines(text) { return String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
export function terms(text) {
  return lines(text).map((line) => {
    const parts = line.split(/\t|\s*=>\s*|\s*→\s*/);
    requireThat(parts.length === 2 && parts[0].trim() && parts[1].trim(), COPY.s0);
    return { src:parts[0].trim(), dst:parts[1].trim() };
  });
}
export function validateSettings(s) {
  validateInteractionSettings(s);
  requireThat(typeof s.comics?.enabled==='boolean' && ['jpn','jpn_vert','kor','eng'].includes(s.comics.language),COPY.s1);
  s.comics.canvasSites=comicSites(s.comics.canvasSites);
  requireThat(typeof s.subtitles?.enabled === 'boolean' && ['bilingual', 'translation-only'].includes(s.subtitles.mode) &&
    Number.isInteger(s.subtitles.fontSize) && s.subtitles.fontSize >= 16 && s.subtitles.fontSize <= 48 &&
    ['top', 'bottom'].includes(s.subtitles.position), COPY.s2);
  const tr = s.translation;
  requireThat(TRANSLATION_MODES.some(m => m.id === tr?.mode) && isMtEngine(tr?.mt?.engine) && typeof tr.mt.fallback === 'boolean' &&
    Number.isInteger(tr.refineTimeoutMs) && tr.refineTimeoutMs >= 1000 && tr.refineTimeoutMs <= 600000 &&
    typeof tr.mt.region === 'string' && /^[A-Za-z0-9-]{0,40}$/.test(tr.mt.region), COPY.s3);
  const lang = code => LANGS.some(l => l.code === code);
  requireThat(lang(s.targetLang) && (s.sourceLang === 'auto' || lang(s.sourceLang)), COPY.s4);
  requireThat(['bilingual','translation-only'].includes(s.displayMode), COPY.s5);
  requireThat(typeof s.translateShortText === 'boolean', COPY.s6);
  requireThat(STYLES.some(v => v.id === s.style), COPY.s7);
  requireThat(PROMPT_PRESETS.includes(s.prompt.preset) && typeof s.prompt.custom === 'string', COPY.s8);
  for (const [v, lo, hi, name] of [[s.minChars,2,1000,COPY.s9],[s.inlineMaxChars,0,500,COPY.s10],[s.lazy.rootMarginPx,0,3000,COPY.s11],[s.lazy.batchDelayMs,10,2000,COPY.s12],[s.cache.maxEntries,100,100000,COPY.s13],[s.cache.ttlDays,1,365,COPY.s14]]) {
    requireThat(Number.isInteger(v) && v >= lo && v <= hi, `${name}需在 ${lo}–${hi} 范围内`);
  }
  requireThat(Array.isArray(s.glossary) && s.glossary.length <= 500 && s.glossary.every(t => t && typeof t.src==='string' && typeof t.dst==='string' && t.src.trim() && t.dst.trim()), COPY.s15);
  requireThat(['Shift','Alt','Control','none'].includes(s.hover.modifier), COPY.s16);
  requireThat(lang(s.input.targetLang) && ['triple-space','shortcut'].includes(s.input.trigger), COPY.s17);
  requireThat(['left','right'].includes(s.floatBall.side) && Number.isFinite(s.floatBall.topRatio) && s.floatBall.topRatio>=0 && s.floatBall.topRatio<=1, COPY.s18);
  for (const field of [s.hover.enabled,s.selection.enabled,s.selection.showIcon,s.input.enabled,s.input.prefixOverride,s.floatBall.enabled,s.cache.enabled]) requireThat(typeof field==='boolean', COPY.s19);
  validateSiteRules(s.siteRules);
  requireThat(Array.isArray(s.autoTranslateLangs) && s.autoTranslateLangs.every(lang), COPY.s20);
  requireThat(Array.isArray(s.siteRules.custom), COPY.s21);
  for (const r of s.siteRules.custom) {
    for (const k of ['include','exclude']) if (r[k] != null) requireThat(typeof r[k]==='string' || (Array.isArray(r[k]) && r[k].every(x=>typeof x==='string')), COPY.s22);
    if (r.style != null) requireThat(STYLES.some(x=>x.id===r.style), COPY.s23);
  }
  requireThat(Array.isArray(s.provider.profiles) && s.provider.profiles.length>0 &&
    (s.provider.active === '' || s.provider.profiles.some(p=>p.id===s.provider.active)), COPY.s24);
  const seen = new Set();
  for (const p of s.provider.profiles) {
    requireThat(p && typeof p.id==='string' && !badKeys.has(p.id) && !seen.has(p.id) && ['openai','mock'].includes(p.kind), COPY.s25); seen.add(p.id);
    requireThat(typeof p.name==='string' && typeof p.model==='string', COPY.s26);
    if (p.kind !== 'mock') {
      requireThat(typeof p.baseUrl==='string', COPY.s27);
      if (p.baseUrl) { const u = new URL(p.baseUrl); requireThat(['http:','https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash, COPY.s28); }
      requireThat(p.jsonMode == null || typeof p.jsonMode==='boolean', COPY.s29);
    }
    requireThat(Array.isArray(p.fallbackModels) && p.fallbackModels.every(m=>typeof m==='string' && m.trim()), COPY.s30);
    for (const [v, lo, hi, name] of [[p.maxItems,1,50,COPY.s31],[p.maxChars,100,12000,COPY.s32],[p.concurrency,1,6,COPY.s33],[p.timeoutMs,1000,300000,COPY.s34]]) requireThat(Number.isInteger(v) && v>=lo && v<=hi, `${name}设置无效`);
  }
  requireThat(Array.isArray(s.provider.chain), COPY.s35);
  for (const [i, c] of s.provider.chain.entries()) {
    requireThat(c && seen.has(c.profileId) && typeof c.model === 'string' && c.model.trim(), COPY.s36);
  }
  return s;
}
function cleanLike(value, shape) {
  if (Array.isArray(shape)) return Array.isArray(value) ? safeExport(value) : structuredClone(shape);
  if (shape && typeof shape==='object') {
    const out={};
    for (const key of Object.keys(shape)) if (!badKeys.has(key)) out[key]=value && Object.hasOwn(value,key) ? cleanLike(value[key],shape[key]) : structuredClone(shape[key]);
    return out;
  }
  return value ?? shape;
}
export function importSettings(data, current) {
  requireThat(data && typeof data==='object' && !Array.isArray(data), COPY.s37);
  const migrated = migrateSettings(safeExport(data));
  const next=cleanLike(migrated, DEFAULT_SETTINGS);
  const incoming = Array.isArray(data.provider?.profiles) ? migrated.provider.profiles : current.provider.profiles;
  next.provider.profiles = incoming.map(imported => {
    const shape = { ...DEFAULT_SETTINGS.provider.profiles.find(p => p.kind === 'openai'), preset: '', requiresKey: false };
    return cleanLike(safeExport(imported), shape);
  });
  next.version = SETTINGS_VERSION;
  return validateSettings(mergeSettings(DEFAULT_SETTINGS,next));
}

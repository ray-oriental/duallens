import { DEFAULT_SETTINGS, LANGS, STYLES, PROMPT_PRESETS, TRANSLATION_MODES, mergeSettings, publicSettings, SETTINGS_VERSION, migrateSettings, validateSiteRules, validateInteractionSettings } from '../shared/settings.js';
import { isMtEngine } from '../background/mt.js';
import { comicSites } from '../content/comics/sites.js';
const badKeys = new Set(['__proto__', 'constructor', 'prototype']);
export function safeExport(value) {
  return publicSettings(value);
}
function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function lines(text) { return String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
export function terms(text) {
  return lines(text).map((line) => {
    const parts = line.split(/\t|\s*=>\s*|\s*→\s*/);
    requireThat(parts.length === 2 && parts[0].trim() && parts[1].trim(), '术语表每行使用 原词 → 译词');
    return { src:parts[0].trim(), dst:parts[1].trim() };
  });
}
export function validateSettings(s) {
  validateInteractionSettings(s);
  requireThat(typeof s.comics?.enabled==='boolean' && ['jpn','jpn_vert','kor','eng'].includes(s.comics.language),'漫画开关或源语言无效');
  s.comics.canvasSites=comicSites(s.comics.canvasSites);
  requireThat(typeof s.subtitles?.enabled === 'boolean' && ['bilingual', 'translation-only'].includes(s.subtitles.mode) &&
    Number.isInteger(s.subtitles.fontSize) && s.subtitles.fontSize >= 16 && s.subtitles.fontSize <= 48 &&
    ['top', 'bottom'].includes(s.subtitles.position), '字幕设置无效');
  const tr = s.translation;
  requireThat(TRANSLATION_MODES.some(m => m.id === tr?.mode) && isMtEngine(tr?.mt?.engine) && typeof tr.mt.fallback === 'boolean' &&
    Number.isInteger(tr.refineTimeoutMs) && tr.refineTimeoutMs >= 1000 && tr.refineTimeoutMs <= 600000 &&
    typeof tr.mt.region === 'string' && /^[A-Za-z0-9-]{0,40}$/.test(tr.mt.region), '翻译方式或机器翻译设置无效');
  const lang = code => LANGS.some(l => l.code === code);
  requireThat(lang(s.targetLang) && (s.sourceLang === 'auto' || lang(s.sourceLang)), '请选择有效的源语言和目标语言');
  requireThat(['bilingual','translation-only'].includes(s.displayMode), '显示模式无效');
  requireThat(typeof s.translateShortText === 'boolean', '翻译短文本开关无效');
  requireThat(STYLES.some(v => v.id === s.style), '译文样式无效');
  requireThat(PROMPT_PRESETS.includes(s.prompt.preset) && typeof s.prompt.custom === 'string', '提示词设置无效');
  for (const [v, lo, hi, name] of [[s.minChars,2,1000,'最短段落'],[s.inlineMaxChars,0,500,'行内阈值'],[s.lazy.rootMarginPx,0,3000,'预加载距离'],[s.lazy.batchDelayMs,10,2000,'合批等待'],[s.cache.maxEntries,100,100000,'缓存条数'],[s.cache.ttlDays,1,365,'缓存天数']]) {
    requireThat(Number.isInteger(v) && v >= lo && v <= hi, `${name}需在 ${lo}–${hi} 范围内`);
  }
  requireThat(Array.isArray(s.glossary) && s.glossary.length <= 500 && s.glossary.every(t => t && typeof t.src==='string' && typeof t.dst==='string' && t.src.trim() && t.dst.trim()), '术语表最多500项，每项须包含原词和译词');
  requireThat(['Shift','Alt','Control','none'].includes(s.hover.modifier), '悬停快捷键无效');
  requireThat(lang(s.input.targetLang) && ['triple-space','shortcut'].includes(s.input.trigger), '输入框设置无效');
  requireThat(['left','right'].includes(s.floatBall.side) && Number.isFinite(s.floatBall.topRatio) && s.floatBall.topRatio>=0 && s.floatBall.topRatio<=1, '悬浮球位置无效');
  for (const field of [s.hover.enabled,s.selection.enabled,s.selection.showIcon,s.input.enabled,s.input.prefixOverride,s.floatBall.enabled,s.cache.enabled]) requireThat(typeof field==='boolean', '开关设置无效');
  validateSiteRules(s.siteRules);
  requireThat(Array.isArray(s.autoTranslateLangs) && s.autoTranslateLangs.every(lang), '自动翻译语言无效');
  requireThat(Array.isArray(s.siteRules.custom), '自定义规则须是JSON数组');
  for (const r of s.siteRules.custom) {
    for (const k of ['include','exclude']) if (r[k] != null) requireThat(typeof r[k]==='string' || (Array.isArray(r[k]) && r[k].every(x=>typeof x==='string')), 'include/exclude 须是选择器字符串或字符串数组');
    if (r.style != null) requireThat(STYLES.some(x=>x.id===r.style), '自定义规则样式无效');
  }
  requireThat(Array.isArray(s.provider.profiles) && s.provider.profiles.length>0 &&
    (s.provider.active === '' || s.provider.profiles.some(p=>p.id===s.provider.active)), '活动接口无效');
  const seen = new Set();
  for (const p of s.provider.profiles) {
    requireThat(p && typeof p.id==='string' && !badKeys.has(p.id) && !seen.has(p.id) && ['openai','mock'].includes(p.kind), '接口标识重复或类型无效'); seen.add(p.id);
    requireThat(typeof p.name==='string' && typeof p.model==='string', '接口名称或模型无效');
    if (p.kind !== 'mock') {
      requireThat(typeof p.baseUrl==='string', '接口地址无效');
      if (p.baseUrl) { const u = new URL(p.baseUrl); requireThat(['http:','https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash, '接口须使用不含凭据或查询参数的HTTP(S)地址'); }
      requireThat(p.jsonMode == null || typeof p.jsonMode==='boolean', 'JSON模式无效');
    }
    requireThat(Array.isArray(p.fallbackModels) && p.fallbackModels.every(m=>typeof m==='string' && m.trim()), '备选模型须为非空字符串');
    for (const [v, lo, hi, name] of [[p.maxItems,1,50,'批量段数'],[p.maxChars,100,12000,'批量字符'],[p.concurrency,1,6,'并发数'],[p.timeoutMs,1000,300000,'超时']]) requireThat(Number.isInteger(v) && v>=lo && v<=hi, `${name}设置无效`);
  }
  requireThat(Array.isArray(s.provider.chain), '备选链须为数组');
  for (const [i, c] of s.provider.chain.entries()) {
    requireThat(c && seen.has(c.profileId) && typeof c.model === 'string' && c.model.trim(), '备选链的接口或模型无效');
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
  requireThat(data && typeof data==='object' && !Array.isArray(data), '设置文件须是JSON对象');
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

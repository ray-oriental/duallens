import { t as l10n } from '../shared/i18n.js';
import { DEFAULT_SETTINGS, LANGS, STYLES, PROMPT_PRESETS, TRANSLATION_MODES, mergeSettings, publicSettings, SETTINGS_VERSION, migrateSettings, validateSiteRules, validateInteractionSettings } from '../shared/settings.js';
import { isMtEngine } from '../background/mt.js';
import { comicSites } from '../content/comics/sites.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({s0:l10n('mj7'),s1:l10n('mj8'),s2:l10n('mj9'),s3:l10n('mja'),s4:l10n('mjb'),s5:l10n('mjc'),s6:l10n('mjd'),s7:l10n('mje'),s8:l10n('mjf'),s9:l10n('mjg'),s10:l10n('mjh'),s11:l10n('mji'),s12:l10n('mjj'),s13:l10n('mjk'),s14:l10n('mjl'),s15:l10n('mjm'),s16:l10n('mjn'),s17:l10n('mjo'),s18:l10n('mjp'),s19:l10n('mjq'),s20:l10n('mjr'),s21:l10n('mjs'),s22:l10n('mjt'),s23:l10n('mju'),s24:l10n('mjv'),s25:l10n('mjw'),s26:l10n('mjx'),s27:l10n('mjy'),s28:l10n('mjz'),s29:l10n('mk0'),s30:l10n('mk1'),s31:l10n('mk2'),s32:l10n('mk3'),s33:l10n('mey'),s34:l10n('mk4'),s35:l10n('mk5'),s36:l10n('mk6'),s37:l10n('mk7')});
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
    requireThat(Number.isInteger(v) && v >= lo && v <= hi, l10n('mk8', [name, lo, hi]));
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
    for (const [v, lo, hi, name] of [[p.maxItems,1,50,COPY.s31],[p.maxChars,100,12000,COPY.s32],[p.concurrency,1,6,COPY.s33],[p.timeoutMs,1000,300000,COPY.s34]]) requireThat(Number.isInteger(v) && v>=lo && v<=hi, l10n('mk9', [name]));
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

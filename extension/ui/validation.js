import { t as l10n } from '../shared/i18n.js';
import { DEFAULT_SETTINGS, LANGS, STYLES, PROMPT_PRESETS, TRANSLATION_MODES, mergeSettings, publicSettings, SETTINGS_VERSION, migrateSettings, validateSiteRules, validateInteractionSettings } from '../shared/settings.js';
import { isMtEngine } from '../background/mt.js';
import { comicSites } from '../content/comics/sites.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({get s0(){return l10n('mj7');},get s1(){return l10n('mj8');},get s2(){return l10n('mj9');},get s3(){return l10n('mja');},get s4(){return l10n('mjb');},get s5(){return l10n('mjc');},get s6(){return l10n('mjd');},get s7(){return l10n('mje');},get s8(){return l10n('mjf');},get s9(){return l10n('mjg');},get s10(){return l10n('mjh');},get s11(){return l10n('mji');},get s12(){return l10n('mjj');},get s13(){return l10n('mjk');},get s14(){return l10n('mjl');},get s15(){return l10n('mjm');},get s16(){return l10n('mjn');},get s17(){return l10n('mjo');},get s18(){return l10n('mjp');},get s19(){return l10n('mjq');},get s20(){return l10n('mjr');},get s21(){return l10n('mjs');},get s22(){return l10n('mjt');},get s23(){return l10n('mju');},get s24(){return l10n('mjv');},get s25(){return l10n('mjw');},get s26(){return l10n('mjx');},get s27(){return l10n('mjy');},get s28(){return l10n('mjz');},get s29(){return l10n('mk0');},get s30(){return l10n('mk1');},get s31(){return l10n('mk2');},get s32(){return l10n('mk3');},get s33(){return l10n('mey');},get s34(){return l10n('mk4');},get s35(){return l10n('mk5');},get s36(){return l10n('mk6');},get s37(){return l10n('mk7');}});
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
  requireThat(['zh-CN','en','auto'].includes(s.uiLanguage), l10n('uiLanguageInvalid'));
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
  requireThat(!Object.hasOwn(data,'uiLanguage') || ['zh-CN','en','auto'].includes(data.uiLanguage), l10n('uiLanguageInvalid'));
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

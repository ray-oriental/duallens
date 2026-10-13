// Language-code normalisation and cheap script-based heuristics. No DOM, no chrome.* calls.

import { stripMarkup } from './markup.js';

const LEGACY = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', mo: 'ro' };
const TRAD_HINTS = new Set(['hant', 'tw', 'hk', 'mo']);

// 'zh-Hans'/'zh-cn'/'zh' -> 'zh-CN'; 'zh-Hant'/'zh-tw'/'zh-HK' -> 'zh-TW'; 'en-US' -> 'en'.
export function normalizeLang(code) {
  if (code == null) return '';
  const raw = String(code).trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return '';
  if (raw === 'auto') return 'auto';
  const parts = raw.split('-');
  let primary = parts[0];
  if (primary === 'cmn' || primary === 'yue') primary = 'zh';
  if (primary === 'zh') {
    return parts.slice(1).some((p) => TRAD_HINTS.has(p)) ? 'zh-TW' : 'zh-CN';
  }
  return LEGACY[primary] || primary;
}

export function sameLanguage(a, b) {
  const x = normalizeLang(a);
  const y = normalizeLang(b);
  return !!x && x === y;
}

// Like sameLanguage but treats every Chinese variant as one family.
export function sameLanguageFamily(a, b) {
  const x = normalizeLang(a);
  const y = normalizeLang(b);
  if (!x || !y) return false;
  return x.split('-')[0] === y.split('-')[0];
}

// Script classes by code point; 'other' for any other letter, null for non-letters.
function scriptOf(cp, ch) {
  if (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  )
    return 'han';
  if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) return 'kana';
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) return 'hangul';
  if (cp >= 0x0400 && cp <= 0x052f) return 'cyrillic';
  if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f)) return 'arabic';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) return 'latin';
  return /\p{L}/u.test(ch) ? 'other' : null;
}

const SAMPLE_LIMIT = 4000;

function countScripts(text) {
  const c = { han: 0, kana: 0, hangul: 0, cyrillic: 0, arabic: 0, thai: 0, latin: 0, other: 0, total: 0 };
  let seen = 0;
  for (const ch of String(text ?? '')) {
    if (++seen > SAMPLE_LIMIT) break;
    const s = scriptOf(ch.codePointAt(0), ch);
    if (s) {
      c[s]++;
      c.total++;
    }
  }
  return c;
}

// Share of letters that are Han, kana or Hangul (0..1); 0 when the text has no letters.
export function cjkRatio(text) {
  const c = countScripts(text);
  return c.total ? (c.han + c.kana + c.hangul) / c.total : 0;
}

const EN_STOP = new Set(
  'the and of to in is that for with are on as this it be at by from or an was not but have you your we can will if they their which has more about'.split(
    ' ',
  ),
);

function looksEnglish(text) {
  const words = String(text).toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 4) return false;
  const c = countScripts(text);
  if (c.latin / (c.total || 1) < 0.9) return false;
  let hits = 0;
  for (const w of words) if (EN_STOP.has(w)) hits++;
  return hits >= 2 && hits / words.length >= 0.15;
}

// Quick "is this already in the target language" test. Returns true only when fairly sure.
export function looksLikeTarget(text, target) {
  const t = normalizeLang(target);
  const c = countScripts(text);
  if (!c.total) return false;
  switch (t) {
    case 'zh-CN':
    case 'zh-TW':
      return c.kana === 0 && c.hangul === 0 && c.han / c.total >= 0.5;
    case 'ja':
      return c.kana > 0 && (c.kana + c.han) / c.total >= 0.5 && c.hangul === 0;
    case 'ko':
      return c.hangul / c.total >= 0.5;
    case 'ru':
      return c.cyrillic / c.total >= 0.6;
    case 'ar':
      return c.arabic / c.total >= 0.6;
    case 'th':
      return c.thai / c.total >= 0.6;
    case 'en':
      return looksEnglish(text);
    default:
      return false;
  }
}

// Targets whose script has no Latin letters: a translation that is still Latin text was not translated.
const NON_LATIN_TARGETS = new Set(['zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'ar', 'th']);

export function latinRatio(text) {
  const c = countScripts(text);
  return c.total ? c.latin / c.total : 0;
}

// True when the model handed the source back unchanged although it should have been translated
// (small models do this for sentences they "know"). Brands, URLs, e-mail addresses and camelCase
// names are left alone. A false positive only costs one retry on another model.
export function looksUntranslated(source, translated, to) {
  if (!NON_LATIN_TARGETS.has(normalizeLang(to))) return false;
  const src = String(source ?? '').trim();
  if (!src || src !== String(translated ?? '').trim()) return false;
  const plain = stripMarkup(src);
  const words = plain.match(/[A-Za-z]{2,}/g);
  if (!words) return false;
  if (/:\/\/|@|\\/.test(plain)) return false;
  if (latinRatio(plain) < 0.8) return false;
  if (words.length === 1) return /^[A-Z]?[a-z]{3,}$/.test(words[0]) && plain.replace(/[^A-Za-z]/g, '').length === words[0].length;
  return true;
}

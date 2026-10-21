// Browser UI language is independent of the saved translation target language.
import { messages } from './i18n-messages.js';

// The verified userscript UI resource supplies its additional public copy on first open.
export function registerMessages(extra) {
  for (const [key,pair] of Object.entries(extra || {})) {
    if (/^[a-z]\w*$/i.test(key) && Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) messages[key] = pair;
  }
}

export function uiLanguage(language = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language) {
  return /^zh(?:[-_]|$)/i.test(String(language || '')) ? 'zh-CN' : 'en';
}

export function t(key, substitutions = []) {
  const values = (Array.isArray(substitutions) ? substitutions : [substitutions]).map(value => String(value ?? ''));
  const api = globalThis.chrome?.i18n;
  const native = api?.getMessage?.(key, values);
  // Chrome falls back to English for Chinese variants without a matching catalogue.
  // All Chinese browser locales intentionally use Simplified Chinese in DualLens.
  if (native && !(uiLanguage() === 'zh-CN' && !/^zh[-_]CN$/i.test(api?.getUILanguage?.() || ''))) return native;
  const message = messages[key]?.[uiLanguage() === 'zh-CN' ? 0 : 1] || key;
  return message.replace(/\$(\d+)/g, (_, n) => values[Number(n) - 1] ?? '');
}

// Only text and explicitly listed inert attributes are localized. Never parse markup.
export function localize(root = document) {
  const doc = root.ownerDocument || root;
  if (doc.documentElement) doc.documentElement.lang = uiLanguage();
  const nodes = [...(root.matches?.('[data-i18n]') ? [root] : []), ...root.querySelectorAll('[data-i18n]')];
  for (const node of nodes) node.textContent = t(node.dataset.i18n);
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attr}]`)) node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
  }
}

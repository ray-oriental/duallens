// Browser UI language is independent of the saved translation target language.
import { messages } from './i18n-messages.js';

// The verified userscript UI resource supplies its additional public copy on first open.
export function registerMessages(extra) {
  for (const [key,pair] of Object.entries(extra || {})) {
    if (/^[a-z]\w*$/i.test(key) && Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) messages[key] = pair;
  }
}

let preference = 'zh-CN';
export function setUiLanguage(pref) {
  const next = ['zh-CN','en','auto'].includes(pref) ? pref : 'zh-CN';
  const changed = preference !== next;
  preference = next;
  return changed;
}
export function uiLanguage(language = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language) {
  return preference === 'auto' ? /^zh(?:[-_]|$)/i.test(String(language || '')) ? 'zh-CN' : 'en' : preference;
}

export function t(key, substitutions = []) {
  const values = (Array.isArray(substitutions) ? substitutions : [substitutions]).map(value => String(value ?? ''));
  const message = messages[key]?.[uiLanguage() === 'zh-CN' ? 0 : 1] || key;
  return message.replace(/\$(\d+)/g, (_, n) => values[Number(n) - 1] ?? '');
}

// Generated static UI keeps text-node bindings, so relocalization never replaces
// appended controls, user input, translated output or event listeners.
const bindings = new WeakMap();
export function message(key, values = []) {
  return { key, values, toString() { return t(key, Array.isArray(values) ? values.map(String) : String(values)); } };
}
export function setText(node, value) {
  node.textContent = String(value ?? '');
  if (value?.key && typeof value.toString === 'function')
    bindings.set(node, { ...bindings.get(node), text: { node: node.firstChild, value } });
  return node;
}
export function setAttribute(node, name, value) {
  node.setAttribute(name, String(value));
  if (value?.key && typeof value.toString === 'function') {
    const binding = bindings.get(node) || {};
    (binding.attributes ||= {})[name] = value;
    bindings.set(node, binding);
  }
}

// Only text and explicitly listed inert attributes are localized. Never parse markup.
export function localize(root = document) {
  const doc = root.ownerDocument || root;
  if (root === doc && doc.documentElement) doc.documentElement.lang = uiLanguage();
  const nodes = [...(root.matches?.('[data-i18n]') ? [root] : []), ...root.querySelectorAll('[data-i18n]')];
  for (const node of nodes) node.textContent = t(node.dataset.i18n);
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attr}]`)) node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.hasAttribute?.('lang')) node.lang = uiLanguage();
    const binding = bindings.get(node);
    if (binding?.text?.node?.parentNode === node) binding.text.node.data = String(binding.text.value);
    for (const [name, value] of Object.entries(binding?.attributes || {})) node.setAttribute(name, String(value));
  }
  if (root.matches?.('[lang]')) root.lang = uiLanguage();
}

// Background/offscreen contexts use the same preference without depending on DOM.
export async function initUiLanguage(store, root) {
  let closed = false, epoch = 0;
  const refresh = async () => {
    const token = ++epoch, settings = await store.load();
    if (closed || token !== epoch) return;
    setUiLanguage(settings.uiLanguage);
    if (root) localize(root);
  };
  const off = store.onChange?.(() => { void refresh().catch(() => {}); });
  await refresh();
  return () => { closed = true; off?.(); };
}

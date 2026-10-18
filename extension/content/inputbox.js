// Input-box translation: press space three times quickly (or Alt+I) in a text field and its
// content is replaced or combined with the translation into settings.input.targetLang. A leading "/ja " style
// prefix overrides the target language for that one translation.

import { LANGS } from '../shared/settings.js';
import { createOverlay, toast } from './overlay.js';
import { deepActiveElement, interactionRequest } from './util.js';

const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel']);
const PREFIX = /^\s*\/([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)[ \t ]+/;
const WINDOW_MS = 500;

const CHIP_CSS = `.chip{position:fixed;display:none;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--bg);color:var(--fg2);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12px;pointer-events:none}.chip.show{display:inline-flex}.spin{width:10px;height:10px;border-radius:50%;border:2px solid var(--accent);border-right-color:transparent;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}`;

// The editable element a key event or focus belongs to, or null. Password fields never qualify.
export function editableOf(node) {
  if (!node || node.nodeType !== 1) return null;
  const tag = node.tagName;
  if (tag === 'TEXTAREA') return node.readOnly || node.disabled ? null : node;
  if (tag === 'INPUT') {
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    if (!TEXT_TYPES.has(type) || node.readOnly || node.disabled) return null;
    return node;
  }
  if (node.isContentEditable) {
    let host = node;
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    return host;
  }
  return null;
}

function resolveLang(code) {
  const c = code.toLowerCase();
  const exact = LANGS.find((l) => l.code.toLowerCase() === c);
  if (exact) return exact.code;
  const base = c.split('-')[0];
  const hit = LANGS.find((l) => l.code.toLowerCase() === base) || LANGS.find((l) => l.code.toLowerCase().startsWith(`${base}-`));
  return hit ? hit.code : null;
}

// A canonical plain-text view keeps BR/block separators and stable offsets across editor rerenders.
function richText(el, points) {
  let text = '';
  const add = (value, node, start, after) => {
    if (points) for (let i = 0; i < value.length; i++) points.push([node, start + i]);
    text += value;
    if (points) points.end = after;
  };
  const walk = node => {
    if (node.nodeType === 3) { add(node.data, node, 0, [node, node.length]); return; }
    let index = 0;
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR') add('\n', node, index, [node, index + 1]);
      else {
        if (/^(DIV|P|LI|BLOCKQUOTE)$/.test(child.nodeName) && child.previousSibling && text && !text.endsWith('\n')) add('\n', node, index, [child, 0]);
        walk(child);
      }
      index++;
    }
  };
  walk(el);
  if (points) points.push(points.end || [el, 0]);
  return text;
}

export function inputOutput(source, translated, cfg, singleLine) {
  if (cfg.mode !== 'bilingual') return translated;
  const parts = cfg.order === 'translation-first' ? [translated, source] : [source, translated];
  return parts.join(singleLine ? ' ' : '\n');
}

export function inputAccessor(el, useSelection) {
  const doc = el.ownerDocument, win = doc.defaultView;
  const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  const current = () => field ? el.value : richText(el);
  const before = current();
  let start = 0, end = before.length;
  if (field) {
    if (useSelection && Number.isInteger(el.selectionStart) && el.selectionStart !== el.selectionEnd) {
      start = el.selectionStart; end = el.selectionEnd;
    }
  } else {
    const sel = win.getSelection();
    if (useSelection && sel?.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
      const r = sel.getRangeAt(0), prefix = r.cloneRange();
      prefix.selectNodeContents(el); prefix.setEnd(r.startContainer, r.startOffset);
      start = richText(prefix.cloneContents()).length;
      const selected = richText(r.cloneContents());
      end = start + selected.length;
      if (before.slice(start, end) !== selected) throw Error('选区结构无法安全写回');
    }
  }
  function select() {
    el.focus();
    if (field) { el.setSelectionRange(start, end); return; }
    const points = []; richText(el, points);
    const r = doc.createRange();
    r.setStart(...points[start]); r.setEnd(...points[end]);
    const sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return r;
  }
  const event = (type, out) => new win.InputEvent(type, { bubbles:true, composed:true,
    cancelable:type === 'beforeinput', inputType:'insertText', data:out });
  return { text:before.slice(start, end), current, before,
    async apply(out, valid, writing = () => {}) {
      const expected = before.slice(0, start) + out + before.slice(end);
      const input = () => el.dispatchEvent(event('input', out));
      const native = () => {
        const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, expected); input();
      };
      const direct = () => {
        const range = select(), fragment = doc.createDocumentFragment();
        out.split('\n').forEach((line, i) => { if (i) fragment.append(doc.createElement('br')); fragment.append(doc.createTextNode(line)); });
        range.deleteContents(); range.insertNode(fragment); input();
      };
      const strategies = [
        field ? native : direct,
        () => { select(); doc.execCommand('insertText', false, out); },
        () => { select(); if (el.dispatchEvent(event('beforeinput', out))) { if (field) native(); else direct(); } },
      ];
      for (const write of strategies) {
        if (!valid() || current() !== before) return false;
        writing(true);
        try { write(); } catch { /* unsupported strategy: try the next only if unchanged */ }
        finally { writing(false); }
        await new Promise(resolve => setTimeout(resolve, 32));
        if (!valid()) return false;
        if (current() === expected) return true;
        if (current() !== before) return false; // unexpected editor/user changes are never overwritten
      }
      return false;
    },
  };
}

export class InputBox {
  constructor({ getSettings, platform }) {
    this.platform = platform;
    this.getSettings = getSettings;
    this.hits = [];
    this.busy = new WeakSet();
    this.composing = new WeakSet();
    this.epoch = 0;
    this.onComposition = e => {
      const el = editableOf(e.composedPath()[0]);
      if (el) this.composing[e.type === 'compositionstart' ? 'add' : 'delete'](el);
      this.hits.length = 0;
    };
    this.on = false;
    this.chip = null;
    this.lastEditable = null;
    this.onFocus = (e) => {
      const target = e.composedPath()[0];
      const editable = editableOf(target);
      if (editable) this.lastEditable = editable;
      else if (!e.composedPath().some((n) => n.localName === 'dl-ui')) this.lastEditable = null;
    };
    this.onKeyDown = (e) => this.#keydown(e);
  }

  enable() {
    if (this.on) return;
    this.on = true;
    document.addEventListener('compositionstart', this.onComposition, true);
    document.addEventListener('compositionend', this.onComposition, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('focusin', this.onFocus, true);
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.epoch++;
    this.composing = new WeakSet();
    document.removeEventListener('compositionstart', this.onComposition, true);
    document.removeEventListener('compositionend', this.onComposition, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('focusin', this.onFocus, true);
    this.lastEditable = null;
    this.failure?.detach();
    this.chip?.ui.detach();
    this.chip = null;
  }

  #keydown(e) {
    const cfg = this.getSettings().input;
    if (!cfg.enabled || cfg.trigger !== 'triple-space') return;
    if (e.isComposing || e.keyCode === 229 || this.composing.has(editableOf(e.composedPath()[0]))) {
      this.hits.length = 0;
      return;
    }
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const el = editableOf(e.composedPath()[0]);
      if (!el) {
        this.hits.length = 0;
        return;
      }
      if (this.hitElement !== el) { this.hits.length = 0; this.hitElement = el; }
      const now = performance.now();
      this.hits = this.hits.filter((t) => now - t <= WINDOW_MS);
      this.hits.push(now);
      if (this.hits.length >= 3) {
        this.hits.length = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.run(el, false);
      }
    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
      this.hits.length = 0;
    }
  }

  // Command path (Alt+I): the focused field, honouring a selection inside it.
  translateFocused(allowRecent = false) {
    // Touching a shadow menu may move focus away from the field. Only that explicit menu
    // action may use the last editable; shortcuts retain their focused-field semantics.
    const el = editableOf(deepActiveElement()) || (allowRecent && this.lastEditable?.isConnected ? editableOf(this.lastEditable) : null);
    if (!el) {
      toast('请先点进要翻译的输入框', 'error');
      return;
    }
    this.run(el, true);
  }

  #showChip(el) {
    if (!this.chip) {
      const ui = createOverlay(CHIP_CSS);
      const node = document.createElement('div');
      node.className = 'chip';
      const spin = document.createElement('i');
      spin.className = 'spin';
      node.append(spin, document.createTextNode('翻译中…'));
      ui.el.appendChild(node);
      this.chip = { ui, node };
    }
    const r = el.getBoundingClientRect();
    this.chip.ui.attach();
    this.chip.node.style.left = `${Math.max(4, Math.min(innerWidth - 100, r.right - 90))}px`;
    this.chip.node.style.top = `${Math.max(4, Math.min(innerHeight - 30, r.bottom + 4))}px`;
    this.chip.node.classList.add('show');
  }

  #hideChip() {
    this.chip?.node.classList.remove('show');
  }

  async run(el, useSelection) {
    if (this.busy.has(el) || this.composing.has(el) || !editableOf(el)) return;
    const cfg = this.getSettings();
    if (!cfg.input.enabled) return;
    let acc;
    try { acc = inputAccessor(el, useSelection); } catch { toast('选区结构无法安全写回，请调整选区', 'error'); return; }
    // the first two spaces of a triple-space trigger are already in the field
    let text = useSelection ? acc.text : acc.text.replace(/[  ]+$/, '');
    let target = cfg.input.targetLang;
    if (cfg.input.prefixOverride) {
      const m = PREFIX.exec(text);
      const lang = m && resolveLang(m[1]);
      if (lang) {
        target = lang;
        text = text.slice(m[0].length);
      }
    }
    if (!text.trim()) {
      toast('输入框是空的', 'error');
      return;
    }
    const epoch = this.epoch;
    let edited = false, writing = false;
    const changed = e => { if (!writing || e.type === 'compositionstart') edited = true; };
    const observer = new MutationObserver(() => { if (!writing) edited = true; });
    if (el.isContentEditable) observer.observe(el, { subtree:true, childList:true, characterData:true, attributes:true });
    for (const type of ['input', 'beforeinput', 'compositionstart']) el.addEventListener(type, changed, true);
    const valid = () => !edited && this.on && this.epoch === epoch && this.getSettings().input.enabled &&
      el.isConnected && !!editableOf(el) && !this.composing.has(el);
    this.busy.add(el);
    this.#showChip(el);
    try {
      const res = await this.platform.translator().translateText({ text, to:target, from:'auto', purpose:'input', ...interactionRequest(cfg.input) });
      if (!valid()) return;
      if (!res.ok || typeof res.text !== 'string' || !res.text.trim()) {
        toast('输入框翻译失败，请重试', 'error', 4000); return;
      }
      if (acc.current() !== acc.before) { toast('翻译期间输入框内容变了，已放弃写回', 'error', 3500); return; }
      // Drain pending mutations before allowing our own writes.
      if (observer.takeRecords().length) return;
      observer.disconnect(); writing = true;
      const out = inputOutput(text, res.text, cfg.input, el.tagName === 'INPUT');
      if (!await acc.apply(out, valid, value => { writing = value; }) && valid()) this.#writeFailure(res.text);
    } catch { toast('输入框翻译失败，请重试', 'error', 4000); }
    finally {
      observer.disconnect();
      for (const type of ['input', 'beforeinput', 'compositionstart']) el.removeEventListener(type, changed, true);
      this.busy.delete(el); this.#hideChip();
    }
  }

  #writeFailure(text) {
    this.failure?.detach();
    const ui = createOverlay('.failure{position:fixed;bottom:24px;left:8px;max-width:calc(100vw - 16px);padding:12px;background:var(--bg);color:var(--fg);border:1px solid var(--line);pointer-events:auto}.failure button{min-height:44px}.failure textarea{display:block;max-width:100%;width:320px}');
    const box = document.createElement('div'); box.className = 'failure'; box.setAttribute('role', 'alert');
    const label = document.createElement('p'); label.textContent = '编辑器未确认写回，请复制译文后粘贴。';
    const value = document.createElement('textarea'); value.readOnly = true; value.value = text; value.setAttribute('aria-label', '未写回的译文');
    const copy = document.createElement('button'); copy.textContent = '复制译文';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; } catch { value.select(); } };
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => ui.detach();
    box.append(label, value, copy, close); ui.el.append(box); ui.attach(); this.failure = ui;
  }
}

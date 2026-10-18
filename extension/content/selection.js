// Selection translation: a small icon beside the selected text, and a card with the translation.
// Both live in one closed shadow root (see overlay.js).

import { lensIcon } from './visual.js';
import { createOverlay } from './overlay.js';
import { deepActiveElement } from './util.js';

const MAX_CHARS = 4000;

const CSS = `.icon{position:fixed;width:28px;height:28px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--bg);box-shadow:var(--shadow);display:none;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer}.icon.show{display:flex}.icon:hover{border-color:var(--accent)}.icon svg{width:16px;height:16px}.card{position:fixed;display:none;flex-direction:column;overflow:hidden;resize:both;width:340px;height:auto;min-width:240px;min-height:110px;max-width:calc(100vw - 16px);max-height:min(70vh,520px);background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);pointer-events:auto}.card.show{display:flex}.head{display:flex;align-items:center;gap:2px;padding:4px 6px 4px 10px;cursor:move;background:var(--bg2);border-bottom:1px solid var(--line);user-select:none;flex:none}.title{font-weight:600;font-size:12px;color:var(--fg2);flex:1}.tool{border:0;background:transparent;border-radius:6px;min-width:26px;height:24px;padding:0 6px;font-size:12px;color:var(--fg2);cursor:pointer}.tool:hover{background:var(--line);color:var(--fg)}.tool[hidden]{display:none}.body{flex:1;overflow:auto;padding:10px 12px 12px;cursor:auto;user-select:text}.src{color:var(--fg2);font-size:12px;margin:0 0 8px;padding-bottom:8px;border-bottom:1px dashed var(--line);white-space:pre-wrap;word-break:break-word}.card.only .src{display:none}.dst{margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}.dst.err{color:var(--danger)}.dots::after{content:"";animation:dots 1.1s steps(4,end) infinite}@keyframes dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}@media (pointer:coarse){.icon{width:44px;height:44px}.tool,.retry{min-width:44px;min-height:44px}.head{touch-action:none}}@media (prefers-reduced-motion:reduce){.dots::after{animation:none;content:"..."}}.retry{margin-top:8px;border:1px solid var(--line);background:var(--bg2);border-radius:6px;padding:2px 10px}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class SelectionUI {
  constructor({ getSettings, platform }) {
    this.platform = platform;
    this.getSettings = getSettings;
    this.ui = null;
    this.pending = null; // { text, rect }
    this.cardState = null; // null until first shown, then { visible, text, source }
    this.on = false;
    this.cardMode = null;
    this.speakOk = false;

    this.onMouseUp = (e) => {
      if (e.button !== 0 || e.composedPath().includes(this.ui?.host)) return;
      setTimeout(() => this.#check(), 0);
    };
    this.onKeyUp = (e) => {
      if (e.shiftKey && /^(Arrow|Home|End|Page)/.test(e.key)) setTimeout(() => this.#check(), 0);
    };
    this.onDown = (e) => {
      if (this.ui && e.composedPath().includes(this.ui.host)) return;
      this.#hideIcon();
      this.closeCard();
    };
    this.onKey = (e) => {
      if (e.key === 'Escape') {
        this.#hideIcon();
        this.closeCard();
      }
    };
    this.selectionTimer = 0;
    this.onTouchUp = (e) => { if (e.pointerType === 'touch') setTimeout(() => this.#check(), 0); };
    this.onSelChange = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed) this.#hideIcon();
      else if (this.platform.coarse) { clearTimeout(this.selectionTimer); this.selectionTimer = setTimeout(() => { if (this.on) this.#check(); }, 100); }
    };
    this.hideIcon = () => this.#hideIcon();
  }

  enable() {
    if (this.on) return;
    this.on = true;
    document.addEventListener('pointerup', this.onTouchUp, true);
    document.addEventListener('mouseup', this.onMouseUp, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('selectionchange', this.onSelChange);
    window.addEventListener('scroll', this.hideIcon, { capture: true, passive: true });
    window.addEventListener('resize', this.hideIcon);
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    clearTimeout(this.selectionTimer);
    document.removeEventListener('pointerup', this.onTouchUp, true);
    document.removeEventListener('mouseup', this.onMouseUp, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('selectionchange', this.onSelChange);
    window.removeEventListener('scroll', this.hideIcon, { capture: true });
    window.removeEventListener('resize', this.hideIcon);
    this.#hideIcon();
    this.closeCard();
    this.ui?.detach();
  }

  destroy() {
    this.disable();
    this.ui?.detach();
    this.ui = null;
  }

  state() {
    return {
      selectionIcon: !!(this.iconEl && this.iconEl.classList.contains('show')),
      selectionCard: this.cardState ? { ...this.cardState, visible: this.#cardVisible() } : null,
    };
  }

  #cardVisible() {
    return !!(this.card && this.card.classList.contains('show'));
  }

  // ---- building ----------------------------------------------------------------------------

  #build() {
    if (this.ui) return;
    this.ui = createOverlay(CSS);
    const icon = el('button', 'icon');
    icon.type = 'button';
    icon.setAttribute('aria-label', '翻译选中文字');
    icon.addEventListener('pointerdown', (e) => e.preventDefault());
    icon.title = '翻译选中文字';
    icon.append(lensIcon(false));
    icon.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
    icon.addEventListener('click', () => {
      const p = this.pending;
      this.#hideIcon();
      if (p) this.openCard(p.text, p.rect);
    });

    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    const head = el('div', 'head');
    const title = el('span', 'title', 'DualLens');
    const bMode = el('button', 'tool', '双语');
    bMode.title = '切换双语 / 仅译文';
    const bRefine = el('button', 'tool', '精修');
    bRefine.title = '用大模型精修这段译文';
    bRefine.hidden = true;
    const bSpeak = el('button', 'tool', '朗读');
    bSpeak.title = '朗读译文';
    bSpeak.hidden = true;
    const bCopy = el('button', 'tool', '复制');
    const bClose = el('button', 'tool', '✕');
    bClose.title = '关闭 (Esc)';
    for (const b of [bMode, bRefine, bSpeak, bCopy, bClose]) b.type = 'button';
    head.append(title, bMode, bRefine, bSpeak, bCopy, bClose);
    const body = el('div', 'body');
    const src = el('p', 'src');
    const dst = el('p', 'dst');
    body.append(src, dst);
    card.append(head, body);
    this.ui.el.append(icon, card);

    bMode.addEventListener('click', () => {
      this.cardMode = this.cardMode === 'translation-only' ? 'bilingual' : 'translation-only';
      this.#applyCardMode();
    });
    bRefine.addEventListener('click', () => this.#refine());
    bSpeak.addEventListener('click', () => this.#speak());
    bCopy.addEventListener('click', async () => {
      const text = this.cardState?.text || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        bCopy.textContent = '已复制';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(dst);
        const sel = this.ui.root.getSelection ? this.ui.root.getSelection() : getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        bCopy.textContent = '已选中';
      }
      setTimeout(() => (bCopy.textContent = '复制'), 1200);
    });
    bClose.addEventListener('click', () => this.closeCard());
    this.#makeDraggable(head, card);

    Object.assign(this, { iconEl: icon, card, src, dst, bMode, bSpeak, bRefine });
  }

  #makeDraggable(handle, card) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        card.style.left = `${Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx))}px`;
        card.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ---- icon --------------------------------------------------------------------------------

  #check() {
    const s = this.getSettings();
    if (!s.selection.enabled) return;
    const ae = deepActiveElement();
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return this.#hideIcon();
    const text = sel.toString().trim();
    if (!text) return this.#hideIcon();
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    this.pending = { text: text.slice(0, MAX_CHARS), rect: rectOf(rect) };
    if (s.selection.showIcon) {
      this.#build();
      this.ui.attach();
      const icon = this.iconEl;
      const size = this.platform.coarse ? 44 : 28;
      const x = Math.min(innerWidth - size - 4, Math.max(4, this.platform.coarse ? rect.left : rect.right + 4));
      const y = Math.min(innerHeight - size - 4, Math.max(4, rect.bottom + 6));
      icon.style.left = `${x}px`;
      icon.style.top = `${y}px`;
      icon.classList.add('show');
    } else {
      this.openCard(this.pending.text, this.pending.rect);
    }
  }

  #hideIcon() {
    if (this.iconEl) this.iconEl.classList.remove('show');
  }

  // ---- card --------------------------------------------------------------------------------

  // rect may be null (context-menu path without a usable selection rectangle)
  async openCard(text, rect) {
    const s = this.getSettings();
    const value = String(text || '').trim().slice(0, MAX_CHARS);
    if (!value) return;
    this.#build();
    this.ui.attach();
    this.cardMode = this.cardMode || s.displayMode;
    this.src.textContent = value;
    this.dst.textContent = '';
    this.dst.className = 'dst dots';
    this.cardState = { visible: true, text: '', source: value };
    this.refineOf = null;
    this.bRefine.hidden = true;
    this.bRefine.textContent = '精修';
    this.bRefine.title = '用大模型精修这段译文';
    this.#applyCardMode();
    this.card.classList.add('show');
    this.#place(rect);
    this.#checkSpeech(s.targetLang);
    const token = (this.token = (this.token || 0) + 1);

    const res = await this.platform.translator().translateText({
      text: value,
      to: s.targetLang,
      from: s.sourceLang || 'auto',
      purpose: 'selection',
    });
    if (token !== this.token || !this.#cardVisible()) return;
    this.dst.replaceChildren();
    if (res.ok) {
      this.dst.className = 'dst';
      this.dst.textContent = res.text;
      this.cardState = { visible: true, text: res.text, source: value };
      // Machine translation answered at once; offer the LLM as an explicit second opinion.
      this.refineOf = res.by === 'mt' && ['mt+llm', 'auto'].includes(s.translation?.mode)
        ? { value, to: s.targetLang, from: s.sourceLang || 'auto' } : null;
      this.bRefine.hidden = !this.refineOf;
      this.bRefine.disabled = false;
    } else {
      this.dst.className = 'dst err';
      this.dst.textContent = `翻译失败：${(res.error && res.error.message) || '未知错误'}`;
      const retry = el('button', 'retry', '重试');
      retry.type = 'button';
      retry.addEventListener('click', () => this.openCard(value, rect));
      this.dst.append(document.createElement('br'), retry);
    }
    this.#place(rect, true);
  }

  // "用大模型精修": ask the LLM for this one selection. A failure leaves the machine translation in place.
  async #refine() {
    const job = this.refineOf;
    if (!job || this.bRefine.disabled) return;
    const token = this.token;
    const draft = this.cardState?.text || '';
    this.bRefine.disabled = true;
    this.bRefine.textContent = '精修中…';
    const res = await this.platform.translator().translateText({ text: job.value, to: job.to, from: job.from, purpose: 'selection', mode: 'llm' });
    if (token !== this.token || !this.#cardVisible()) return;
    this.bRefine.textContent = '精修';
    if (res.ok) {
      this.dst.className = 'dst';
      this.dst.textContent = res.text;
      this.cardState = { visible: true, text: res.text, source: job.value };
      this.refineOf = null;
      this.bRefine.hidden = true;
    } else {
      this.dst.textContent = draft;
      this.bRefine.disabled = false;
      this.bRefine.title = `大模型暂不可用（${(res.error && res.error.message) || '未知错误'}），已保留机器翻译；点击重试`;
    }
  }

  #place(rect, keepIfMoved = false) {
    const card = this.card;
    if (keepIfMoved && card.dataset.placed) {
      // the user may have dragged it; only keep it inside the viewport
      const r = card.getBoundingClientRect();
      if (r.bottom > innerHeight - 8) card.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
      return;
    }
    const w = Math.min(340, innerWidth - 16);
    let left = rect ? rect.left : innerWidth - w - 24;
    let top = rect ? rect.bottom + 10 : 24;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    card.style.width = `${w}px`;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    const h = card.getBoundingClientRect().height;
    if (top + h > innerHeight - 8) {
      top = rect ? Math.max(8, rect.top - h - 10) : Math.max(8, innerHeight - h - 8);
      if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
      card.style.top = `${top}px`;
    }
    card.dataset.placed = '1';
  }

  #applyCardMode() {
    const only = this.cardMode === 'translation-only';
    this.card.classList.toggle('only', only);
    this.bMode.textContent = only ? '仅译文' : '双语';
  }

  closeCard() {
    if (!this.card) return;
    this.token = (this.token || 0) + 1;
    this.card.classList.remove('show');
    delete this.card.dataset.placed;
    if (this.cardState) this.cardState = { ...this.cardState, visible: false };
    try {
      speechSynthesis.cancel();
    } catch {
      /* no speech support */
    }
  }

  #checkSpeech(lang) {
    const ss = globalThis.speechSynthesis;
    if (!ss) {
      this.bSpeak.hidden = true;
      return;
    }
    const base = String(lang).split('-')[0].toLowerCase();
    const has = () => ss.getVoices().some((v) => v.lang.toLowerCase().startsWith(base));
    const apply = () => {
      this.bSpeak.hidden = !has();
    };
    apply();
    if (!ss.getVoices().length) {
      // voices load asynchronously; the button stays hidden until we know one exists
      const once = () => {
        ss.removeEventListener('voiceschanged', once);
        apply();
      };
      ss.addEventListener('voiceschanged', once);
    }
  }

  #speak() {
    const text = this.cardState?.text;
    if (!text) return;
    const ss = globalThis.speechSynthesis;
    if (!ss) return;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.getSettings().targetLang;
    ss.speak(u);
  }
}

function rectOf(r) {
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}

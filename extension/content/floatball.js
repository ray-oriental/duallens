// Floating ball: click toggles page translation, drag moves it along the page edge, a small menu
// next to it holds the per-site switches. Closed shadow root; position is remembered per site.

import { lensIcon } from './visual.js';
import { createOverlay } from './overlay.js';
import { STYLES } from '../shared/settings.js';

const POS_KEY = 'dl-ball-pos'; // { [host]: { side, topRatio } } in platform.localArea
const SIZE = 44;
const GAP = 6;

const CSS = `
.ball {
  position: fixed; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; padding: 0; border: 0;
  background: linear-gradient(135deg, #4263eb, #20c997); box-shadow: 0 2px 10px rgba(0,0,0,.28);
  display: flex; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer;
  opacity: .72; transition: opacity .15s, transform .15s; touch-action: none; user-select: none;
}
.ball:hover, .ball.drag, .ball.open { opacity: 1; }
.ball.drag { cursor: grabbing; transform: scale(1.06); }
.ball svg { width: 22px; height: 22px; pointer-events: none; }
.ball::after {
  content: ""; position: absolute; inset: -4px; border-radius: 50%;
  border: 2px solid transparent; pointer-events: none;
}
.ball.on::after { border-color: #20c997; }
.ball.busy::after { border-color: #4263eb; border-top-color: transparent; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ball.busy::after { animation: none; } }
.more {
  position: fixed; width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 1px solid var(--line);
  background: var(--bg); color: var(--fg2); font-size: 11px; line-height: 16px; display: none;
  pointer-events: auto; cursor: pointer;
}
.more.show { display: block; }
.menu {
  position: fixed; display: none; min-width: 190px; padding: 6px; border-radius: 10px;
  background: var(--bg); border: 1px solid var(--line); box-shadow: var(--shadow); pointer-events: auto;
  max-height: calc(100dvh - 16px); overflow: auto;
}
.menu.show { display: block; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.row:hover { background: var(--bg2); }
.row.btn { cursor: pointer; width: 100%; color: var(--fg); background: transparent; border: 0; text-align: left; }
select { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 1px 4px; max-width: 120px; }
.sw { position: relative; width: 30px; height: 18px; flex: none; }
.sw input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.sw i { position: absolute; inset: 0; border-radius: 9px; background: var(--line); transition: background .15s; pointer-events: none; }
.sw i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; }
.sw input:checked + i { background: var(--accent); }
.sw input:checked + i::after { transform: translateX(12px); }
.sep { height: 1px; background: var(--line); margin: 4px 0; }
@media (pointer: coarse) {
  .more { width: 44px; height: 44px; font-size: 22px; }
  .row, select { min-height: 44px; }
  .sw { height: 44px; }
  .sw i { top: 13px; bottom: 13px; }
}
`;

function node(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ctx: { toggle(), getState(), siteMode() -> 'always'|'never'|null, setSiteMode(mode|null),
//        saveSettings(patch), openOptions(), translateInput() }
export class FloatBall {
  constructor({ getSettings, ctx, platform }) {
    this.platform = platform;
    this.getSettings = getSettings;
    this.ctx = ctx;
    this.ui = null;
    this.on = false;
    this.pos = { side: 'right', topRatio: 0.6 };
    this.hiddenByFullscreen = false;
    this.menuOpen = false;

    this.onResize = () => this.#layout();
    this.onFullscreen = () => {
      this.hiddenByFullscreen = !!document.fullscreenElement;
      if (this.ui) this.ui.host.style.visibility = this.hiddenByFullscreen ? 'hidden' : '';
    };
    this.onOutside = (e) => {
      if (this.menuOpen && !e.composedPath().includes(this.ui.host)) this.#closeMenu();
    };
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.menuOpen) this.#closeMenu();
    };
  }

  async enable() {
    if (this.on) return;
    this.on = true;
    await this.#loadPos();
    if (!this.on) return;
    this.#build();
    this.ui.attach();
    this.#layout();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
    this.update();
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.ui?.detach();
    this.menuOpen = false;
  }

  visible() {
    return this.on && !!this.ui && this.ui.host.isConnected && !this.hiddenByFullscreen;
  }

  async #loadPos() {
    const def = this.getSettings().floatBall;
    this.pos = { side: def.side === 'left' ? 'left' : 'right', topRatio: def.topRatio };
    try {
      const got = await this.platform.localArea.get(POS_KEY);
      const mine = got[POS_KEY] && got[POS_KEY][location.hostname];
      if (mine) this.pos = { side: mine.side === 'left' ? 'left' : 'right', topRatio: Number(mine.topRatio) || 0.6 };
    } catch {
      /* storage unavailable: use the defaults */
    }
  }

  async #savePos() {
    try {
      const got = await this.platform.localArea.get(POS_KEY);
      const all = got[POS_KEY] || {};
      all[location.hostname] = this.pos;
      await this.platform.localArea.set({ [POS_KEY]: all });
    } catch {
      /* not worth surfacing */
    }
  }

  // ---- build -------------------------------------------------------------------------------

  #build() {
    if (this.ui) return;
    this.ui = createOverlay(CSS);
    const ball = node('button', 'ball');
    ball.type = 'button';
    ball.title = '翻译 / 恢复本页（拖动可移动，右键打开菜单）';
    ball.append(lensIcon(true));
    ball.setAttribute('aria-label', '翻译或恢复当前页面');
    ball.addEventListener('click', (e) => { if (e.detail === 0) this.ctx.toggle(); });
    const more = node('button', 'more', '⋯');
    more.type = 'button';
    more.title = '更多';
    more.setAttribute('aria-label', '更多');
    more.addEventListener('pointerdown', (e) => e.preventDefault());
    const menu = node('div', 'menu');
    this.ui.el.append(ball, more, menu);
    Object.assign(this, { ball, more, menu });

    ball.addEventListener('pointerdown', (e) => this.#dragStart(e));
    ball.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.#toggleMenu();
    });
    more.addEventListener('click', () => this.#toggleMenu());
    // show the handle while the pointer is around the ball
    const hold = (v) => {
      clearTimeout(this.hideMore);
      if (v) more.classList.add('show');
      else if (!this.platform.coarse) this.hideMore = setTimeout(() => !this.menuOpen && more.classList.remove('show'), 500);
    };
    for (const e of [ball, more]) {
      e.addEventListener('pointerenter', () => hold(true));
      e.addEventListener('pointerleave', () => hold(false));
    }
  }

  #safeInsets() {
    const cs = getComputedStyle(this.ui.el);
    return Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [side, parseFloat(cs.getPropertyValue('--safe-' + side)) || 0]));
  }

  #layout() {
    if (!this.ball) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const safe = this.#safeInsets();
    const y = Math.round(Math.max(GAP + safe.top, Math.min(vh - SIZE - GAP - safe.bottom, this.pos.topRatio * (vh - SIZE))));
    const x = this.pos.side === 'left' ? GAP + safe.left : vw - SIZE - GAP - safe.right;
    this.ball.style.left = `${x}px`;
    this.ball.style.top = `${y}px`;
    const moreX = this.pos.side === 'left' ? x + SIZE + GAP : x - SIZE - GAP;
    this.more.style.left = `${moreX}px`;
    this.more.style.top = `${Math.max(GAP + safe.top, y - 8)}px`;
    if (this.platform.coarse) this.more.classList.add('show');
    if (this.menuOpen) this.#placeMenu();
  }

  // Settings changed: re-render an open menu and the state ring.
  refresh() {
    if (!this.ball) return;
    if (this.menuOpen) this.#fillMenu();
    this.update();
  }

  update() {
    if (!this.ball) return;
    const st = this.ctx.getState();
    this.ball.classList.toggle('on', !!st.translated);
    this.ball.classList.toggle('busy', st.pending > 0);
  }

  // ---- dragging ----------------------------------------------------------------------------

  #dragStart(e) {
    if (e.button !== 0) return;
    const ball = this.ball;
    const startX = e.clientX;
    const startY = e.clientY;
    const r = ball.getBoundingClientRect();
    const offX = startX - r.left;
    const offY = startY - r.top;
    let dragging = false;
    if (!e.isPrimary) return;
    ball.setPointerCapture(e.pointerId);
    const safe = this.#safeInsets();

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      if (!dragging) {
        dragging = true;
        ball.classList.add('drag');
        this.#closeMenu();
        this.more.classList.remove('show');
      }
      ball.style.left = `${Math.max(GAP + safe.left, Math.min(innerWidth - SIZE - GAP - safe.right, ev.clientX - offX))}px`;
      ball.style.top = `${Math.max(GAP + safe.top, Math.min(innerHeight - SIZE - GAP - safe.bottom, ev.clientY - offY))}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (ball.hasPointerCapture(ev.pointerId)) ball.releasePointerCapture(ev.pointerId);
      ball.removeEventListener('pointermove', move);
      ball.removeEventListener('pointerup', up);
      ball.removeEventListener('pointercancel', up);
      ball.classList.remove('drag');
      if (dragging) {
        const rect = ball.getBoundingClientRect();
        this.pos = {
          side: rect.left + SIZE / 2 < innerWidth / 2 ? 'left' : 'right',
          topRatio: Math.max(0, Math.min(1, rect.top / Math.max(1, innerHeight - SIZE))),
        };
        this.#layout();
        this.#savePos();
      } else if (ev.type === 'pointerup') {
        this.ctx.toggle();
      }
    };
    ball.addEventListener('pointermove', move);
    ball.addEventListener('pointerup', up);
    ball.addEventListener('pointercancel', up);
  }

  // ---- menu --------------------------------------------------------------------------------

  #toggleMenu() {
    if (this.menuOpen) this.#closeMenu();
    else this.#openMenu();
  }

  #openMenu() {
    this.#fillMenu();
    this.menuOpen = true;
    this.menu.classList.add('show');
    this.ball.classList.add('open');
    this.#placeMenu();
  }

  #closeMenu() {
    this.menuOpen = false;
    this.menu?.classList.remove('show');
    this.ball?.classList.remove('open');
    if (!this.platform.coarse) this.more?.classList.remove('show');
  }

  #placeMenu() {
    const b = this.ball.getBoundingClientRect();
    const m = this.menu.getBoundingClientRect();
    const left = this.pos.side === 'left' ? b.right + 10 : b.left - m.width - 10;
    const top = Math.max(8, Math.min(innerHeight - m.height - 8, b.top + b.height / 2 - m.height / 2));
    this.menu.style.left = `${Math.max(8, left)}px`;
    this.menu.style.top = `${top}px`;
  }

  #fillMenu() {
    const s = this.getSettings();
    const mode = this.ctx.siteMode();
    const menu = this.menu;
    menu.replaceChildren();

    const toggleRow = (label, checked, onChange) => {
      const row = node('label', 'row');
      row.append(node('span', '', label));
      const sw = node('span', 'sw');
      const input = node('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      sw.append(input, node('i'));
      row.append(sw);
      return row;
    };

    menu.append(
      toggleRow('仅显示译文', s.displayMode === 'translation-only', (v) =>
        this.ctx.saveSettings({ displayMode: v ? 'translation-only' : 'bilingual' }),
      ),
    );

    const styleRow = node('div', 'row');
    styleRow.append(node('span', '', '译文样式'));
    const sel = node('select');
    for (const st of STYLES) {
      const o = node('option', '', st.name);
      o.value = st.id;
      sel.append(o);
    }
    sel.value = s.style;
    sel.addEventListener('change', () => this.ctx.saveSettings({ style: sel.value }));
    styleRow.append(sel);
    menu.append(styleRow, node('div', 'sep'));

    const always = toggleRow('本站总是翻译', mode === 'always', (v) => this.ctx.setSiteMode(v ? 'always' : null));
    const never = toggleRow('本站从不翻译', mode === 'never', (v) => {
      this.ctx.setSiteMode(v ? 'never' : null);
      if (!v) return;
      this.#closeMenu();
    });
    menu.append(always, never, node('div', 'sep'));

    const opts = node('button', 'row btn', '打开设置');
    opts.type = 'button';
    opts.addEventListener('click', () => {
      this.#closeMenu();
      this.ctx.openOptions();
    });
    const input = node('button', 'row btn', '翻译当前输入框');
    input.type = 'button';
    input.addEventListener('pointerdown', (e) => e.preventDefault());
    input.addEventListener('click', () => { this.#closeMenu(); this.ctx.translateInput(); });
    menu.append(input, opts);
  }
}

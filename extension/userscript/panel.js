import { createOverlay } from '../content/overlay.js';
import { mountSettingsForm } from '../ui/forms/index.js';
import { deepActiveElement } from '../content/util.js';

const CSS = `
.backdrop { position: fixed; inset: 0; background: #0006; pointer-events: auto; }
.panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(960px,calc(100vw - 24px));
  max-height: calc(100dvh - 24px); overflow: auto; padding: 20px; border: 1px solid var(--line);
  border-radius: 14px; background: var(--bg); color: var(--fg); pointer-events: auto; box-shadow: var(--shadow); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 18px; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
input, select { width: 100%; min-height: 44px; font: inherit; font-size: 16px; padding: 8px; color: var(--fg); background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; }
button { min-height: 44px; min-width: 44px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg2); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.status { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg2); }
@media (max-width: 599px) {
 .panel { inset: 0; transform: none; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0;
   padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); }
}
`;

const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };

export function createSettingsPanel({ store, platform, mountForm = mountSettingsForm }) {
  let ui = null, mounted = null, previous = null;
  let generation = 0;
  function close() {
    generation++;
    mounted?.destroy?.(); mounted = null;
    ui?.detach(); ui = null;
    previous?.focus?.(); previous = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab' || !ui) return;
    const controls = [...ui.root.querySelectorAll('button,input,select,textarea,[tabindex]')]
      .filter((el) => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!controls.length) return;
    const current = ui.root.activeElement;
    const index = controls.indexOf(current);
    const next = controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length];
    e.preventDefault(); next.focus();
  }
  return {
    async open() {
      if (ui) return;
      const token = ++generation;
      previous = deepActiveElement();
      ui = createOverlay(CSS);
      const backdrop = node('div'); backdrop.className = 'backdrop'; backdrop.addEventListener('click', close);
      const panel = node('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'DualLens 设置');
      const head = node('div'); head.className = 'head';
      const exit = node('button', '关闭'); exit.type = 'button'; exit.addEventListener('click', close);
      head.append(node('h2', 'DualLens 设置'), exit);
      // Shared-form integration seam, inside the closed shadow root.
      const mount = node('div'); mount.className = 'settings-form-mount';
      panel.append(head, mount); ui.el.append(backdrop, panel); ui.attach();
      document.addEventListener('keydown', onKey, true); exit.focus();
      try {
        const result = await mountForm(mount, { store, platform });
        if (token !== generation) result?.destroy?.(); else mounted = result;
      } catch { if (token === generation) mount.textContent = '设置加载失败，请关闭后重试'; }
    },
    close,
  };
}

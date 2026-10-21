import { createOverlay } from '../content/overlay.js';
import { deepActiveElement } from '../content/util.js';
const TEXT={settings:'DualLens 设置',popup:'DualLens',close:'关闭',failed:'设置加载失败，请关闭后重试'};

const CSS = `
.backdrop { position: fixed; inset: 0; background: #0006; pointer-events: auto; }
.panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(960px,calc(100vw - 24px));
  max-height: calc(100dvh - 24px); overflow: auto; padding: 20px; border: 1px solid var(--line);
  border-radius: 14px; background: var(--bg); color: var(--fg); pointer-events: auto; box-shadow: var(--shadow); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 18px; margin: 0; }
button { min-height:44px; min-width:44px; font:inherit; cursor:pointer; }
.panel { --bg:var(--dl-bg,#f6f6f7); --fg:var(--dl-text,#1c1c21); --fg2:var(--dl-text-2,#575762); --bg2:var(--dl-inset,#efeff1); --line:var(--dl-border,#e3e3e8); --shadow:var(--dl-shadow-3); background:var(--bg); }
.backdrop { background:var(--dl-scrim,rgba(16,18,27,.48)); }
.popup-panel { width:360px;padding:0; }
.popup-panel>.head { padding:8px 12px 0; }
.panel .settings-heading,.popup-panel .dl-popup>header strong,.popup-panel .dl-popup>header .dl-mark { display:none; }
.popup-panel .dl-popup>header { justify-content:space-between; }
@media (max-width: 599px) {
 .panel { inset: 0; transform: none; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0;
   padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); }
 .popup-panel { inset:auto 0 0; width:100%;height:auto;max-height:90dvh;border-radius:16px 16px 0 0;padding:8px 0 calc(8px + env(safe-area-inset-bottom)); }
}
`;

const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };

export function createSettingsPanel({ store, platform, mountForm, kind='settings' }) {
  let ui = null, mounted = null, previous = null;
  let generation = 0;
  function close() {
    if(mounted?.canClose){const token=generation;Promise.resolve(mounted.canClose()).then(yes=>{if(yes&&token===generation)finishClose();});return;}
    finishClose();
  }
  function finishClose() {
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
      panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', kind==='popup'?TEXT.popup:TEXT.settings);
      if(kind==='popup') panel.classList.add('popup-panel');
      const head = node('div'); head.className = 'head';
      const exit = node('button', TEXT.close); exit.type = 'button'; exit.addEventListener('click', close);
      head.append(node('h2', kind==='popup'?TEXT.popup:TEXT.settings), exit);
      // Shared-form integration seam, inside the closed shadow root.
      const mount = node('div'); mount.className = 'settings-form-mount';
      panel.append(head, mount); ui.el.append(backdrop, panel); ui.attach();
      document.addEventListener('keydown', onKey, true); exit.focus();
      try {
        const result = await mountForm(mount, { store, platform });
        if (token !== generation) result?.destroy?.(); else mounted = result;
      } catch { if (token === generation) mount.textContent = TEXT.failed; }
    },
    close,
  };
}

// Entry integration seam: the owner wires the returned App's state/command callback here.
// All heavy UI and CSS stays in the verified, lazily loaded settings resource.
export function createPopupPanel({store,platform,loadSettingsForm,pageMessage}) {
  const panel=createSettingsPanel({store,platform,kind:'popup',mountForm:async root=>{
    const mount=await loadSettingsForm();
    return mount.mountPopup(root,{store,platform,url:location.href,pageMessage,
      onSettings:group=>{panel.close();platform.settingsGroup=group;platform.openSettings();},
      onText:()=>{panel.close();platform.openTextTranslation?.();}});
  }});
  return panel;
}

export function registerPopupMenu({platform,loadSettingsForm,pageMessage}) {
  const panel=createPopupPanel({store:platform.settingsStore,platform,loadSettingsForm,pageMessage});
  platform.registerCommand('duallens',TEXT.popup,()=>{void panel.open();});
  return panel;
}

import { t as l10n, message, setText, setAttribute, setUiLanguage, localize } from '../shared/i18n.js';
import { createOverlay } from '../content/overlay.js';
import { deepActiveElement } from '../content/util.js';
const TEXT={get settings(){return l10n('mh9');},popup:'DualLens',get close(){return l10n('m44');},get failed(){return l10n('mka');}};

const CSS = `
.backdrop { position: fixed; inset: 0; background: var(--dl-scrim, rgba(0,0,0,.32)); pointer-events: auto; }
.panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(960px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px); overflow: auto; padding: 0; border: 1px solid var(--dl-border, rgba(0,0,0,.08));
  border-radius: 12px; background: var(--dl-bg, #fafaf9); color: var(--dl-text, #1c1c1e); pointer-events: auto;
  box-shadow: var(--dl-shadow-3, 0 8px 24px rgba(0,0,0,.12)); font-family: var(--dl-font, system-ui, sans-serif); }
.head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 8px 0 20px; background: var(--dl-bg, #fafaf9); }
h2 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.head button { min-width: 44px; min-height: 44px; padding: 0; border: 0; border-radius: 8px; background: transparent;
  color: var(--dl-text-3, #6e6f75); font: 400 20px/1 var(--dl-font, system-ui, sans-serif); cursor: pointer; }
.head button:hover { color: var(--dl-text, #1c1c1e); }
.head button:focus-visible { outline: 2px solid var(--dl-text, #1c1c1e); outline-offset: -4px; }
.panel:not([data-keyboard]) :focus-visible { outline: none; }
.panel .settings-heading, .popup-panel .dl-popup .dl-brand { display: none; }
.panel .dl-settings { padding-top: 12px; }
.popup-panel { width: 360px; }
.popup-panel > .head { padding: 4px 4px 0 16px; }
.popup-panel .dl-popup > .dl-head { justify-content: flex-end; }
@media (max-width: 599px) {
 .panel { inset: 0; transform: none; width: 100%; height: 100dvh; max-height: 100dvh; border: 0; border-radius: 0;
   padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
 .head { padding: 4px 4px 0 16px; }
 .panel .dl-settings { padding-top: 4px; }
 .popup-panel { inset: auto 0 0; width: 100%; height: auto; max-height: 90dvh; border-top: 1px solid var(--dl-border, rgba(0,0,0,.08));
   border-radius: 12px 12px 0 0; }
}
`;

const node = (tag, text) => { const el = document.createElement(tag); if (text) setText(el,text); return el; };

export function createSettingsPanel({ store, platform, mountForm, kind='settings' }) {
  let ui = null, mounted = null, previous = null;
  let generation = 0, offLanguage;
  function close() {
    if(mounted?.canClose){const token=generation;Promise.resolve(mounted.canClose()).then(yes=>{if(yes&&token===generation)finishClose();});return;}
    finishClose();
  }
  function finishClose() {
    generation++;offLanguage?.();offLanguage=null;
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
      setUiLanguage((await store.load()).uiLanguage);if(token!==generation)return;
      previous = deepActiveElement();
      ui = createOverlay(CSS);
      const backdrop = node('div'); backdrop.className = 'backdrop'; backdrop.addEventListener('click', close);
      const panel = node('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true'); setAttribute(panel,'aria-label',kind==='popup'?TEXT.popup:message('mh9'));
      // Rings mark keyboard focus only; the initial programmatic focus stays quiet until a key is pressed.
      panel.addEventListener('keydown', () => { panel.dataset.keyboard = ''; }); panel.addEventListener('pointerdown', () => { delete panel.dataset.keyboard; });
      if(kind==='popup') panel.classList.add('popup-panel');
      const head = node('div'); head.className = 'head';
      const exit = node('button', '×'); exit.type = 'button'; setAttribute(exit,'aria-label',message('m44')); exit.addEventListener('click', close);
      head.append(node('h2',kind==='popup'?TEXT.popup:message('mh9')), exit);
      // Shared-form integration seam, inside the closed shadow root.
      const mount = node('div'); mount.className = 'settings-form-mount';
      panel.append(head, mount); ui.el.append(backdrop, panel); ui.attach();
      offLanguage=store.onChange(async()=>{const pref=(await store.load()).uiLanguage;if(token!==generation||!ui)return;setUiLanguage(pref);localize(ui.el);});
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

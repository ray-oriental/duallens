import { createUserscriptPlatform } from '../platform/userscript.js';
import { createSettingsPanel } from './panel.js';
import { start } from '../content/main.js';
import contentCSS from '../styles/content.css';

// Grant bindings stay inside the bundle closure. No window properties or page message bridge.
if (window.top === window.self && /html/i.test(document.contentType || 'text/html')) {
  const boot = async () => {
    const gm = {
      getValue: GM_getValue, setValue: GM_setValue, deleteValue: GM_deleteValue,
      addValueChangeListener: GM_addValueChangeListener,
      registerMenuCommand: GM_registerMenuCommand, xmlhttpRequest: GM_xmlhttpRequest,
    };
    let panel;
    const platform = createUserscriptPlatform(gm, {
      coarse: matchMedia('(pointer: coarse)').matches,
      openSettings: () => { void panel.open(); },
    });
    panel = createSettingsPanel({ store: platform.settingsStore, platform });
    platform.injectStyle(contentCSS);
    platform.registerCommand('settings', 'DualLens 设置', platform.openSettings);
    await start(platform);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void boot(); }, { once: true });
  else void boot();
}

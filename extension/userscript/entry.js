import { t as l10n } from '../shared/i18n.js';
import { createUserscriptPlatform } from '../platform/userscript.js';
import { start } from '../content/main.js';
import contentCSS from '../styles/content.css';
import { registerPopupMenu } from './menu.js';

// Grant bindings stay inside the bundle closure. No window properties or page message bridge.
if (window.top === window.self && /html/i.test(document.contentType || 'text/html')) {
  const boot = async () => {
    const gm = {
      info: typeof GM_info==='object' ? GM_info : null,
      getValue: GM_getValue, setValue: GM_setValue, deleteValue: GM_deleteValue,
      addValueChangeListener: GM_addValueChangeListener,
      registerMenuCommand: GM_registerMenuCommand, xmlhttpRequest: GM_xmlhttpRequest,
      getResourceText: typeof GM_getResourceText==='function' ? GM_getResourceText : null,
    };
    const platform = createUserscriptPlatform(gm, {
      coarse: matchMedia('(pointer: coarse)').matches,
    });
    platform.injectStyle(contentCSS);
    platform.contentCSS=contentCSS;
    platform.registerCommand('settings', l10n('mh9'), platform.openSettings);
    const app = await start(platform);
    registerPopupMenu({ platform, pageMessage: msg => app.pageMessage(msg) });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void boot(); }, { once: true });
  else void boot();
}

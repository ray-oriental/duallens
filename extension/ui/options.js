import { localPDFAccess, mountLocalPDFSettings } from './local-pdf-access.js';
import { createFetchHttp } from '../platform/http.js';
import { initUiLanguage, localize, t } from '../shared/i18n.js';
import { getDefaultSettingsStore } from '../shared/settings.js';
import { mountSettingsForm } from './forms/index.js';
import { MSG_CACHE_CLEAR } from '../shared/protocol.js';
import { drawQRCode } from './forms/qrcode.js';
import { chromeStorageArea } from '../shared/storage-areas.js';

const platform = {
  kind: 'extension',
  localArea: chromeStorageArea(chrome.storage.local, 'local', chrome.storage.onChanged),
  version: chrome.runtime.getManifest().version,
  renderQr: drawQRCode,
  comics: {
    languages:lang=>chrome.runtime.sendMessage({type:lang?'comic-languages-delete':'comic-languages-list',lang}),
    syncSites:()=>chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'}),
  },
  http: createFetchHttp((...args)=>fetch(...args)),
  async clearCache() {
    const res = await chrome.runtime.sendMessage({ type: MSG_CACHE_CLEAR });
    if (!res.ok) throw new Error(res.error?.message || t('cacheClearFailed'));
  },
};
try {
  const offLanguage=await initUiLanguage(getDefaultSettingsStore(),document);
  window.addEventListener('pagehide',offLanguage,{once:true});
  const root = document.getElementById('settings-root');
  await mountSettingsForm(root, { store: getDefaultSettingsStore(), platform });
  const offPDF = mountLocalPDFSettings(root, localPDFAccess(chrome));
  window.addEventListener('pagehide', offPDF, { once: true });
} catch {
  document.getElementById('startup-status').hidden = false;
}

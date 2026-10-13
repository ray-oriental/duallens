import { getDefaultSettingsStore } from '../shared/settings.js';
import { mountSettingsForm } from './forms/index.js';
import { MSG_CACHE_CLEAR } from '../shared/protocol.js';

const platform = {
  kind: 'extension',
  comics: {
    languages:lang=>chrome.runtime.sendMessage({type:lang?'comic-languages-delete':'comic-languages-list',lang}),
    syncSites:()=>chrome.runtime.sendMessage({type:'comic-canvas-sites-sync'}),
  },
  async http({ url, method, headers, body, signal }) {
    const res = await fetch(url, { method, headers, body, signal, credentials: 'omit', cache: 'no-store' });
    return { status: res.status, headers: res.headers, text: await res.text() };
  },
  async clearCache() {
    const res = await chrome.runtime.sendMessage({ type: MSG_CACHE_CLEAR });
    if (!res.ok) throw new Error(res.error?.message || 'Cache clear failed');
  },
};
try {
  await mountSettingsForm(document.getElementById('settings-root'), { store: getDefaultSettingsStore(), platform });
} catch {
  document.getElementById('startup-status').hidden = false;
}

const RESTRICTED_HOSTS = new Set(['chromewebstore.google.com', 'microsoftedge.microsoft.com', 'chrome.google.com']);
export function injectableURL(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:', 'file:'].includes(url.protocol) && !RESTRICTED_HOSTS.has(url.hostname);
  } catch { return false; }
}

export function createTabInjector(api) {
  const pending = new Map();
  const ready = tabId => api.tabs.sendMessage(tabId, { type: 'tab-ready' }, { frameId: 0 }).catch(() => null);
  async function inject(tabId) {
    const tab = await api.tabs.get(tabId);
    // Chrome may omit extension-page URLs from tabs.get without the tabs permission.
    // An already-running bundled controller is sufficient; no injection is attempted.
    if (!tab.url || (api.runtime?.getURL &&
        new URL(tab.url).href.split('?')[0] === api.runtime.getURL('pdf/viewer.html'))) {
      const state = await api.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 }).catch(() => null);
      if (state && typeof state.translated === 'boolean') return { ok: true, injected: true };
      if (tab.url) return { ok: false, reason: 'restricted' };
    }
    if (tab.url && !injectableURL(tab.url)) return { ok: false, reason: 'restricted' };
    const url = tab.url || '';
    // Observe future timedtext requests after explicit activation, without a static page hook.
    if (/^https:\/\/(www|m)\.youtube\.com\//.test(url)) await api.scripting.executeScript({
      target: { tabId, frameIds: [0] }, files: ['content/subtitles/observer.js'], world: 'MAIN',
    });
    if (!(await ready(tabId))?.ok) {
      await api.scripting.insertCSS({ target: { tabId, frameIds: [0] }, files: ['styles/content.css'] });
      await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/loader.js'] });
    }
    const result = await ready(tabId);
    return result?.ok ? { ok: true, injected: true } : { ok: false, reason: /\.pdf(?:[?#]|$)/i.test(url) ? 'restricted' : 'injection-failed' };
  }
  return { ensure(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return Promise.resolve({ ok: false, reason: 'no-access' });
    if (!pending.has(tabId)) {
      const task = inject(tabId).catch(() => ({ ok: false, reason: 'no-access' })).finally(() => pending.delete(tabId));
      pending.set(tabId, task);
    }
    return pending.get(tabId);
  } };
}

import { ExtensionTranslateClient } from './port-client.js';
import { createChromeStorageArea, withLocalFallback } from './storage.js';
import { createPlatformSettingsStore } from './settings-store.js';
import { createFetchHttp } from './http.js';
import { ERR } from '../shared/protocol.js';

export function createExtensionPlatform(api = globalThis.chrome) {
  const localArea = createChromeStorageArea(api.storage, 'local');
  const syncArea = withLocalFallback(createChromeStorageArea(api.storage, 'sync'), localArea);
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches || false;
  const one = async (msg) => {
    try { return await api.runtime.sendMessage(msg) || { ok: false, error: { code: ERR.NETWORK, message: '后台没有响应' } }; }
    catch { return { ok: false, error: { code: ERR.NETWORK, message: '与后台的连接中断，请刷新页面' } }; }
  };
  const platform = {
    kind: 'extension', coarse, syncArea, localArea,
    comics: {
      recognize: (req) => one({ ...req, type: 'comic-ocr' }),
      languages: (lang) => one(lang ? { type:'comic-languages-delete',lang } : { type:'comic-languages-list' }),
    },
    // HTTP is only available in the worker. Content uses translator() messaging.
    http(req) {
      if (typeof document !== 'undefined') return Promise.reject(new Error('HTTP requires the extension service worker'));
      return createFetchHttp(globalThis.fetch)(req);
    },
    translator() {
      const client = new ExtensionTranslateClient(api);
      return {
        translateBatch(req, onPartial) {
          let resolve;
          const done = new Promise((r) => { resolve = r; });
          const id = client.request(req, { onResults: onPartial, onDone: resolve });
          return { done, cancel() { client.cancel(id); resolve(); } };
        },
        translateText: (req) => one({ ...req, type: 'translate-text' }),
        listModels: (profileId) => one({ type: 'list-models', profileId }),
        testProvider: (profileId) => one({ type: 'provider-test', profileId }),
        dispose: () => client.dispose(),
      };
    },
    detectLanguage(text) {
      return new Promise((resolve) => {
        const mapped = (r) => resolve(r?.languages?.[0] ? {
          lang: r.languages[0].language, reliable: !!r.isReliable, percentage: r.languages[0].percentage ?? 100,
        } : null);
        try {
          const p = api.i18n.detectLanguage(text, mapped);
          p?.then(mapped, () => resolve(null));
        } catch { resolve(null); }
      });
    },
    openSettings: () => { void one({ type: 'open-options' }); },
    registerCommand() { /* Manifest commands are routed through onMessage below. */ },
    onMessage(cb) {
      const listener = (msg, sender, reply) => {
        if (sender.id && sender.id !== api.runtime.id) return false;
        return cb(msg, reply);
      };
      api.runtime.onMessage.addListener(listener);
      return () => api.runtime.onMessage.removeListener(listener);
    },
    valid: () => !!api.runtime?.id,
  };
  platform.settingsStore = createPlatformSettingsStore(platform);
  return platform;
}

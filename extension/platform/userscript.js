import { createGMStorageArea } from './storage.js';
import { createGMHttp, asFetch } from './http.js';
import { createPlatformSettingsStore } from './settings-store.js';
import { createStoredCache } from './cache.js';
import { createProviders } from '../background/providers.js';
import { createQueue } from '../background/queue.js';
import { createTranslator } from '../background/translator.js';
import { createHandlers } from '../background/handlers.js';
import { toErrorInfo } from '../shared/errors.js';
import { looksLikeTarget } from '../shared/lang.js';

export function createUserscriptPlatform(gm, { openSettings = () => {}, coarse = false } = {}) {
  const syncArea = createGMStorageArea(gm, 'duallens:sync');
  const localArea = createGMStorageArea(gm, 'duallens:local');
  const platform = {
    kind: 'userscript', coarse, syncArea, localArea,
    http: createGMHttp(gm.xmlhttpRequest),
    openSettings, valid: () => true,
    registerCommand(_id, label, handler) { gm.registerMenuCommand(label, handler); },
    async detectLanguage(text) {
      for (const lang of ['ja', 'ko', 'zh-CN', 'ru', 'ar', 'th', 'en']) {
        if (looksLikeTarget(text, lang)) return { lang, reliable: true };
      }
      return null;
    },
    injectStyle(css) {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).append(style);
      return () => style.remove();
    },
  };
  const store = platform.settingsStore = createPlatformSettingsStore(platform);
  const getSettings = async () => {
    const s = await store.load();
    for (const p of s.provider.profiles) p.apiKey = await store.getSecret(p.id);
    return s;
  };
  const providers = createProviders({ fetchImpl: asFetch(platform.http) });
  const cache = createStoredCache(localArea);
  const translator = createTranslator({ provider: providers.chat, cache, queue: createQueue(), getSettings });
  const handlers = createHandlers({ translator, cache, providers, getSettings });
  let seq = 0;
  platform.translator = () => ({
    translateBatch(req, onPartial) {
      const ctrl = new AbortController();
      const seen = new Set();
      const done = translator.translate({ ...req, reqId: 'gm-' + ++seq }, {
        signal: ctrl.signal, onPartial(results) { for (const r of results) seen.add(r.id); onPartial(results); },
      }).catch((e) => {
        if (!ctrl.signal.aborted) onPartial(req.items.filter((i) => !seen.has(i.id)).map((i) => ({ id: i.id, error: toErrorInfo(e) })));
      });
      return { cancel: () => ctrl.abort(), done };
    },
    translateText: (req) => handlers['translate-text'](req),
    listModels: (profileId) => handlers['list-models']({ profileId }),
    testProvider: (profileId) => handlers['provider-test']({ profileId }),
  });
  return platform;
}

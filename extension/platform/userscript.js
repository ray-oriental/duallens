import { createGMStorageArea } from './storage.js';
import { createGMHttp, asFetch } from './http.js';
import { performanceSettings } from './settings-store.js';
import { createSettingsStore, publicSettings } from '../shared/settings.js';
import { createStoredCache } from './cache.js';
import { createProviders } from '../background/providers.js';
import { createQueue } from '../background/queue.js';
import { createTranslator } from '../background/translator.js';
import { createHandlers } from '../background/handlers.js';
import { toErrorInfo } from '../shared/errors.js';
import { looksLikeTarget } from '../shared/lang.js';

export function createUserscriptPlatform(gm, { openSettings = () => {}, coarse = false } = {}) {
  const localArea = createGMStorageArea(gm, 'duallens:local');
  // GM is private per-script storage, not browser sync. Both v2 areas share one record.
  const syncArea = localArea;
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
  const store = platform.settingsStore = createSettingsStore({ syncArea, localArea });
  // The transitional userscript kept public v1 settings in another GM namespace.
  // Move them once without overwriting existing v2 settings or local secrets.
  platform.ready = (async () => {
    const current = await localArea.get(['settings.core', 'settings']);
    if (!current['settings.core'] && !current.settings) {
      const old = await gm.getValue('duallens:sync', {});
      if (old?.settings) {
        const existing = (await localArea.get('secrets')).secrets || {};
        for (const p of old.settings.provider?.profiles || []) {
          if (p.apiKey && !Object.hasOwn(existing, p.id)) await store.setSecret(p.id, p.apiKey);
        }
        await store.save(publicSettings(old.settings));
      }
    }
    await store.load();
  })();
  const getSettings = async () => {
    await platform.ready;
    return performanceSettings(await store.load(), coarse);
  };
  const getSecret = id => store.getSecret(id);
  const providers = createProviders({ fetchImpl: asFetch(platform.http), getSecret });
  const cache = createStoredCache(localArea);
  const translator = createTranslator({ provider: providers.chat, cache, queue: createQueue(), getSettings, getSecret });
  const handlers = createHandlers({ translator, cache, providers, getSettings });
  platform.clearCache = () => cache.clear();
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
    listModels: (profileId, options = {}) => handlers['list-models']({ ...options, profileId }),
    testProvider: (profileId) => handlers['provider-test']({ profileId }),
  });
  return platform;
}

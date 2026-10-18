import { ExtensionTranslateClient } from './port-client.js';
import { chromeStorageArea } from '../shared/storage-areas.js';
import { createSettingsStore } from '../shared/settings.js';
import { createFetchHttp } from './http.js';
import { ERR } from '../shared/protocol.js';
import { observeTimedtext, fetchTimedtext } from '../content/subtitles/observe.js';
import { originalTrackURL } from '../content/subtitles/track.js';

export function createExtensionPlatform(api = globalThis.chrome) {
  const localArea = chromeStorageArea(api.storage.local, 'local', api.storage.onChanged);
  const syncArea = api.storage.sync && chromeStorageArea(api.storage.sync, 'sync', api.storage.onChanged);
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches || false;
  const one = async (msg) => {
    try { return await api.runtime.sendMessage(msg) || { ok: false, error: { code: ERR.NETWORK, message: '后台没有响应' } }; }
    catch { return { ok: false, error: { code: ERR.NETWORK, message: '与后台的连接中断，请刷新页面' } }; }
  };
  const platform = {
    kind: 'extension', coarse, syncArea, localArea,
    frameSnapshot: () => one({type:'frame-snapshot'}),
    subtitles: {
      observe: observeTimedtext,
      async fetchTrack(raw, { signal } = {}) {
        const url = originalTrackURL(raw, location.href);
        if (!url) throw new Error('字幕轨道地址无效');
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (new URL(url).origin === location.origin) return fetchTimedtext(url, { signal });
        const id = 'subtitle-' + crypto.randomUUID();
        const cancel = () => { void one({ type: 'subtitle-track-cancel', id }); };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          const result = await one({ type: 'subtitle-track', id, url });
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (!result.ok) throw new Error('字幕轨道读取失败');
          return result.data;
        } finally { signal?.removeEventListener('abort', cancel); }
      },
    },
    openTextTranslation: () => { void one({ type: 'open-sidepanel' }); },
    comics: {
      recognize: (req) => one({ ...req, type: 'comic-ocr' }),
      languages: (lang) => one(lang ? { type:'comic-languages-delete',lang } : { type:'comic-languages-list' }),
      syncSites:()=>one({type:'comic-canvas-sites-sync'}),
    },
    promptSecret() { return null; },
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
        listModels: (profileId, options = {}) => one({ ...options, type: 'list-models', profileId }),
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
  platform.settingsStore = createSettingsStore({ syncArea, localArea });
  return platform;
}

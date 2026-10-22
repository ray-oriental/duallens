import { t as l10n, registerMessages, setUiLanguage } from '../shared/i18n.js';
import { createGMStorageArea } from './storage.js';
import { createGMHttp, asFetch } from './http.js';
import { performanceSettings } from './settings-store.js';
import { createSettingsStore, publicSettings } from '../shared/settings.js';
import { createStoredCache } from './cache.js';
import { createProviders } from '../background/providers.js';
import { createQueue } from '../background/queue.js';
import { createTranslator } from '../background/translator.js';
import { createMT, MT_LIMITS } from '../background/mt.js';
import { createHandlers } from '../background/handlers.js';
import { toErrorInfo } from '../shared/errors.js';
import { looksLikeTarget } from '../shared/lang.js';
import { createGMImageFetch, probeLocalOCR } from '../content/comics/capabilities.js';
import { createUserscriptOCR } from '../content/comics/userscript-ocr.js';
import { comicSiteMatches, imageReferer } from '../content/comics/sites.js';
import { installCanvasHook } from '../content/comics/canvas-hook-runtime.js';
import { installTimedtextObserver } from '../content/subtitles/observer-runtime.js';
import { observeTimedtext, fetchTimedtext, fetchGMCrossHostTrack } from '../content/subtitles/observe.js';
import { isYouTube, originalTrackURL } from '../content/subtitles/track.js';
import { createSettingsFormLoader, SETTINGS_RESOURCE_ERROR } from '../userscript/settings-resource.js';
import { toast } from '../content/overlay.js';

// Capture the sandbox's native prompt before any awaits; never use host-page prompt.
const sandboxPrompt = typeof prompt === 'function' ? prompt.bind(globalThis) : null;

export function createUserscriptPlatform(gm, { openSettings = () => {}, coarse = false, localOCR = null, promptImpl = sandboxPrompt } = {}) {
  const localArea = createGMStorageArea(gm, 'duallens:local');
  const syncArea = localArea;
  const ocr = createUserscriptOCR({ storage: createGMStorageArea(gm, 'duallens:ocr'), xmlhttpRequest: gm.xmlhttpRequest, getResourceText: gm.getResourceText });

  const platform = {
    kind: 'userscript', coarse, syncArea, localArea,
    subtitles: {
      observe: observeTimedtext,
      fetchTrack(raw, options) {
        const url = originalTrackURL(raw, location.href);
        if (!url) return Promise.reject(new Error(l10n('m63')));
        return new URL(url).origin === location.origin ? fetchTimedtext(url, options) :
          fetchGMCrossHostTrack(url, options, platform.http);
      },
    },
    comics: {
      async recognize(req) {
        try {
          const capability=await probeLocalOCR();
          if (!capability.ok) return { ok:false,error:{ code:'ocr_unavailable',message:capability.reason } };
          const settings=await store.load();setUiLanguage(settings.uiLanguage);
          const blob=await createGMImageFetch(gm.xmlhttpRequest)(req.url,imageReferer(settings,location.href,req.url));
          return await (localOCR || ocr.recognize)(blob,{ lang:req.lang });
        } catch(e) { return { ok:false,error:{ code:'image_unavailable',message:e.message } }; }
      },
      languages: (lang) => ocr.languages(lang),
      async syncSites() {
        const settings=await store.load();setUiLanguage(settings.uiLanguage);
        // Changing opt-in takes effect on the next document; do not patch the current page here.
        return {ok:true,sites:settings.comics.canvasSites};
      },
    },
    http: createGMHttp(gm.xmlhttpRequest),
    openSettings, valid: () => true,
    promptSecret(label) { return promptImpl ? promptImpl(String(label), '') : null; },
    registerCommand(id, label, handler) {
      gm.registerMenuCommand(label, handler);
      if (id === 'open-sidepanel' && typeof document !== 'undefined') document.addEventListener('keydown', event => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyS') {
          event.preventDefault(); handler();
        }
      });
    },
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
  const loadResource = createSettingsFormLoader(gm.getResourceText);
  const loadSettingsForm = async () => {
    const mount = await loadResource();
    registerMessages(mount.messages);
    const pref=(await store.load()).uiLanguage;setUiLanguage(pref);mount.setUiLanguage(pref);
    return mount;
  };
  platform.loadSettingsForm = loadSettingsForm;
  platform.showResourceError = () => toast(SETTINGS_RESOURCE_ERROR());
  let mediaPanel;
  const openPanel = async tab => {
    try {
      const mount = await loadSettingsForm();
      mediaPanel ||= mount.createMediaPanel(platform, { loadSettingsForm });
      return await mediaPanel.open(tab);
    } catch { platform.showResourceError(); }
  };
  platform.openSettings = group => { platform.settingsGroup = group || 'common'; void openPanel('settings'); };
  platform.openTextTranslation = () => { void openPanel('text'); };
  // The transitional userscript kept public v1 settings in another GM namespace.
  // Move them once without overwriting existing v2 settings or local secrets.
  platform.ready = (async () => {
    if (typeof document !== 'undefined' && isYouTube(location.hostname)) {
      const script = document.createElement('script');
      try {
        script.textContent = '(' + installTimedtextObserver.toString() + ')();';
        (document.head || document.documentElement).append(script);
      } catch {
        // CSP / Trusted Types can reject MAIN installation. The passive resource
        // observer remains usable; this must not prevent the whole app from booting.
      } finally { script.remove(); }
    }
    const current = await localArea.get(['settings.core', 'settings']);
    if (!current['settings.core'] && !current.settings) {
      const old = await gm.getValue('duallens:sync', {});
      if (old?.settings) {
        const existing = (await localArea.get('secrets')).secrets || {};
        for (const p of old.settings.provider?.profiles || []) {
          if (p.apiKey && !Object.hasOwn(existing, p.id)) await store.setSecret(p.id, p.apiKey);
        }
        await store.save({ ...publicSettings(old.settings), version: old.settings.version ?? 1 });
      }
    }
    await store.load();
    const settings=await store.load();setUiLanguage(settings.uiLanguage);
    if(typeof document!=='undefined' && settings.comics.enabled && comicSiteMatches(location.hostname,settings.comics.canvasSites)) {
      const script=document.createElement('script');script.textContent='('+installCanvasHook.toString()+')();';
      (document.head || document.documentElement).append(script);script.remove();
    }
  })();
  const getSettings = async () => {
    await platform.ready;
    const settings=performanceSettings(await store.load(), coarse);
    // Never persist a translation when the manager cannot establish a normal context.
    return gm.info?.isIncognito===false ? settings : {...settings,cache:{...settings.cache,enabled:false}};
  };
  const getSecret = id => store.getSecret(id);
  const providers = createProviders({ fetchImpl: asFetch(platform.http), getSecret });
  const cache = createStoredCache(localArea);
  // Machine translation goes through the same anonymous GM transport as the model providers.
  const translator = createTranslator({ provider: providers.chat, cache, queue: createQueue(), getSettings, getSecret,
    mt: createMT({ fetchImpl: asFetch(platform.http), getSecret,
      limits: coarse ? { ...MT_LIMITS, maxItems: 12, concurrency: 2 } : MT_LIMITS }) });
  const handlers = createHandlers({ translator, cache, providers, getSettings });
  platform.clearCache = () => cache.clear();
  let seq = 0;
  platform.translator = () => ({
    translateBatch(req, onPartial) {
      const ctrl = new AbortController();
      const seen = new Set();
      const done = translator.translate({ ...req, reqId: 'gm-' + ++seq }, {
        signal: ctrl.signal, onPartial(results) { for (const r of results) if (r.stage !== 'draft') seen.add(r.id); onPartial(results); },
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

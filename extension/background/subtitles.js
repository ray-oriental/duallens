import { t as l10n } from '../shared/i18n.js';
import { originalTrackURL } from '../content/subtitles/track.js';
import { readTimedtextResponse } from '../content/subtitles/observe.js';

// Only cross-www/m caption GETs use worker transport to avoid content CORS.
// This is deliberately not a general HTTP message endpoint.
const TEXT = { get permission(){return l10n('m25');} };
export function createSubtitleHandlers({ fetchImpl = (...args) => globalThis.fetch(...args), api } = {}) {
  const active = new Map();
  const keyFor = (msg, sender) => {
    if (sender?.tab?.id == null || sender.frameId !== 0 || typeof msg.id !== 'string' || !/^[\w-]{1,64}$/.test(msg.id)) return null;
    return JSON.stringify([sender.tab.id, sender.documentId || sender.url, msg.id]);
  };
  return {
    async 'subtitle-track'(msg, sender) {
      const key = keyFor(msg, sender);
      // Chrome's sender.url can retain the document's original URL across a
      // same-document SPA navigation; tab.url describes the current video.
      const url = originalTrackURL(msg.url, sender?.tab?.url || sender?.url || '');
      if (!key || !url || active.size >= 16) return { ok: false, error: { code: 'config', get message(){return l10n('m26');} } };
      if (api && !(await api.permissions.contains({ origins: [new URL(url).origin + '/*'] }))) {
        return { ok: false, error: { code: 'permission', message: TEXT.permission } };
      }
      active.get(key)?.abort();
      const controller = new AbortController(); active.set(key, controller);
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
        const data = await readTimedtextResponse(response);
        return { ok: true, data };
      } catch { return { ok: false, error: { code: 'network', get message(){return l10n('m27');} } }; }
      finally { clearTimeout(timer); if (active.get(key) === controller) active.delete(key); }
    },
    'subtitle-track-cancel'(msg, sender) {
      const key = keyFor(msg, sender); if (key) active.get(key)?.abort();
      return Promise.resolve({ ok: !!key });
    },
  };
}

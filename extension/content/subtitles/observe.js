import { t as l10n } from '../../shared/i18n.js';
import { isYouTube, originalTrackURL } from './track.js';

// Resource timing is a passive fallback for requests before userscript document-idle
// and for CSPs that reject its inline MAIN installer. No webpage response is altered.
export function observeTimedtext(callback, win = window) {
  if (!isYouTube(win.location.hostname)) return () => {};
  let last = '';
  const accept = (raw) => {
    const url = originalTrackURL(raw, win.location.href);
    if (!url || url === last) return;
    last = url;
    callback(url);
  };
  const message = (event) => {
    if (event.source !== win || event.origin !== win.location.origin ||
        event.data?.channel !== 'duallens-timedtext') return;
    accept(event.data.url);
  };
  win.addEventListener('message', message);
  let observer;
  try {
    observer = new win.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) accept(entry.name);
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch { /* Older browsers still use the MAIN notification. */ }
  for (const entry of win.performance.getEntriesByType('resource')) accept(entry.name);
  win.postMessage({ channel: 'duallens-timedtext-ready' }, win.location.origin);
  return () => { win.removeEventListener('message', message); observer?.disconnect(); };
}

export async function fetchTimedtext(raw, { signal } = {}) {
  const url = originalTrackURL(raw, location.href);
  if (!url) throw new Error(l10n('m63'));
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  return readTimedtextResponse(response);
}

export async function readTimedtextResponse(response) {
  const size = Number(response.headers.get('content-length'));
  if (!response.ok || size > 4 * 1024 * 1024) {
    await response.body?.cancel().catch(() => {});
    throw new Error(l10n('m64'));
  }
  // Bound the body while streaming, rather than allocating an arbitrary response.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error(l10n('m65'));
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function fetchGMCrossHostTrack(raw, { signal } = {}, http, base = location.href) {
  const url = originalTrackURL(raw, base);
  if (!url) throw new Error(l10n('m63'));
  const response = await http({ url, method: 'GET', headers: {}, signal, timeoutMs: 20000 });
  if (response.status !== 200 || new TextEncoder().encode(response.text).byteLength > 4 * 1024 * 1024) {
    throw new Error(l10n('m66'));
  }
  return JSON.parse(response.text);
}

// Only public YouTube timedtext addresses cross the page-world boundary. They are
// untrusted hints, never provider requests, configuration, credentials or commands.
export function isYouTube(host) {
  return host === 'www.youtube.com' || host === 'm.youtube.com';
}

export function originalTrackURL(raw, base = 'https://www.youtube.com/') {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const url = new URL(raw, base);
    const page = new URL(base);
    if (!isYouTube(page.hostname) || page.protocol !== 'https:' || !isYouTube(url.hostname) || url.port || url.protocol !== 'https:' ||
        url.username || url.password || url.pathname !== '/api/timedtext') return null;
    const video = page.searchParams.get('v') || page.pathname.match(/^\/shorts\/([^/]+)$/)?.[1];
    if (video && url.searchParams.get('v') !== video) return null;
    url.searchParams.delete('tlang');
    url.searchParams.set('fmt', 'json3');
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export const SUBTITLE_DEFAULTS = Object.freeze({ enabled: false, mode: 'bilingual', fontSize: 22, position: 'bottom' });

export function subtitleOptions(settings = {}) {
  const value = settings.subtitles || {};
  const size = Number(value.fontSize);
  return {
    enabled: value.enabled === true,
    mode: value.mode === 'translation-only' ? 'translation-only' : 'bilingual',
    fontSize: Number.isFinite(size) ? Math.min(48, Math.max(16, size)) : 22,
    position: value.position === 'top' ? 'top' : 'bottom',
  };
}

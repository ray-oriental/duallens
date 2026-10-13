// Original MAIN-world observer. Kept identical to observer-runtime.js by unit test.
(function installTimedtextObserver() {
  if (!['www.youtube.com', 'm.youtube.com'].includes(location.hostname)) return;
  const marker = Symbol.for('duallens.youtube.observer');
  if (window[marker]) return;
  window[marker] = true;
  let last = null;
  const notify = (raw) => {
    try {
      const url = new URL(raw, location.href);
      if (!['www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.protocol !== 'https:' || url.port ||
          url.username || url.password || url.pathname !== '/api/timedtext' || url.href.length > 8192) return;
      last = url.href;
      window.postMessage({ channel: 'duallens-timedtext', url: last }, location.origin);
    } catch { /* Ignore malformed URLs without changing the page request. */ }
  };
  const fetch = window.fetch;
  if (typeof fetch === 'function') window.fetch = function(input, ...args) {
    try { notify(typeof input === 'string' || input instanceof URL ? String(input) : input?.url); }
    catch { /* A hostile URL getter must not prevent the original request. */ }
    return Reflect.apply(fetch, this, [input, ...args]);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    notify(url);
    return Reflect.apply(open, this, [method, url, ...args]);
  };
  window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.channel === 'duallens-timedtext-ready' && last) {
      window.postMessage({ channel: 'duallens-timedtext', url: last }, location.origin);
    }
  });
})();

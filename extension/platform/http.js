export function responseHeaders(raw = '') {
  const values = new Map();
  for (const line of String(raw).split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    values.set(name, values.has(name) ? values.get(name) + ', ' + value : value);
  }
  return { get: (name) => values.get(String(name).toLowerCase()) ?? null };
}

// The providers expect a fetch-shaped response. No webpage fetch is used by userscripts.
export function asFetch(http) {
  return async (url, options = {}) => {
    const res = await http({ url, method: options.method || 'GET', headers: options.headers,
      // Provider owns its timeout via AbortSignal (including longer gateway profiles).
      body: options.body, signal: options.signal, timeoutMs: 0 });
    return { status: res.status, headers: res.headers, text: async () => res.text };
  };
}

export function createGMHttp(xmlhttpRequest) {
  return ({ url, method = 'GET', headers = {}, body, timeoutMs = 60000, signal }) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    let handle;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      finish(reject, new DOMException('Aborted', 'AbortError'));
      handle?.abort();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid URL');
      handle = xmlhttpRequest({ url: target.href, method, headers, data: body, timeout: timeoutMs,
        anonymous: true, responseType: 'text',
        onload: (r) => finish(resolve, { status: r.status, headers: responseHeaders(r.responseHeaders), text: r.responseText || '' }),
        onerror: () => finish(reject, new Error('Network request failed')),
        ontimeout: () => finish(reject, new Error('Network request timed out')),
        onabort: () => finish(reject, new DOMException('Aborted', 'AbortError')),
      });
      if (signal?.aborted) abort();
    } catch { finish(reject, new Error('Network request failed')); }
  });
}

// This adapter is for a service-worker caller, never for userscript requests.
export function createFetchHttp(fetchImpl) {
  return async ({ url, method = 'GET', headers, body, timeoutMs = 60000, signal }) => {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      return { status: res.status, headers: res.headers, text: await res.text() };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
}

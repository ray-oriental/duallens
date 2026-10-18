// URL rules are local data, never regular expressions supplied by a website.
export function parsePattern(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2048 || /[\s?#@\\]/.test(text)) return null;
  const parts = /^(?:(https?):\/\/)?(\*\.)?(\[[a-f\d:]+\]|[a-z\d.-]+)(?::(\d+))?(\/.*)?$/i.exec(text);
  if (!parts) return null;
  const [, scheme, wild, rawHost, rawPort, path = ''] = parts;
  if (!rawHost.startsWith('[') && rawHost.split('.').some(s => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(s))) return null;
  if (rawPort && (+rawPort < 1 || +rawPort > 65535)) return null;
  let host;
  try { host = new URL('http://' + rawHost).hostname; } catch { return null; }
  // Reject URL parser rewrites such as shortened/hex IPv4 addresses.
  if (host !== rawHost.toLowerCase() || (wild && host.startsWith('['))) return null;
  return { protocol: scheme ? scheme.toLowerCase() + ':' : '', host, subdomains: !!wild,
    port: rawPort ? String(+rawPort) : '', path,
    pathLength: path.replaceAll('*', '').length,
    wildcards: (path.match(/\*/g) || []).length + (wild ? 1 : 0) };
}

function glob(pat, text) {
  let p = 0, t = 0, star = -1, retry = 0;
  while (t < text.length) {
    if (pat[p] === '*') { star = p++; retry = t; }
    else if (pat[p] === text[t]) { p++; t++; }
    else if (star >= 0) { p = star + 1; t = ++retry; }
    else return false;
  }
  while (pat[p] === '*') p++;
  return p === pat.length;
}

export function patternMatches(pat, url) {
  const p = parsePattern(pat);
  if (!p) return false;
  let u;
  try { u = new URL(String(url).includes('://') ? url : 'https://' + url); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  return (!p.protocol || p.protocol === u.protocol) &&
    (u.hostname === p.host || (p.subdomains && u.hostname.endsWith('.' + p.host))) &&
    (!p.port || p.port === (u.port || (u.protocol === 'https:' ? '443' : '80'))) &&
    (!p.path || glob(p.path, u.pathname));
}

// Positive means a is more specific. Exact ties preserve list order (never before always).
export function comparePatterns(a, b) {
  const x = parsePattern(a), y = parsePattern(b);
  if (!x || !y) return Number(!!x) - Number(!!y);
  return x.pathLength - y.pathLength || y.wildcards - x.wildcards ||
    x.host.length - y.host.length || Number(!!x.port) - Number(!!y.port) ||
    Number(!!x.protocol) - Number(!!y.protocol);
}

export function pathPattern(url) {
  const u = new URL(url), part = u.pathname.split('/')[1];
  return u.host + (part ? '/' + part : '') + '/*';
}

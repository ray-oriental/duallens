// Optional host permissions. DualLens asks for broad page access only when the user turns on something
// that has to be present on pages before they ask (auto-translate rules, float ball, selection icon,
// hover, input box, cross-origin frames, image text). Clicking the toolbar button, a shortcut or a
// context-menu entry works without it, through activeTab.
// In the userscript there is no permission system: every check resolves to true.

export const BROAD = Object.freeze({ origins: ['<all_urls>'] });

export const PERSISTENT_FEATURES = Object.freeze(['alwaysRules', 'floatBall', 'selection', 'hover', 'input','subtitles', 'frames', 'comics']);

export function featureNeedsBroad(feature) {
  return PERSISTENT_FEATURES.includes(feature);
}

// 'https://api.example.com:8443/v1' -> 'https://api.example.com:8443/*'
export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

const permissionsApi = (api) => api?.permissions || globalThis.chrome?.permissions || null;

export async function hasBroad(api) {
  const p = permissionsApi(api);
  return p ? p.contains(BROAD) : true;
}

// Must run inside a user gesture on an extension page (popup / options): the browser shows its prompt.
export async function requestBroad(api) {
  const p = permissionsApi(api);
  return p ? p.request(BROAD) : true;
}

export async function hasOrigin(url, api) {
  const p = permissionsApi(api);
  const pattern = originPattern(url);
  if (!pattern) return false;
  return p ? p.contains({ origins: [pattern] }) : true;
}

// Same gesture rule as requestBroad. Returns false for an unusable URL.
export async function requestOrigin(url, api) {
  const p = permissionsApi(api);
  const pattern = originPattern(url);
  if (!pattern) return false;
  return p ? p.request({ origins: [pattern] }) : true;
}

// Official MT hosts are optional, requested while saving or testing that engine.
export async function requestMTOrigin(engine, api) {
  const urls = engine === 'deepl' ? ['https://api.deepl.com','https://api-free.deepl.com']
    : engine === 'microsoft-api' ? ['https://api.cognitive.microsofttranslator.com'] : [];
  const p = permissionsApi(api);
  return !p || !urls.length || p.request({origins:urls.map(originPattern)});
}

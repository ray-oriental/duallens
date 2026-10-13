import { profileFromPreset } from '../../shared/presets.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { isPairingHost } from '../../background/providers.js';

export const PAIR_PREFIX = 'duallens-pair:v1:';
export const FREE_HERMES = new Set(['hermes/inclusionai/ling-3.1-flash', 'hermes/meituan/longcat-2.0:free', 'hermes/upstage/solar-mini4:free']);
export function pairingUrl(value) {
  if (typeof value !== 'string') throw new Error('配对地址无效');
  const u = new URL(value);
  if (u.protocol !== 'http:' || !isPairingHost(u.hostname) || !u.port || u.username || u.password || u.search || u.hash || !['', '/', '/v1'].includes(u.pathname)) throw new Error('配对地址必须是回环或 Tailscale IPv4 网关');
  return u.origin + '/v1';
}
export function parsePairing(text) {
  if (typeof text !== 'string' || text.length > 8192 || !text.startsWith(PAIR_PREFIX)) throw new Error('配对串格式无效');
  try {
    const encoded = text.slice(PAIR_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.token) || !Array.isArray(data.urls) || data.urls.length < 1 || data.urls.length > 2) throw new Error();
    const urls = data.urls.map(pairingUrl);
    const usb = urls.find(url => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
    const tailscale = urls.find(url => !['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
    if (!usb || (urls.length === 2 && !tailscale)) throw new Error();
    return { token: data.token, usb, tailscale };
  } catch { throw new Error('配对串无效；请重新复制终端中的完整配对串'); }
}
export function gatewayProfile(id, name, baseUrl) {
  return { ...profileFromPreset('gateway', id), name, baseUrl, model: 'ollama/qwen3:4b' };
}

// Import restores these documented defaults. Compact only the mobile backup, not stored settings.
export function compactConfig(settings) {
  const diff = (value, base) => {
    if (JSON.stringify(value) === JSON.stringify(base)) return undefined;
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base === 'object' && !Array.isArray(base)) {
      return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => {
        const changed = diff(v, base[key]); return changed === undefined ? [] : [[key, changed]];
      }));
    }
    return structuredClone(value);
  };
  const result = diff(settings, DEFAULT_SETTINGS) || {};
  result.provider ||= {};
  const shape = { ...DEFAULT_SETTINGS.provider.profiles[1], preset: '', requiresKey: false };
  result.provider.profiles = settings.provider.profiles.map(p => diff(p, shape) || {});
  return result;
}
export function gatewayChain(models, profileId) {
  const ids = [...new Set(models.map(m => typeof m === 'string' ? m : m.id).filter(m => typeof m === 'string'))];
  return [...ids.filter(id => id.startsWith('sjtu/')), ...ids.filter(id => FREE_HERMES.has(id)),
    ...ids.filter(id => id === 'ollama/qwen3:4b')].map(model => ({ profileId, model }));
}

export async function discoverGateway(http) {
  const get = async path => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await http({ url: 'http://127.0.0.1:18790' + path, method: 'GET', headers: { Accept: 'application/json' }, timeoutMs: 3000, signal: controller.signal });
      if (res.status !== 200) throw new Error('本机网关未响应；请先启动网关');
      return JSON.parse(typeof res.text === 'function' ? await res.text() : res.text);
    } finally { clearTimeout(timer); }
  };
  const health = await get('/health');
  if (health?.ok !== true || health.name !== 'DualLens') throw new Error('该端口不是 DualLens 网关');
  const models = await get('/v1/models');
  if (!Array.isArray(models.data)) throw new Error('网关模型列表无效');
  return models.data;
}

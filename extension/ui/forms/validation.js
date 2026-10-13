// Extend the shared form's endpoint policy without changing other colleagues' UI entry points.
import { validateSettings as validateBase, importSettings as importBase, lines, terms } from '../validation.js';
import { isPairingHost } from '../../background/providers.js';
export { lines, terms };

function adapt(settings) {
  const copy = structuredClone(settings), remoteIds = new Set();
  for (const p of copy.provider?.profiles || []) {
    if (p.kind !== 'gateway' || !p.baseUrl) continue;
    const u = new URL(p.baseUrl);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && isPairingHost(u.hostname) && u.protocol === 'http:' && u.port && u.pathname === '/v1' && !u.username && !u.password && !u.hash && !u.search) {
      remoteIds.add(p.id); p.kind = 'openai';
    }
  }
  return { copy, remoteIds };
}
function restore(settings, ids) {
  for (const p of settings.provider.profiles) if (ids.has(p.id)) p.kind = 'gateway';
  return settings;
}
export function validateSettings(settings) {
  const { copy, remoteIds } = adapt(settings);
  return restore(validateBase(copy), remoteIds);
}
export function importSettings(settings, current) {
  const { copy, remoteIds } = adapt(settings);
  return restore(importBase(copy, current), remoteIds);
}

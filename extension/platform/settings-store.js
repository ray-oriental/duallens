// Runtime-only mobile limits. Persisted settings and shared forms retain user values.
import { mergeSettings } from '../shared/settings.js';

// Chrome storage may reorder object properties. Arrays still carry meaningful order.
export function settingsEqual(a, b) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function performanceSettings(settings, coarse = false) {
  if (!coarse) return settings;
  const next = mergeSettings(settings, {});
  next.lazy.rootMarginPx = Math.min(next.lazy.rootMarginPx, 400);
  next.provider.profiles = next.provider.profiles.map((p) => ({
    ...p, concurrency: Math.min(p.concurrency || 2, 2), maxItems: Math.min(p.maxItems || 12, 12),
  }));
  return next;
}

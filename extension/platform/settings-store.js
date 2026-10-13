// Temporary v1 seam. Replace this factory with shared/createSettingsStore when v2 is merged.
// Content reads public settings only; keys are hydrated solely inside the translation service.
import { DEFAULT_SETTINGS, mergeSettings, SETTINGS_KEY } from '../shared/settings.js';

export function performanceSettings(settings, coarse = false) {
  if (!coarse) return settings;
  const next = mergeSettings(settings, {});
  next.lazy.rootMarginPx = Math.min(next.lazy.rootMarginPx, 400);
  next.provider.profiles = next.provider.profiles.map((p) => ({
    ...p, concurrency: Math.min(p.concurrency || 2, 2), maxItems: Math.min(p.maxItems || 12, 12),
  }));
  return next;
}

export function createPlatformSettingsStore({ syncArea, localArea, kind, coarse = false }) {
  // Preserve the extension's v1 storage behavior until the settings owner migrates it.
  const area = kind === 'extension' ? localArea : syncArea;
  const listeners = new Set();
  let writes = Promise.resolve();
  let secretWrites = Promise.resolve();

  async function load() {
    const got = await area.get(SETTINGS_KEY);
    const settings = mergeSettings(DEFAULT_SETTINGS, got[SETTINGS_KEY] || {});
    // Never pass stored credentials into content/UI objects.
    for (const p of settings.provider.profiles) delete p.apiKey;
    return performanceSettings(settings, coarse);
  }
  async function getSecret(id) {
    const got = await localArea.get(['secrets', SETTINGS_KEY]);
    const secret = got.secrets?.[id]?.apiKey;
    if (typeof secret === 'string') return secret;
    // Extension v1 compatibility, without rewriting another owner's settings.
    return kind === 'extension' ? got[SETTINGS_KEY]?.provider?.profiles?.find((p) => p.id === id)?.apiKey || '' : '';
  }
  function setSecret(id, key) {
    const run = async () => {
      const got = await localArea.get('secrets');
      await localArea.set({ secrets: { ...got.secrets, [id]: { apiKey: String(key || '') } } });
    };
    const result = secretWrites.then(run, run);
    secretWrites = result.catch(() => {});
    return result;
  }
  function save(patch) {
    const run = async () => {
      const got = await area.get(SETTINGS_KEY);
      const next = mergeSettings(mergeSettings(DEFAULT_SETTINGS, got[SETTINGS_KEY] || {}), patch);
      if (kind !== 'extension') {
        for (const p of next.provider.profiles) {
          if (p.apiKey) await setSecret(p.id, p.apiKey);
          delete p.apiKey;
        }
      }
      await area.set({ [SETTINGS_KEY]: next });
      return load();
    };
    const result = writes.then(run, run);
    writes = result.catch(() => {});
    return result;
  }
  area.onChanged((changes) => {
    if (changes[SETTINGS_KEY]) load().then((s) => { for (const cb of listeners) cb(s); }).catch(() => {});
  });
  return { load, save, getSecret, setSecret, onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); } };
}

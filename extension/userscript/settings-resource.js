import { t as l10n } from '../shared/i18n.js';
import { sha256Digest } from '../shared/hash.js';
// Replaced by the packer; no generated descriptor or resource is written into source.
const RESOURCE = '__DUALLENS_SETTINGS_RESOURCE__';
export const SETTINGS_RESOURCE_ERROR = () => l10n('mkb');

// The release asset is checked with the shared SHA-256 (falls back to pure JS on HTTP pages);
// configuration encryption still needs Web Crypto.
export { sha256Digest as resourceDigest };

export function createSettingsFormLoader(getResourceText, spec = RESOURCE) {
  const read = createResourceLoader(getResourceText, spec, module => typeof module?.mountSettingsForm === 'function', SETTINGS_RESOURCE_ERROR);
  let pending;
  return () => pending ||= read().then(module => {
    module.mountSettingsForm.version=spec.version || spec.url?.match(/\/v([^/]+)\/duallens-settings\.js$/)?.[1] || null;
    return module.mountSettingsForm;
  }).catch(error => { pending = null; throw error; });
}

export function createResourceLoader(getResourceText, spec, validate, errorMessage) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(async () => {
      try {
        const source = await getResourceText?.(spec.name);
        if (typeof source !== 'string' || !source) throw new Error();
        const bytes = new TextEncoder().encode(source);
        if (bytes.length !== spec.bytes || await sha256Digest(bytes) !== spec.sha256) throw new Error();
        // Only the pinned, verified release code runs in this sandbox. No DOM script/global bridge.
        const module = new Function('return (\n' + source.trim().replace(/;$/, '') + '\n);')();
        if (!validate(module)) throw new Error();
        return module;
      } catch { pending = null; throw new Error(errorMessage()); }
    });
    return pending;
  };
}

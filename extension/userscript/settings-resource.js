import { sha256Digest } from '../shared/hash.js';
// Replaced by the packer; no generated descriptor or resource is written into source.
const RESOURCE = '__DUALLENS_SETTINGS_RESOURCE__';
export const SETTINGS_RESOURCE_ERROR = '设置资源缺失或校验失败，请重新安装用户脚本（从官方 Release 安装，并允许 Tampermonkey 缓存资源）。';

// The release asset is checked with the shared SHA-256 (falls back to pure JS on HTTP pages);
// configuration encryption still needs Web Crypto.
export { sha256Digest as resourceDigest };

export function createSettingsFormLoader(getResourceText, spec = RESOURCE) {
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
        if (typeof module?.mountSettingsForm !== 'function') throw new Error();
        return module.mountSettingsForm;
      } catch { pending = null; throw new Error(SETTINGS_RESOURCE_ERROR); }
    });
    return pending;
  };
}

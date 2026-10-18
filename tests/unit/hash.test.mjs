import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, sha256Digest } from '../../extension/shared/hash.js';

// Plain-HTTP pages have no crypto.subtle; the userscript must still hash (cache keys, resource checks).
async function withoutSubtle(fn) {
  const saved = globalThis.crypto.subtle;
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
  try { return await fn(); } finally { Object.defineProperty(globalThis.crypto, 'subtle', { value: saved, configurable: true }); }
}

test('sha256 fallback matches Web Crypto, including the empty string and multi-block input', async () => {
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const text of ['', 'abc', 'DualLens 双语对照', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000)]) {
    assert.equal(await withoutSubtle(() => sha256Hex(text)), await sha256Hex(text), JSON.stringify(text.slice(0, 12)));
  }
  const bytes = new Uint8Array(200000).map((_, i) => i * 31);
  assert.equal(await withoutSubtle(() => sha256Digest(bytes)), await sha256Digest(bytes));
});

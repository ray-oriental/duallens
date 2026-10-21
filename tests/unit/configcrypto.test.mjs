import test from 'node:test';
import assert from 'node:assert/strict';
import { exportConfig, importConfig, PBKDF2_ITERATIONS, CONFIG_PREFIX } from '../../extension/shared/configcrypto.js';
import { DEFAULT_SETTINGS } from '../../extension/shared/settings.js';

test('encrypted export roundtrip uses randomized salt/IV and includes local secrets only inside ciphertext', async () => {
  const secrets = { openai: { apiKey: 'sk-test-not-real' } };
  const options = { password: 'test passphrase', secrets };
  const a = await exportConfig(DEFAULT_SETTINGS, options), b = await exportConfig(DEFAULT_SETTINGS, options);
  assert.ok(PBKDF2_ITERATIONS >= 310000); assert.ok(a.startsWith(CONFIG_PREFIX)); assert.notEqual(a, b);
  assert.equal(a.includes('sk-test-not-real'), false);
  const decoded = await importConfig(a, options.password);
  assert.deepEqual(decoded.settings, DEFAULT_SETTINGS); assert.deepEqual(decoded.secrets, secrets);
});
test('wrong password, altered ciphertext, IV, salt, malformed envelope and empty password fail closed', async () => {
  const encrypted = await exportConfig(DEFAULT_SETTINGS, { password: 'correct passphrase' });
  await assert.rejects(importConfig(encrypted, 'wrong passphrase'), /口令错误/);
  await assert.rejects(importConfig(encrypted), /口令/);
  const raw = Buffer.from(encrypted.slice(CONFIG_PREFIX.length), 'base64url');
  for (const offset of [0, 16, 28, raw.length - 1]) {
    const corrupted = Buffer.from(raw); corrupted[offset] ^= 1;
    await assert.rejects(importConfig(CONFIG_PREFIX + corrupted.toString('base64url'), 'correct passphrase'), /损坏/);
  }
  await assert.rejects(importConfig(CONFIG_PREFIX + '*', 'correct passphrase'), /损坏/);
});
test('plaintext export and import omit every secret field, without modifying inputs', async () => {
  const s = structuredClone(DEFAULT_SETTINGS); s.provider.profiles[0].apiKey = 'sk-test-not-real';
  s.secrets = { openai: { apiKey: 'sk-test-not-real' } }; s.extra = { authorization: 'sk-test-not-real' };
  const out = await exportConfig(s, { secrets: s.secrets });
  assert.equal(out.includes('sk-test-not-real'), false); assert.equal(out.includes('secrets'), false);
  const decoded = await importConfig(JSON.stringify(s));
  assert.equal(decoded.secrets, undefined); assert.equal(decoded.settings.provider.profiles[0].apiKey, undefined);
  assert.equal(s.provider.profiles[0].apiKey, 'sk-test-not-real');
});
test('reject unsafe plaintext objects, oversized input and prototype secrets', async () => {
  await assert.rejects(importConfig('[]'));
  await assert.rejects(importConfig('a'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(exportConfig(DEFAULT_SETTINGS, { password: 'test', secrets: JSON.parse('{"__proto__":{"apiKey":"sk-test-not-real"}}') }));
});

test('encrypted exports require eight characters while plaintext and legacy imports remain supported',async()=>{
 for(const password of ['a','1234567','😀'.repeat(7)])await assert.rejects(exportConfig(DEFAULT_SETTINGS,{password}),/8/);
 const exported=await exportConfig(DEFAULT_SETTINGS,{password:'12345678'});
 assert.ok((await importConfig(exported,'12345678')).settings);
 assert.ok((await exportConfig(DEFAULT_SETTINGS)).startsWith('{'));
});

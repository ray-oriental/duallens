import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
import { safeExport, importSettings, validateSettings, terms } from '../../extension/ui/validation.js';
const fresh = () => structuredClone(DEFAULT_SETTINGS);
test('export omits credentials recursively without changing local settings', () => {
 const s=fresh(); s.provider.profiles[0].apiKey='local-only-example'; s.nested={token:'example-token',name:'keep'};
 const out=safeExport(s); assert.equal(out.provider.profiles[0].apiKey,undefined); assert.equal(out.nested.token,undefined);
 assert.equal(out.nested.name,'keep'); assert.equal(s.provider.profiles[0].apiKey,'local-only-example');
});
test('import ignores profile credentials and unknown fields; store retains separate local secrets', () => {
 const local=fresh(); local.provider.profiles[0].apiKey='local-only-example';
 const incoming=fresh(); incoming.targetLang='ja'; incoming.provider.profiles[0].apiKey='ignored-example'; incoming.unknown='omit';
 const out=importSettings(incoming,local); assert.equal(out.targetLang,'ja'); assert.equal(out.provider.profiles[0].apiKey,undefined); assert.equal(out.unknown,undefined);
});
test('JSON prototype keys never survive settings import', () => {
 const incoming=JSON.parse('{"__proto__":{"polluted":true},"targetLang":"en"}');
 const out=importSettings(incoming,fresh()); assert.equal(Object.hasOwn(out,'__proto__'),false); assert.equal({}.polluted,undefined);
});
test('compatible-service model names and fallbacks are opaque user configuration', () => {
 const s=fresh(); s.provider.profiles[0].fallbackModels.push('example/model');
 assert.doesNotThrow(()=>validateSettings(s));
 s.provider.profiles[0].fallbackModels.push(''); assert.throws(()=>validateSettings(s),/非空/);
});
test('reject invalid endpoints and excessive concurrency', () => {
 const s=fresh(); s.provider.profiles[0].baseUrl='https://user:pass@example.com/v1'; assert.throws(()=>validateSettings(s),/凭据/);
 s.provider.profiles[0].baseUrl='http://127.0.0.1:1234/v1'; s.provider.profiles[0].concurrency=99; assert.throws(()=>validateSettings(s),/并发/);
});
test('parse glossary and reject ambiguous or empty entries', () => {
 assert.deepEqual(terms('kernel → 内核\nAPI\t接口'),[{src:'kernel',dst:'内核'},{src:'API',dst:'接口'}]);
 assert.throws(()=>terms('kernel'),/原词/); assert.throws(()=>terms('a → b → c'),/原词/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../extension/shared/settings.js';
import { safeExport, importSettings, validateSettings, terms } from '../../extension/ui/validation.js';
const fresh = () => structuredClone(DEFAULT_SETTINGS);
test('export omits credentials recursively without changing local settings', () => {
 const s=fresh(); s.provider.profiles[1].apiKey='local-only-example'; s.nested={token:'example-token',name:'keep'};
 const out=safeExport(s); assert.equal(out.provider.profiles[1].apiKey,undefined); assert.equal(out.nested.token,undefined);
 assert.equal(out.nested.name,'keep'); assert.equal(s.provider.profiles[1].apiKey,'local-only-example');
});
test('import ignores profile credentials and unknown fields; store retains separate local secrets', () => {
 const local=fresh(); local.provider.profiles[1].apiKey='local-only-example';
 const incoming=fresh(); incoming.targetLang='ja'; incoming.provider.profiles[1].apiKey='ignored-example'; incoming.unknown='omit';
 const out=importSettings(incoming,local); assert.equal(out.targetLang,'ja'); assert.equal(out.provider.profiles[1].apiKey,undefined); assert.equal(out.unknown,undefined);
});
test('JSON prototype keys never survive settings import', () => {
 const incoming=JSON.parse('{"__proto__":{"polluted":true},"targetLang":"en"}');
 const out=importSettings(incoming,fresh()); assert.equal(Object.hasOwn(out,'__proto__'),false); assert.equal({}.polluted,undefined);
});
test('subscription models cannot enter the automatic fallback chain', () => {
 const s=fresh(); s.provider.profiles[0].fallbackModels.push('claude/haiku'); assert.throws(()=>validateSettings(s),/手动选择/);
 s.provider.profiles[0].fallbackModels=[]; s.provider.profiles[0].model='claude/haiku'; assert.doesNotThrow(()=>validateSettings(s));
});
test('reject invalid endpoints and excessive concurrency', () => {
 const s=fresh(); s.provider.profiles[0].baseUrl='https://example.com/v1'; assert.throws(()=>validateSettings(s),/本机网关/);
 s.provider.profiles[0].baseUrl='http://127.0.0.1:18790/v1'; s.provider.profiles[0].concurrency=99; assert.throws(()=>validateSettings(s),/并发/);
});
test('parse glossary and reject ambiguous or empty entries', () => {
 assert.deepEqual(terms('kernel → 内核\nAPI\t接口'),[{src:'kernel',dst:'内核'},{src:'API',dst:'接口'}]);
 assert.throws(()=>terms('kernel'),/原词/); assert.throws(()=>terms('a → b → c'),/原词/);
});

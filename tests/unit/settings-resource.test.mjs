import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSettingsFormLoader, resourceDigest, SETTINGS_RESOURCE_ERROR } from '../../extension/userscript/settings-resource.js';

const source = '(function(){ return {mountSettingsForm: function mount(){}}; })();';
const specFor = source => ({name:'duallens-settings',bytes:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex')});
test('settings resource is requested lazily, verified, evaluated and cached once', async () => {
  let calls = 0;
  const load = createSettingsFormLoader(async name => { calls++; assert.equal(name,'duallens-settings'); return source; }, specFor(source));
  assert.equal(calls,0);
  const a = load(), b = load(); assert.equal(a,b);
  const mount = await a; assert.equal(typeof mount,'function');
  assert.equal(await load(),mount); assert.equal(calls,1);
});
test('missing, modified, wrongly exported and unavailable settings fail safely and can retry', async () => {
  for (const [bad, pinned] of [[undefined,false], ['',false], [source+' ',false], [source.replace('mount()','count()'),false],
    ['(function(){throw Error("must not escape");})();',true], ['({})',true], ['(',true]]) {
    let current = bad;
    const spec = specFor(pinned ? bad : source);
    const load = createSettingsFormLoader(() => current, spec);
    await assert.rejects(load(), {message:SETTINGS_RESOURCE_ERROR()});
    if (!pinned) { current = source; assert.equal(typeof await load(),'function'); }
  }
  for (const get of [null, () => { throw Error('GM unavailable'); }]) {
    const load = createSettingsFormLoader(get, specFor(source));
    await assert.rejects(load(), {message:SETTINGS_RESOURCE_ERROR()});
    await assert.rejects(load(), {message:SETTINGS_RESOURCE_ERROR()});
  }
});
test('same-size tampering is rejected before resource code executes', async () => {
  const good = '(function(){globalThis.__resourceRan = 1; return {mountSettingsForm(){}};})();';
  const load = createSettingsFormLoader(() => good.replace('= 1','= 2'), specFor(good));
  await assert.rejects(load(), {message:SETTINGS_RESOURCE_ERROR()});
  assert.equal(globalThis.__resourceRan,undefined);
});
test('SHA-256 matches Node on secure and HTTP pages, including padding boundaries and UTF-8', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'crypto');
  try {
    for (const fallback of [false,true]) {
      if (fallback) Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});
      for (const text of ['', 'abc', '中文资源', ...[55,56,63,64,65,127,128,117302].map(n => 'x'.repeat(n))]) {
        assert.equal(await resourceDigest(new TextEncoder().encode(text)),createHash('sha256').update(text).digest('hex'));
      }
    }
  } finally { if (descriptor) Object.defineProperty(globalThis,'crypto',descriptor); else delete globalThis.crypto; }
});

test('lazy resource failure uses the current UI preference', async()=>{
  const {setUiLanguage,t}=await import('../../extension/shared/i18n.js');
  try {
    for(const pref of ['en','zh-CN']) {
      setUiLanguage(pref);
      await assert.rejects(createSettingsFormLoader(()=>null)(),{message:t('mkb')});
    }
  } finally {setUiLanguage('zh-CN');}
});

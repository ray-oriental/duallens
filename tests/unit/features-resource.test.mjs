import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFeaturesLoader, FEATURES_RESOURCE_ERROR } from '../../extension/userscript/features-loader.js';
import { setUiLanguage, t } from '../../extension/shared/i18n.js';

const source = '(function(){return {VideoSubtitles(){},createUserscriptOCR(){},ComicTranslator(){},messages:{budgetFixture:["测试","test"]},setUiLanguage(pref){this.pref=pref;}};})();';
const specFor = text => ({name:'duallens-features',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});

test('feature resource is lazy, verified once, cached and follows current language',async()=>{
  let calls=0;
  const load=createFeaturesLoader(name=>{assert.equal(name,'duallens-features');calls++;return source;},specFor(source));
  assert.equal(calls,0);
  try {
    setUiLanguage('en');
    const [a,b]=await Promise.all([load(),load()]);
    assert.equal(a,b);assert.equal(calls,1);assert.equal(a.pref,'en');assert.equal(t('budgetFixture'),'test');
    setUiLanguage('zh-CN');assert.equal((await load()).pref,'zh-CN');assert.equal(calls,1);
  } finally {setUiLanguage('zh-CN');}
});

test('missing, modified, malformed and unavailable feature resources fail closed and retry',async()=>{
  for (const bad of [undefined,'',source+' ',source.replace('return','returN')]) {
    let current=bad;
    const load=createFeaturesLoader(()=>current,specFor(source));
    await assert.rejects(load(),{message:FEATURES_RESOURCE_ERROR()});
    current=source;assert.equal(typeof (await load()).VideoSubtitles,'function');
  }
  for(const bad of ['({})','(','(()=>{throw Error("untrusted");})()']) {
    await assert.rejects(createFeaturesLoader(()=>bad,specFor(bad))(),{message:FEATURES_RESOURCE_ERROR()});
  }
  for(const get of [null,()=>{throw Error('unavailable');}]) {
    await assert.rejects(createFeaturesLoader(get,specFor(source))(),{message:FEATURES_RESOURCE_ERROR()});
  }
});

test('same-size feature tampering cannot execute and failure uses current language',async()=>{
  const good='(()=>{globalThis.__featureTampered=1;return {};})()';
  try {
    for(const pref of ['en','zh-CN']) {
      setUiLanguage(pref);
      await assert.rejects(createFeaturesLoader(()=>good.replace('=1','=2'),specFor(good))(),{message:t('budgetResourceError')});
      assert.equal(globalThis.__featureTampered,undefined);
    }
  } finally {setUiLanguage('zh-CN');}
});

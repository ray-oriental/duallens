import test from 'node:test';
import assert from 'node:assert/strict';
import { detectedSource, swappedLanguages, untilAborted, CANCELLED } from '../../extension/sidepanel/text-state.js';
import { setUiLanguage } from '../../extension/shared/i18n.js';

for (const language of ['zh-CN','en']) {
  test(`text ${language}: detected language must be supported and reliable`,()=>{
    setUiLanguage(language);
    assert.equal(detectedSource({lang:'en-US',reliable:true}),'en');
    assert.equal(detectedSource({lang:'zh-Hant',reliable:true}),'zh-TW');
    for(const result of [null,{lang:'und'},{lang:'auto'},{lang:'en',reliable:false}])assert.equal(detectedSource(result),'');
  });
  test(`text ${language}: auto swap uses detected source; explicit source needs no detection`,()=>{
    setUiLanguage(language);
    assert.equal(swappedLanguages('auto','ja',''),null);
    assert.deepEqual(swappedLanguages('auto','ja','en'),{from:'ja',to:'en'});
    assert.deepEqual(swappedLanguages('fr','ja',''),{from:'ja',to:'fr'});
    assert.equal(swappedLanguages('auto','ja','unsupported'),null);
  });
  test(`text ${language}: cancellation releases a never-ending task and consumes late errors`,async()=>{
    setUiLanguage(language);
    const controller=new AbortController();let reject;
    const result=untilAborted(()=>new Promise((_resolve,fail)=>{reject=fail;}),controller.signal);
    await Promise.resolve();controller.abort();
    assert.equal(await result,CANCELLED);
    reject(Error('late fixture error'));await new Promise(resolve=>setImmediate(resolve));
  });
  test(`text ${language}: an already cancelled task never starts`,async()=>{
    setUiLanguage(language);
    const controller=new AbortController();controller.abort();
    assert.equal(await untilAborted(()=>assert.fail('cancelled work started'),controller.signal),CANCELLED);
  });
  test(`text ${language}: work values and errors pass through without classification changes`,async()=>{
    setUiLanguage(language);
    const controller=new AbortController(),result={ok:true,text:'plain text'},error=Error('fixture error');
    assert.equal(await untilAborted(()=>result,controller.signal),result);
    await assert.rejects(untilAborted(()=>Promise.reject(error),controller.signal),value=>value===error);
  });
}

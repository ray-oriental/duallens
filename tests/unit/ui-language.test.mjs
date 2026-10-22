import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS, createSettingsStore, migrateSettings} from '../../extension/shared/settings.js';
import {setUiLanguage, uiLanguage, t, initUiLanguage} from '../../extension/shared/i18n.js';
import {exportConfig, importConfig} from '../../extension/shared/configcrypto.js';
import {importSettings} from '../../extension/ui/validation.js';
import {memoryArea} from './storage-memory.mjs';

test('fresh and existing v3 settings default UI to Chinese without changing translation language',async()=>{
  assert.equal(DEFAULT_SETTINGS.uiLanguage,'zh-CN');
  assert.equal(uiLanguage(),'zh-CN');
  const old={version:3,targetLang:'ja'};
  assert.equal(migrateSettings(old).uiLanguage,'zh-CN');
  assert.equal(migrateSettings(old).targetLang,'ja');
  assert.equal(Object.hasOwn(old,'uiLanguage'),false);
  const local=memoryArea({settings:old}),sync=memoryArea();
  const store=createSettingsStore({localArea:local,syncArea:sync,browserLanguage:'en-US'});
  assert.equal((await store.load()).uiLanguage,'zh-CN');
  assert.equal((await store.load()).targetLang,'ja');
});

test('UI preference belongs to synced public core and survives a second device',async()=>{
  const sync=memoryArea(),store=createSettingsStore({localArea:memoryArea(),syncArea:sync});
  await store.save({uiLanguage:'en',targetLang:'ja'});
  assert.equal(sync.data['settings.core'].uiLanguage,'en');
  const second=createSettingsStore({localArea:memoryArea(),syncArea:sync,browserLanguage:'zh-CN'});
  assert.equal((await second.load()).uiLanguage,'en');
  assert.equal((await second.load()).targetLang,'ja');
});

test('plaintext and encrypted export/import preserve each UI preference independently of target language',async()=>{
  for(const uiLanguage of ['zh-CN','en','auto'])for(const password of ['', 'test-passphrase']){
    const settings={...structuredClone(DEFAULT_SETTINGS),uiLanguage,targetLang:'ja'};
    const parsed=await importConfig(await exportConfig(settings,{password}),password);
    const result=importSettings(parsed.settings,structuredClone(DEFAULT_SETTINGS));
    assert.equal(result.uiLanguage,uiLanguage);assert.equal(result.targetLang,'ja');
  }
});

test('invalid UI preferences are rejected by save and import before writes',async()=>{
  const local=memoryArea(),sync=memoryArea(),store=createSettingsStore({localArea:local,syncArea:sync});
  await store.save({uiLanguage:'en'});
  const before=structuredClone(sync.data);
  for(const uiLanguage of ['fr',null,42,'zh-TW']){
    await assert.rejects(store.save({uiLanguage}));
    assert.throws(()=>importSettings({...structuredClone(DEFAULT_SETTINGS),uiLanguage},DEFAULT_SETTINGS));
    assert.deepEqual(sync.data,before);
  }
});

test('background-style preference initialization follows store changes and can unsubscribe',async()=>{
  const store=createSettingsStore({localArea:memoryArea()});
  await store.save({uiLanguage:'en'});
  const off=await initUiLanguage(store);
  try{
    assert.equal(uiLanguage(),'en');assert.equal(t('m44'),'Close');
    await store.save({uiLanguage:'zh-CN'});
    for(let i=0;i<20&&uiLanguage()!=='zh-CN';i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(uiLanguage(),'zh-CN');
  }finally{off();setUiLanguage('zh-CN');}
});

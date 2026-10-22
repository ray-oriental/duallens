import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createSettingsStore, migrateSettings, SETTINGS_KEYS } from '../../extension/shared/settings.js';
import { exportConfig, importConfig, compactConfig } from '../../extension/shared/configcrypto.js';
import { importSettings } from '../../extension/ui/validation.js';
import { createProviders } from '../../extension/background/providers.js';
import { memoryArea } from './storage-memory.mjs';

const features = ['floatBall', 'selection', 'hover', 'input', 'comics'];
function legacy() {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.version = 2;
  for (const f of features) s[f].enabled = true;
  s.targetLang = 'ja'; s.glossary = [{src:'engine',dst:'エンジン'}];
  s.siteRules.always = ['example.org/docs/*'];
  s.provider = {active:'existing',chain:[{profileId:'existing',model:'example/chain-model'}],profiles:[{
    id:'existing',kind:'gateway',name:'Existing service',baseUrl:'http://100.64.1.2:1234/v1',model:'example/model',
    fallbackModels:['example/backup'],jsonMode:true,maxItems:7,maxChars:1234,concurrency:2,timeoutMs:130000,
  }]};
  return s;
}
function assertMigrated(s, before) {
  const expected = structuredClone(before); expected.version = 3;
  for (const f of features) expected[f].enabled = false;
  expected.provider.profiles[0].kind = 'openai';
  assert.deepEqual(s, expected);
}
test('fresh v3 defaults are quiet and have no gateway profile or automatic site rule', () => {
  assert.equal(DEFAULT_SETTINGS.version, 3);
  for (const f of features) assert.equal(DEFAULT_SETTINGS[f].enabled, false, f);
  assert.equal(DEFAULT_SETTINGS.subtitles.enabled, false);
  assert.equal(DEFAULT_SETTINGS.provider.profiles.some(p => p.kind === 'gateway'), false);
  assert.deepEqual(DEFAULT_SETTINGS.siteRules.always, []);
  assert.deepEqual(DEFAULT_SETTINGS.autoTranslateLangs, []);
});
test('v2 compatibility mirror migrates once, preserves all provider fields/chain and local Bearer slot', async () => {
  const before = legacy(), local = memoryArea({settings:before,secrets:{existing:{apiKey:'sk-test-not-real'}}}), sync=memoryArea();
  let store = createSettingsStore({localArea:local,syncArea:sync});
  const s = await store.load(); assertMigrated(s,before); assert.equal(before.version,2);
  assert.equal(await store.getSecret('existing'),'sk-test-not-real');
  assert.equal(JSON.stringify(sync.data).includes('sk-test-not-real'),false);
  let authorization;
  const providers=createProviders({getSecret:id=>store.getSecret(id),fetchImpl:async(_url,init)=>{
    authorization=init.headers.Authorization;
    return {status:200,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:'ok'}}]})};
  }});
  await providers.chat({profile:s.provider.profiles[0],messages:[]});
  assert.equal(authorization,'Bearer sk-test-not-real');
  await store.save({selection:{enabled:true},floatBall:{enabled:true}});
  const writes=local.writes.length+sync.writes.length;
  store=createSettingsStore({localArea:local,syncArea:sync});
  assert.equal((await store.load()).selection.enabled,true);
  assert.equal((await store.load()).floatBall.enabled,true);
  assert.equal(local.writes.length+sync.writes.length,writes);
});
test('split v2 settings migrate in Chrome sync, local fallback and shared GM storage', async () => {
  for (const mode of ['sync','fallback','gm']) {
    const before=legacy(), {glossary,siteRules,autoTranslateLangs,...core}=before;
    const split={'settings.core':core,'settings.glossary':glossary,'settings.sites':{siteRules,autoTranslateLangs}};
    const local=memoryArea(mode==='sync'?{}:split), sync=mode==='gm'?local:memoryArea(mode==='sync'?split:{});
    const store=createSettingsStore({localArea:local,syncArea:mode==='fallback'?undefined:sync});
    assertMigrated(await store.load(),before);
    for (const key of SETTINGS_KEYS) assert.ok(local.data[key],key);
    assert.equal(local.data['settings.core'].version,3);
    await store.save({input:{enabled:true},comics:{enabled:true}});
    const reload=createSettingsStore({localArea:local,syncArea:mode==='fallback'?undefined:sync});
    assert.equal((await reload.load()).input.enabled,true);
    assert.equal((await reload.load()).comics.enabled,true);
  }
});
test('encrypted old backup import migrates before validation and retains its secret under the same id', async () => {
  const before=legacy();
  const encrypted=await exportConfig(before,{password:'test passphrase',secrets:{existing:{apiKey:'sk-test-not-real'}}});
  const parsed=await importConfig(encrypted,'test passphrase');
  const next=importSettings(parsed.settings,DEFAULT_SETTINGS);
  // Import also restores optional profile metadata for older backups.
  assert.equal(next.provider.profiles[0].kind,'openai');
  for (const [key,value] of Object.entries(before.provider.profiles[0])) if(key!=='kind') assert.deepEqual(next.provider.profiles[0][key],value,key);
  assert.deepEqual(next.provider.chain,before.provider.chain);
  for (const f of features) assert.equal(next[f].enabled,false);
  for (const gm of [false,true]) {
    const local=memoryArea(),store=createSettingsStore({localArea:local,syncArea:gm?local:memoryArea()});
    await store.save(next, {preserveProvider:true});
    for (const [id,secret] of Object.entries(parsed.secrets)) await store.setSecret(id,secret.apiKey);
    assert.equal(await store.getSecret('existing'),'sk-test-not-real');
    assert.equal((await store.load()).provider.profiles[0].id,'existing');
  }
});
test('compact v3 encrypted transfer retains opt-ins and v2 plaintext import cannot replace local keys', async () => {
  const s=migrateSettings(legacy()); for(const f of features)s[f].enabled=true;
  const compact=compactConfig(s); assert.equal(compact.version,3);
  const parsed=await importConfig(await exportConfig(compact,{password:'test passphrase'}),'test passphrase');
  const next=importSettings(parsed.settings,DEFAULT_SETTINGS);
  for(const f of features)assert.equal(next[f].enabled,true);
  const local=memoryArea(),store=createSettingsStore({localArea:local});
  await store.setSecret('existing','sk-test-not-real');
  await store.save(importSettings((await importConfig(JSON.stringify({...legacy(),secrets:{existing:{apiKey:'ignored'}}}))).settings,DEFAULT_SETTINGS));
  assert.equal(await store.getSecret('existing'),'sk-test-not-real');
});

test('unversioned legacy core settings receive the one-time migration too', async () => {
  const before=legacy(); delete before.version;
  const local=memoryArea({'settings.core':before});
  const migrated=await createSettingsStore({localArea:local}).load();
  assert.equal(migrated.version,3);
  for(const f of features)assert.equal(migrated[f].enabled,false);
  assert.equal(migrated.provider.profiles[0].model,'example/model');
  assert.deepEqual(migrated.provider.chain,before.provider.chain);
});

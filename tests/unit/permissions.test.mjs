import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, mergeSettings } from '../../extension/shared/settings.js';
import { needsResident, residentScripts, revokedSettingsPatch, createPermissionRegistry, REVOCATION_KEY } from '../../extension/background/permissions.js';
import { createTabInjector, injectableURL } from '../../extension/background/injection.js';
import { createCanvasRegistry, createImageRegistry } from '../../extension/background/comic-sites.js';
import { createPDFEntries } from '../../extension/background/pdf.js';
import { createSubtitleHandlers } from '../../extension/background/subtitles.js';

test('release manifest uses optional page hosts and concrete translation hosts, no static injection', () => {
  const m = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url)));
  assert.equal(m.content_scripts, undefined);
  assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.ok(m.host_permissions.every(pattern => /^https:\/\/[^*<>]+\/\*$/.test(pattern)));
  for (const name of ['activeTab', 'scripting']) assert.ok(m.permissions.includes(name));
  for (const resource of m.web_accessible_resources.flatMap(item => item.resources)) assert.ok(!resource.includes('*'));
});
test('resident decisions cover feature, custom rule, language and subtitle opt-ins only with broad grant', () => {
  assert.equal(needsResident(DEFAULT_SETTINGS), false);
  for (const patch of [{selection:{enabled:true}}, {frames:{enabled:true}}, {subtitles:{enabled:true}},
    {siteRules:{always:['test.example']}}, {siteRules:{custom:[{match:'test.example',hover:'on'}]}},
    {siteRules:{custom:[{match:'test.example',page:'always'}]}}, {autoTranslateLangs:['en']}]) {
    const s=mergeSettings(DEFAULT_SETTINGS,patch);
    assert.equal(needsResident(s),true);
    assert.deepEqual(residentScripts(s,false),[]);
    const [script]=residentScripts(s,true);
    assert.equal(script.allFrames,true);assert.equal(script.matchOriginAsFallback,true);
  }
  assert.deepEqual(residentScripts(DEFAULT_SETTINGS,true),[]);
  assert.equal(residentScripts(mergeSettings(DEFAULT_SETTINGS,{subtitles:{enabled:true}}),true).length,2);
});
test('revocation clears passive and auto rules, preserves never/path/style/provider and is idempotent', () => {
  const s=mergeSettings(DEFAULT_SETTINGS,{selection:{enabled:true},comics:{enabled:true},autoTranslateLangs:['en'],
    siteRules:{always:['test.example'],never:['blocked.example'],custom:[{match:'test.example/a/*',page:'always',input:'on',hover:'off',style:'plain'}]}});
  const saved=mergeSettings(s,revokedSettingsPatch(s));
  assert.equal(saved.selection.enabled,false);assert.equal(saved.comics.enabled,false);
  assert.deepEqual(saved.siteRules.never,s.siteRules.never);
  assert.deepEqual(saved.siteRules.custom,[{match:'test.example/a/*',page:'default',input:'off',hover:'off',style:'plain'}]);
  assert.deepEqual(saved.provider,s.provider);assert.deepEqual(revokedSettingsPatch(saved),{});
  assert.equal(s.selection.enabled,true);
});
test('registration serializes grant/settings/revoke changes, preserves unrelated scripts and saves notice', async () => {
  let broad=true, s=mergeSettings(DEFAULT_SETTINGS,{floatBall:{enabled:true}}), registrations=[], saves=0, notice;
  const api={permissions:{contains:async()=>broad},storage:{local:{set:async value=>{notice=value;}}},scripting:{
    getRegisteredContentScripts:async()=>registrations.map(s=>({...s,matches:[...s.matches].sort()})),
    registerContentScripts:async scripts=>{registrations.push(...scripts);},
    unregisterContentScripts:async({ids})=>{registrations=registrations.filter(s=>!ids.includes(s.id));},
    updateContentScripts:async()=>assert.fail('no update needed'),
  }};
  const registry=createPermissionRegistry(api,{load:async()=>s,save:async(patch,options)=>{assert.deepEqual(options,{preserveProvider:true});s=mergeSettings(s,patch);saves++;return s;}});
  await Promise.all([registry.sync(),registry.sync()]);assert.equal(registrations.length,1);
  broad=false;await registry.sync();assert.equal(registrations.length,0);assert.equal(s.floatBall.enabled,false);
  assert.deepEqual(notice[REVOCATION_KEY].features,['floatBall']);await registry.sync();assert.equal(saves,1);
  broad=true;await registry.sync();assert.equal(registrations.length,0);
});
test('tab injection serializes parallel requests, awaits readiness and skips reinjection', async () => {
  let loaded=false, count=0;
  const injector=createTabInjector({tabs:{get:async()=>({url:'https://test.example/'}),sendMessage:async()=>{if(!loaded)throw Error();return {ok:true};}},
    scripting:{insertCSS:async()=>{},executeScript:async()=>{count++;await Promise.resolve();loaded=true;}}});
  assert.deepEqual(await Promise.all([injector.ensure(1),injector.ensure(1)]),[{ok:true,injected:true},{ok:true,injected:true}]);
  await injector.ensure(1);assert.equal(count,1);assert.equal((await injector.ensure(null)).reason,'no-access');
});
test('restricted URLs and missing activeTab fail safely', async () => {
  for(const url of ['chrome://settings','edge://extensions','about:blank','https://chromewebstore.google.com/detail/id']) assert.equal(injectableURL(url),false);
  const restricted=createTabInjector({tabs:{get:async()=>({url:'chrome://settings'})}});
  assert.deepEqual(await restricted.ensure(1),{ok:false,reason:'restricted'});
  const denied=createTabInjector({tabs:{get:async()=>{throw Error('denied');}}});
  assert.deepEqual(await denied.ensure(1),{ok:false,reason:'no-access'});
});
test('extension-owned PDF viewer is already a controller; other extension pages stay restricted', async () => {
  let url='chrome-extension://own/pdf/viewer.html?file=x';
  const injector=createTabInjector({runtime:{getURL:path=>'chrome-extension://own/'+path},
    tabs:{get:async()=>({url}),sendMessage:async()=>({translated:false})}});
  assert.deepEqual(await injector.ensure(1),{ok:true,injected:true});
  url='chrome-extension://own/ui/options.html';
  assert.deepEqual(await injector.ensure(1),{ok:false,reason:'restricted'});
});
test('PDF missing origin permission declines without probing or opening and returns a requestable origin', async () => {
  let calls=0;
  const entries=createPDFEntries({permissions:{contains:async()=>false},tabs:{create:async()=>{calls++;}},
    runtime:{getURL:path=>path}},async()=>{calls++;throw Error('must not fetch');});
  const result=await entries.open({url:'https://files.example/read.pdf'});
  assert.equal(result.ok,false);assert.equal(result.permissionRequired,'https://files.example/*');
  assert.equal(result.error.code,'permission');assert.equal(calls,0);
});
test('cross-host captions fail with an actionable permission error before any network call', async () => {
  let calls=0;
  const handlers=createSubtitleHandlers({api:{permissions:{contains:async()=>false}},fetchImpl:async()=>{calls++;}});
  const result=await handlers['subtitle-track']({id:'caption-1',url:'https://m.youtube.com/api/timedtext?v=one'},
    {tab:{id:1,url:'https://www.youtube.com/watch?v=one'},url:'https://www.youtube.com/watch?v=one',frameId:0});
  assert.equal(result.ok,false);assert.equal(result.error.code,'permission');assert.equal(calls,0);
});
test('comic registrations and DNR are absent without matching host access, removed after revoke', async () => {
  let granted=true, scripts=[],rules=[];
  const s=mergeSettings(DEFAULT_SETTINGS,{comics:{enabled:true}});
  const api={runtime:{id:'a'.repeat(32)},permissions:{contains:async()=>granted},scripting:{
    getRegisteredContentScripts:async()=>scripts,registerContentScripts:async value=>{scripts=value;},
    unregisterContentScripts:async()=>{scripts=[];},},declarativeNetRequest:{
    getSessionRules:async()=>rules,updateSessionRules:async({addRules})=>{rules=addRules;}}};
  const canvas=createCanvasRegistry(api,async()=>s),images=createImageRegistry(api,async()=>s);
  await canvas.sync();await images.sync();assert.equal(scripts.length,1);assert.equal(rules.length,1);
  granted=false;await canvas.sync();await images.sync();assert.equal(scripts.length,0);assert.equal(rules.length,0);
});

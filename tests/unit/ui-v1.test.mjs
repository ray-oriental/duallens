import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SETTINGS,defaultTargetLanguage,createSettingsStore,publicSettings,validateInteractionSettings} from '../../extension/shared/settings.js';
import {exportConfig,importConfig} from '../../extension/shared/configcrypto.js';
import {importSettings} from '../../extension/ui/validation.js';
import {SHARED_CSS} from '../../extension/ui/theme.js';
import {POPUP_CSS} from '../../extension/ui/popup-theme.js';
import {engineSummary} from '../../extension/ui/components.js';
function area(){const data={};return {data,async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},async set(items){Object.assign(data,structuredClone(items));}};}
test('v1 browser language matching handles variants and unsupported locales',()=>{
  for(const [input,expected] of [['en-US','en'],['pt-BR','pt'],['zh-Hant-HK','zh-TW'],['zh-SG','zh-CN'],['ja-JP','ja'],['unknown','zh-CN'],['','zh-CN']])assert.equal(defaultTargetLanguage(input),expected);
});
test('v1 autoHide defaults true, validates boolean and survives import',()=>{
  assert.equal(DEFAULT_SETTINGS.floatBall.autoHide,true);
  const s=structuredClone(DEFAULT_SETTINGS);s.floatBall.autoHide=false;assert.equal(importSettings(s,s).floatBall.autoHide,false);
  s.floatBall.autoHide='false';assert.throws(()=>validateInteractionSettings(s),/开关/);
});
test('v1 supplied browser UI language wins for fresh settings and persisted choice wins thereafter',async()=>{
  const local=area(),store=createSettingsStore({localArea:local,browserLanguage:'fr-CA'});
  assert.equal((await store.load()).targetLang,'fr');await store.save({targetLang:'ja'});assert.equal((await store.load()).targetLang,'ja');
});
test('v1 device state is absent from sync, plaintext, encrypted and imported settings',async()=>{
  const s={...structuredClone(DEFAULT_SETTINGS),ui:{onboarded:true,acked:['mt:microsoft']},'ui.device':{upgradeNoticeSeen:true}};
  const sync=area(),local=area();local.data['ui.device']={onboarded:true,acked:[],upgradeNoticeSeen:true};
  const store=createSettingsStore({syncArea:sync,localArea:local});await store.save(s);
  assert.ok(!JSON.stringify(sync.data).includes('ui.device'));assert.ok(!('ui' in await store.load()));
  const plain=await exportConfig(s);assert.ok(!plain.includes('onboarded'));
  const imported=await importConfig(await exportConfig(s,{password:'fixture-passphrase'}),'fixture-passphrase');assert.ok(!('ui' in imported.settings));
  assert.ok(!('ui.device' in publicSettings(s)));assert.equal(local.data['ui.device'].onboarded,true);
});
test('v1 old enabled features create a device-local upgrade notice only during migration',async()=>{
  const sync=area(),local=area();local.data.settings={...structuredClone(DEFAULT_SETTINGS),version:2,selection:{enabled:true,showIcon:true}};
  const store=createSettingsStore({syncArea:sync,localArea:local});const migrated=await store.load();assert.equal(migrated.selection.enabled,false);assert.equal(local.data['ui.device'].onboarded,true);assert.equal(local.data['ui.device'].upgradeNoticeSeen,false);assert.ok(!sync.data['ui.device']);
});
test('v1 inline shadow styles are byte-identical to shared CSS sources',async()=>{
  const read=async path=>(await readFile(new URL('../../extension/ui/'+path,import.meta.url),'utf8')).replace(/\r\n?/g,'\n');
  assert.equal(SHARED_CSS,await read('tokens.css')+await read('components.css'));assert.equal(POPUP_CSS,await read('popup.css'));
});
test('v1 PDF reader links the shared styles and its theme switch mirrors tokens.css exactly',async()=>{
  const read=async path=>(await readFile(new URL('../../extension/'+path,import.meta.url),'utf8')).replace(/\r\n?/g,'\n');
  const tokens=await read('ui/tokens.css'),viewer=await read('pdf/viewer.css'),html=await read('pdf/viewer.html');
  assert.match(html,/href="\.\.\/ui\/tokens\.css">\s*<link rel="stylesheet" href="\.\.\/ui\/components\.css">\s*<link rel="stylesheet" href="viewer\.css">/);
  const props=text=>Object.fromEntries([...text.matchAll(/(--dl-[\w-]+)\s*:\s*([^;}]+)/g)].map(([,name,value])=>[name,value.replace(/\s+/g,'')]));
  const darkStart=tokens.indexOf('@media (prefers-color-scheme: dark)');
  const light=props(tokens.slice(0,darkStart)),dark=props(tokens.slice(darkStart,tokens.indexOf('@media (prefers-reduced-motion')));
  const forced=theme=>props(viewer.match(new RegExp(`:root\\[data-theme=${theme}\\]\\{([^}]*--dl-bg[^}]*)\\}`))[1]);
  const pick=(source,names)=>Object.fromEntries(names.map(name=>[name,source[name]]));
  const names=Object.keys(dark);assert.ok(names.length>=20);
  assert.deepEqual(pick(forced('dark'),names),pick(dark,names));
  assert.deepEqual(pick(forced('light'),names),pick(light,names));
});
test('v1 data destination includes fallback and every configured AI origin',()=>{
  const s=structuredClone(DEFAULT_SETTINGS);assert.match(engineSummary(s).full,/微软.*谷歌/);
  s.provider.active='openai';s.provider.profiles[0].baseUrl='https://example.com/v1';s.provider.profiles[0].model='fixture';assert.match(engineSummary(s).full,/example.com/);s.translation.mode='llm';assert.doesNotMatch(engineSummary(s).full,/微软/);
});

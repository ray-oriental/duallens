import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATION_COLORS, normalizeTranslationColor } from '../../extension/shared/translation-color.js';
import { translationColor, contrastRatio } from '../../extension/content/presentation.js';
import { DEFAULT_SETTINGS, migrateSettings, createSettingsStore } from '../../extension/shared/settings.js';
import { validateSettings, importSettings } from '../../extension/ui/validation.js';
import { exportConfig, importConfig } from '../../extension/shared/configcrypto.js';

const rgb=value=>value.startsWith('#')?value.slice(1).match(/../g).map(v=>parseInt(v,16)):value.match(/[\d.]+/g).map(Number);
const hue=c=>{const max=Math.max(...c),min=Math.min(...c),d=max-min;if(!d)return 0;const i=c.indexOf(max);return (([ (c[1]-c[2])/d,(c[2]-c[0])/d+2,(c[0]-c[1])/d+4 ][i]*60)%360+360)%360;};
test('preset inks meet 4.5:1 and choose the composited background shade',()=>{
  for(const [id,pair] of Object.entries(TRANSLATION_COLORS))for(const [i,bg] of [[0,[255,255,255]],[1,[18,18,18]]]) {
    assert.ok(contrastRatio(rgb(pair[i]),bg)>=4.5,`${id}/${i}`);
    assert.equal(translationColor([60,60,60],bg,{translationColor:id}),pair[i]);
  }
});
test('custom inks retain hue and adjust only when below 3:1',()=>{
  for(const custom of ['#121212','#ffffff','#223344','#eeccaa','#884422','#7090a0'])for(const bg of [[255,255,255],[18,18,18],[120,130,140],rgb(custom)]) {
    const original=rgb(custom),result=rgb(translationColor([0,0,0],bg,{translationColor:custom}));
    assert.ok(contrastRatio(result,bg)>=3,`${custom} on ${bg}`);
    if(contrastRatio(original,bg)>=3)assert.deepEqual(result,original);
    if(Math.max(...original)!==Math.min(...original))assert.ok(Math.abs(hue(original)-hue(result))<.01);
  }
});
test('auto matches the original policy exactly; higher contrast takes priority',()=>{
  const old=(fg,bg,{moreContrast,supportsMix})=>{
    const fmt=c=>`rgb(${c.join(',')})`,raw=fg.map((v,i)=>v*.78+bg[i]*.22),muted=raw.map(Math.round);
    if(moreContrast||contrastRatio(raw,bg)<4.5||contrastRatio(muted,bg)<4.5)return fmt(contrastRatio(fg,bg)>=4.5?fg:contrastRatio([0,0,0],bg)>contrastRatio([255,255,255],bg)?[0,0,0]:[255,255,255]);
    return supportsMix?`color-mix(in srgb, ${fmt(fg)} 78%, ${fmt(bg)})`:fmt(muted);
  };
  for(let n=0;n<=255;n+=15)for(const bg of [[255,255,255],[18,18,18],[100,120,140]])for(const moreContrast of [false,true])for(const supportsMix of [false,true]) {
    const fg=[n,Math.min(n+12,255),n],options={moreContrast,supportsMix};
    assert.equal(translationColor(fg,bg,{...options,translationColor:'auto'}),old(fg,bg,options));
    if(moreContrast)assert.equal(translationColor(fg,bg,{...options,translationColor:'blue'}),old(fg,bg,options));
  }
});
test('normalization, validation and config transfers reject unsafe ink values',async()=>{
  assert.equal(DEFAULT_SETTINGS.translationColor,'auto');
  for(const value of ['red','#fff','#12345678','BLUE','url(example.com)',null,3,{},['blue'],'__proto__']) {
    assert.equal(normalizeTranslationColor(value),'auto');
    const settings={...structuredClone(DEFAULT_SETTINGS),translationColor:value};
    assert.equal(migrateSettings(settings).translationColor,'auto');
    assert.equal(validateSettings(settings).translationColor,'auto');
    assert.equal(importSettings({...settings,translationColor:value},DEFAULT_SETTINGS).translationColor,'auto');
    const exported=await exportConfig({...settings,translationColor:value});
    assert.equal(JSON.parse(exported).translationColor,'auto');
  }
  for(const choice of ['auto',...Object.keys(TRANSLATION_COLORS),'#AABBCC']) {
    const settings={...structuredClone(DEFAULT_SETTINGS),translationColor:choice};
    for(const password of ['', 'fixture passphrase']) {
      const imported=await importConfig(await exportConfig(settings,{password}),password);
      assert.equal(importSettings(imported.settings,DEFAULT_SETTINGS).translationColor,choice.toLowerCase());
    }
  }
});
test('ink settings sync and invalid stored or saved values fall back to auto',async()=>{
  const area=()=>{const data={};return {data,async get(keys){return Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(values){Object.assign(data,structuredClone(values));}};};
  const localArea=area(),syncArea=area(),store=createSettingsStore({localArea,syncArea});
  await store.save({translationColor:'blue'});assert.equal(syncArea.data['settings.core'].translationColor,'blue');
  assert.equal((await store.load()).translationColor,'blue');
  syncArea.data['settings.core'].translationColor='invalid';assert.equal((await store.load()).translationColor,'auto');
  await store.save({translationColor:'#ABCDEF'});assert.equal((await store.load()).translationColor,'#abcdef');
  await store.save({translationColor:[]});assert.equal((await store.load()).translationColor,'auto');
});

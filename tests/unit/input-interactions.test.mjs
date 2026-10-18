import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings, validateInteractionSettings, createSettingsStore } from '../../extension/shared/settings.js';
import { inputOutput, inputAccessor } from '../../extension/content/inputbox.js';
import { interactionRequest, hoverService } from '../../extension/content/util.js';
import { importSettings } from '../../extension/ui/validation.js';
import { memoryArea } from './storage-memory.mjs';

test('input replacement and bilingual order use the correct separators', () => {
  for (const single of [true, false]) {
    assert.equal(inputOutput('source', 'target', { mode:'replace' }, single), 'target');
    const sep = single ? ' ' : '\n';
    assert.equal(inputOutput('source', 'target', { mode:'bilingual', order:'source-first' }, single), 'source'+sep+'target');
    assert.equal(inputOutput('source', 'target', { mode:'bilingual', order:'translation-first' }, single), 'target'+sep+'source');
  }
});

test('legacy import fills interaction defaults and public overrides survive import', () => {
  const old = structuredClone(DEFAULT_SETTINGS); delete old.input.mode; delete old.input.order;
  delete old.hover.profileId; delete old.input.model;
  const s = importSettings(old, DEFAULT_SETTINGS);
  assert.equal(s.input.mode, 'replace'); assert.equal(s.input.order, 'source-first');
  assert.deepEqual(interactionRequest(s.hover), {});
  const changed = mergeSettings(s, { input:{ mode:'bilingual', profileId:'mock', model:'different' } });
  assert.deepEqual(importSettings(changed, s).input, changed.input);
});

test('reject invalid interaction enums, profiles and model strings before saving/importing', async () => {
  for (const patch of [{ input:{ mode:'unknown' } }, { input:{ order:'unknown' } },
    { hover:{ profileId:'missing' } }, { input:{ profileId:42 } }, { hover:{ model:'bad\nmodel' } },
    { input:{ model:'a'.repeat(257) } }, { input:{ model:null } }]) {
    const s = mergeSettings(DEFAULT_SETTINGS, patch);
    assert.throws(() => validateInteractionSettings(s));
    if (patch.input?.model !== null) assert.throws(() => importSettings(s, DEFAULT_SETTINGS));
    const localArea = memoryArea();
    await assert.rejects(createSettingsStore({localArea}).save(patch));
  }
});

test('explicit service uses only public identifiers and LLM; empty profile inherits', () => {
  assert.deepEqual(interactionRequest({model:'ignored',apiKey:'sk-test-not-real'}), {});
  assert.deepEqual(interactionRequest({profileId:'mock',model:' model ',apiKey:'sk-test-not-real'}), {profileId:'mock',model:'model',mode:'llm'});
  assert.deepEqual(interactionRequest({profileId:'mock',model:''}), {profileId:'mock',model:undefined,mode:'llm'});
});

test('hover adapter keeps page/inherited batches intact and uses selected request identity', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS), before = structuredClone(settings.provider);
  const calls = [], batches = [], results = [];
  const service = { translateBatch(req) { batches.push(req); return {cancel(){}}; },
    async translateText(req) { calls.push(req); return {ok:true,text:'<img onerror=bad> & translated'}; } };
  const adapter = hoverService(service, () => settings);
  const req = {purpose:'hover',to:'en',items:[{id:'1',text:'<g0>Hello</g0> &amp; world'}]};
  adapter.translateBatch(req, () => {}); assert.equal(batches[0], req);
  settings.hover.profileId='mock'; settings.hover.model='chosen';
  adapter.translateBatch({...req,purpose:'page'}, () => {}); assert.equal(batches.length,2);
  await adapter.translateBatch(req, r => results.push(...r)).done;
  assert.equal(calls[0].profileId,'mock'); assert.equal(calls[0].model,'chosen');
  assert.equal(calls[0].text,'Hello & world'); assert.equal(calls[0].mode,'llm');
  assert.equal(results[0].text,'&lt;img onerror=bad&gt; &amp; translated');
  assert.deepEqual(settings.provider,before);
});

test('hover cancellation discards late results and rejected transport yields a safe error', async () => {
  let release;
  const pending = new Promise(r => {release=r;}); const results=[];
  const settings = {hover:{profileId:'mock'}};
  const adapter = hoverService({translateText:()=>pending},()=>settings);
  const handle=adapter.translateBatch({purpose:'hover',items:[{id:'x',text:'hi'}]},r=>results.push(r));
  handle.cancel(); release({ok:true,text:'late'}); await handle.done; assert.deepEqual(results,[]);
  const failing = hoverService({translateText:async()=>{throw Error('private');}},()=>settings);
  await failing.translateBatch({purpose:'hover',items:[{id:'x',text:'hi'}]},r=>results.push(r)).done;
  assert.equal(results[0][0].error.message,'悬停翻译失败，请重试');
});

function fieldFixture() {
  class Field {
    constructor() { this.data='LEFT hello RIGHT'; this.tagName='TEXTAREA'; this.selectionStart=5; this.selectionEnd=10; }
    get value() { return this.data; }
    set value(v) { this.data=v; }
    focus() {}
    setSelectionRange(a,b) { this.selectionStart=a; this.selectionEnd=b; }
    dispatchEvent(e) { this.events.push(e.type); this.handle?.(e); return !e.defaultPrevented; }
  }
  class InputEvent extends Event { constructor(type,init) { super(type,init); this.data=init.data; } }
  const el = new Field(); el.events=[]; el.ownerDocument={defaultView:{HTMLTextAreaElement:Field,InputEvent},execCommand:()=>false};
  return el;
}

test('controlled input native setter bypasses own setter and confirms whole value including outside selection', async () => {
  const el=fieldFixture(); Object.defineProperty(el,'value',{get(){return this.data;},set(){throw Error('tracked setter');}});
  const acc=inputAccessor(el,true);
  assert.equal(acc.text,'hello'); assert.equal(await acc.apply('translated',()=>true),true);
  assert.equal(el.value,'LEFT translated RIGHT'); assert.deepEqual(el.events,['input']);
});

test('readback, not execCommand return value, decides whether the beforeinput strategy is needed', async () => {
  const el=fieldFixture();let execs=0;
  el.ownerDocument.execCommand=()=>{execs++;return true;}; // claims success but changes nothing
  el.handle=e=>{if(e.type==='input')el.data='LEFT hello RIGHT';else {e.preventDefault();el.data='LEFT translated RIGHT';}};
  assert.equal(await inputAccessor(el,true).apply('translated',()=>true),true);
  assert.equal(execs,1);assert.deepEqual(el.events,['input','beforeinput']);
});

test('unexpected readback and invalidated async results stop retries without touching later text', async () => {
  const el=fieldFixture();let execs=0;
  el.ownerDocument.execCommand=()=>{execs++;};
  el.handle=()=>{el.data='new user value';};
  assert.equal(await inputAccessor(el,true).apply('translated',()=>true),false);
  assert.equal(el.value,'new user value');assert.equal(execs,0);
  const other=fieldFixture();
  assert.equal(await inputAccessor(other,true).apply('translated',()=>false),false);
  assert.deepEqual(other.events,[]);assert.equal(other.value,'LEFT hello RIGHT');
});

test('all rejected field strategies return failure and retain the original value', async () => {
  const el=fieldFixture();el.handle=e=>{if(e.type==='input')el.data='LEFT hello RIGHT';else e.preventDefault();};
  assert.equal(await inputAccessor(el,true).apply('translated',()=>true),false);
  assert.equal(el.value,'LEFT hello RIGHT');
});

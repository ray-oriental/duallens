import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings, validateInteractionSettings, createSettingsStore } from '../../extension/shared/settings.js';
import { InputBox, inputOutput, inputAccessor } from '../../extension/content/inputbox.js';
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

test('triple-space needs three real key presses; synthetic events cannot complete the gesture', () => {
  const input = new InputBox({getSettings:()=>({input:{enabled:true,trigger:'triple-space'}}),platform:{}});
  const field = {nodeType:1,tagName:'TEXTAREA'};
  const calls = [];
  input.run = (...args)=>calls.push(args);
  const key = isTrusted => ({isTrusted,key:' ',composedPath:()=>[field],preventDefault(){},stopImmediatePropagation(){}});
  for(let i=0;i<3;i++)input.key(key(false));
  assert.deepEqual(calls,[]);
  input.key(key(true));input.key(key(true));
  for(let i=0;i<3;i++)input.key(key(false));
  assert.deepEqual(calls,[]);
  input.key(key(true));
  assert.deepEqual(calls,[[field,false]]);
});

test('real triple-space remains suppressed during IME composition and recovers afterwards', () => {
  const input = new InputBox({getSettings:()=>({input:{enabled:true,trigger:'triple-space'}}),platform:{}});
  const field = {nodeType:1,tagName:'TEXTAREA'};
  const calls = [];
  input.run = (...args)=>calls.push(args);
  const key = {isTrusted:true,key:' ',composedPath:()=>[field],preventDefault(){},stopImmediatePropagation(){}};
  input.composition({...key,type:'compositionstart'});
  for(let i=0;i<3;i++)input.key(key);
  assert.deepEqual(calls,[]);
  input.composition({...key,type:'compositionend'});
  for(let i=0;i<3;i++)input.key(key);
  assert.deepEqual(calls,[[field,false]]);
});

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

function overlayFixture(t, translateText) {
  const listeners=new Set();
  class Node {
    constructor(){this.children=[];this.style={};this.className='';}
    get classList(){return {contains:c=>this.className.split(' ').includes(c),
      add:c=>{this.className+=' '+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ');}};}
    setAttribute(){}
    append(...children){this.children.push(...children);}
    appendChild(child){child.isConnected=true;this.append(child);}
    attachShadow(){return new Node();}
    remove(){this.isConnected=false;}
  }
  const globals={document:{createElement:()=>new Node(),createTextNode:text=>({textContent:text}),documentElement:new Node(),
    addEventListener:(type,fn)=>{if(type==='keydown')listeners.add(fn);},
    removeEventListener:(type,fn)=>{if(type==='keydown')listeners.delete(fn);}},
    MutationObserver:class {takeRecords(){return [];}disconnect(){}},innerWidth:800,innerHeight:600};
  for(const [key,value] of Object.entries(globals)){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  }
  const field=()=>Object.assign(fieldFixture(),{nodeType:1,isConnected:true,focuses:0,
    focus(){this.focuses++;},addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({right:100,bottom:100})});
  // Explicit commands can open overlays even with the passive input feature off.
  const input=new InputBox({getSettings:()=>({input:{enabled:false,mode:'replace'}}),platform:{
    translator:()=>({translateText}),settingsStore:{save:()=>assert.fail('Escape must not disable the feature')}}});
  const key=(isTrusted=true,key='Escape')=>({isTrusted,key,prevented:false,stopped:false,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
  return {input,field,key,listeners};
}

test('only trusted Escape dismisses a command chip, aborts writeback and restores its field',async t=>{
  let release,signal;
  const f=overlayFixture(t,req=>{signal=req.signal;return new Promise(r=>{release=r;});});
  const el=f.field(),pending=f.input.run(el,true);
  assert.equal(f.listeners.size,1);
  for(const e of [f.key(false),f.key(true,'Enter')]){
    f.input.escape(e);assert.equal(e.prevented,false);assert.equal(e.stopped,false);
    assert.equal(f.input.chip.node.classList.contains('show'),true);assert.equal(signal.aborted,false);
  }
  const e=f.key();f.input.escape(e);
  assert.equal(e.prevented,true);assert.equal(e.stopped,true);assert.equal(signal.aborted,true);
  assert.equal(el.focuses,1);assert.equal(f.listeners.size,0);
  release({ok:true,text:'late'});await pending;
  assert.equal(el.value,'LEFT hello RIGHT');assert.deepEqual(el.events,[]);
  const idle=f.key();f.input.escape(idle);assert.equal(idle.prevented,false);assert.equal(idle.stopped,false);
});

test('Escape closes a rejected-write panel and returns focus without modifying the editor',async t=>{
  const f=overlayFixture(t,async()=>({ok:true,text:'translated'})),el=f.field();
  el.handle=e=>{if(e.type==='input')el.data='LEFT hello RIGHT';else e.preventDefault();};
  await f.input.run(el,true);
  assert.equal(f.input.failure.attached,true);assert.equal(f.listeners.size,1);
  f.input.escape(f.key(false));assert.equal(f.input.failure.attached,true);
  const before=el.focuses,e=f.key();f.input.escape(e);
  assert.equal(e.stopped,true);assert.equal(el.focuses,before+1);assert.equal(f.input.failure,null);
  assert.equal(f.listeners.size,0);assert.equal(el.value,'LEFT hello RIGHT');
});

test('settling a cancelled request cannot hide a newer chip; disable cleans up its listener',async t=>{
  const releases=[];
  const f=overlayFixture(t,()=>new Promise(r=>releases.push(r))),first=f.field(),second=f.field();
  const a=f.input.run(first,true);f.input.escape(f.key());
  const b=f.input.run(second,true);
  releases[0]({ok:true,text:'late'});await a;
  assert.equal(f.input.chip.node.classList.contains('show'),true);assert.equal(f.listeners.size,1);
  second.isConnected=false;f.input.escape(f.key());assert.equal(second.focuses,0);
  releases[1]({ok:true,text:'late'});await b;
  assert.equal(f.listeners.size,0);
  const c=f.input.run(first,true);assert.equal(f.listeners.size,1);
  f.input.disable();assert.equal(f.listeners.size,0);
  releases[2]({ok:true,text:'late'});await c;
  assert.equal(first.value,'LEFT hello RIGHT');
});

test('successful input writeback removes the overlay Escape listener',async t=>{
  const f=overlayFixture(t,async()=>({ok:true,text:'translated'})),el=f.field();
  await f.input.run(el,true);
  assert.equal(el.value,'LEFT translated RIGHT');assert.equal(f.listeners.size,0);
  const e=f.key();f.input.escape(e);assert.equal(e.prevented,false);
});

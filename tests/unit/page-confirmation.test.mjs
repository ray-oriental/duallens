import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withSendConfirmation,requestDestinations} from '../../extension/content/confirmation.js';
import {DEFAULT_SETTINGS,mergeSettings} from '../../extension/shared/settings.js';
import {loadDeviceState} from '../../extension/shared/device-state.js';
import {frameMayTranslate} from '../../extension/content/frame-agent.js';

test('child agents need pushed top consent and never prompt or trust device-local consent alone',async()=>{
  const f=fixture();let confirmed=[];
  await f.platform.localArea.set({'ui.device':{acked:['llm:https://fixture.example']}});
  const p=withSendConfirmation({...f.platform,frameAgent:true,confirmedDestinations:()=>confirmed},f.settings,
    {prompt:()=>assert.fail('frame must never show UI')});
  assert.equal((await p.translator().translateText({text:'child'})).ok,false);
  assert.equal(f.calls.length,0);
  const state={active:true,settings:f.settings(),confirmedDestinations:[]};
  assert.equal(frameMayTranslate(state),false);
  confirmed=['llm:https://fixture.example'];state.confirmedDestinations=confirmed;
  assert.equal(frameMayTranslate(state),true);
  assert.equal((await p.translator().translateText({text:'child'})).ok,true);
  assert.equal(frameMayTranslate({...state,active:false}),false);
  f.set(mergeSettings(f.settings(),{provider:{profiles:[{id:'openai',kind:'openai',baseUrl:'https://changed.example/v1',model:'test'}]}}));
  assert.equal((await p.translator().translateText({text:'new destination'})).ok,false);
});

function fixture(patch={},prompt=async()=>true){
  const state={};let settings=mergeSettings(DEFAULT_SETTINGS,{translation:{mode:'llm'},provider:{active:'openai',profiles:[
    {id:'openai',kind:'openai',name:'Fixture',baseUrl:'https://fixture.example/v1',model:'test'}]},...patch});
  const calls=[];
  const platform={localArea:{async get(){return structuredClone(state);},async set(items){Object.assign(state,structuredClone(items));}},
    translator(){return {async translateText(req){calls.push(req);return {ok:true,text:'translated'};},translateBatch(req,partial){calls.push(req);partial(req.items.map(i=>({id:i.id,text:'translated'})));return {done:Promise.resolve(),cancel(){calls.push('cancel');}};}};}};
  return {calls,state,platform,settings:()=>settings,set:s=>{settings=s;},service:withSendConfirmation(platform,()=>settings,{prompt}).translator()};
}
const req={items:[{id:'a',text:'hello'}]};
test('wrapping a guarded platform again is idempotent',()=>{
  const f=fixture();const p=withSendConfirmation(f.platform,f.settings);
  assert.equal(withSendConfirmation(p,f.settings),p);
});
test('unconfirmed batch blocks all requests until continuation and remembers device destination',async()=>{
  let accept;let prompts=0;const f=fixture({},()=>{prompts++;return new Promise(r=>{accept=r;});});
  const results=[];const batch=f.service.translateBatch(req,r=>results.push(...r));
  await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,0);assert.equal(prompts,1);
  accept(true);await batch.done;assert.equal(f.calls.length,1);assert.equal(results[0].text,'translated');
  assert.deepEqual((await loadDeviceState(f.platform.localArea)).acked,['llm:https://fixture.example']);
  await f.service.translateText({text:'next'});assert.equal(prompts,1);assert.equal(f.calls.length,2);
});
test('closing confirmation cancels text and batch without a transport call',async()=>{
  const f=fixture({},async()=>false);assert.equal((await f.service.translateText({text:'private'})).error.code,'CANCELLED');
  let results;await f.service.translateBatch(req,r=>{results=r;}).done;
  assert.equal(results[0].error.code,'CANCELLED');assert.equal(f.calls.length,0);assert.deepEqual((await loadDeviceState(f.platform.localArea)).acked,[]);
});
test('loopback endpoints and demo do not prompt',async()=>{
  for(const baseUrl of ['http://localhost:11434/v1','http://127.0.0.1:1234/v1','http://[::1]:1234/v1']){
    const f=fixture({provider:{active:'local',profiles:[{id:'local',kind:'openai',baseUrl,model:'test'}]}},()=>assert.fail('local prompt'));
    assert.equal((await f.service.translateText({text:'local'})).ok,true);
  }
  const f=fixture({provider:{active:'mock',profiles:[{id:'mock',kind:'mock',model:'mock'}]}},()=>assert.fail('demo prompt'));
  await f.service.translateBatch(req,()=>{}).done;assert.equal(f.calls.length,1);
});
test('all interaction purposes and temporary profile/fallback choices are covered',()=>{
  const f=fixture();for(const purpose of ['page','selection','hover','input','subtitles','comics'])assert.equal(requestDestinations(f.settings(),{purpose})[0].id,'llm:https://fixture.example');
  const s=mergeSettings(f.settings(),{translation:{mode:'mt+llm',mt:{engine:'deepl'}}});
  assert.deepEqual(requestDestinations(s).map(d=>d.id),['mt:deepl','llm:https://fixture.example']);
});
test('cancelled batch never starts after continuation, and concurrent batches share one card',async()=>{
  let accept,prompts=0;const f=fixture({},({signal})=>{prompts++;return new Promise(r=>{accept=r;signal.addEventListener('abort',()=>r(false));});});
  const a=f.service.translateBatch(req,()=>assert.fail('cancelled callback'));
  const b=f.service.translateBatch(req,()=>{});await new Promise(r=>setImmediate(r));
  a.cancel();accept(true);await Promise.all([a.done,b.done]);assert.equal(f.calls.length,1);assert.equal(prompts,1);
});
test('changing service while confirmation is open invalidates the old attempt',async()=>{
  let accept;const f=fixture({},()=>new Promise(r=>{accept=r;}));const p=f.service.translateText({text:'old'});
  await new Promise(r=>setImmediate(r));f.set(mergeSettings(f.settings(),{provider:{profiles:[{id:'openai',kind:'openai',baseUrl:'https://new.example/v1',model:'test'}]}}));
  accept(true);assert.equal((await p).error.code,'CANCELLED');assert.equal(f.calls.length,0);
});
test('each text consumer is blocked before its first send',async()=>{
  for(const purpose of ['page','selection','hover','input','subtitle','comics']){
    const f=fixture({},async()=>false);await f.service.translateText({text:'selected fixture text',purpose});
    assert.equal(f.calls.length,0,purpose);
  }
});
test('declining page consent stops its queued page operation',async()=>{
  const f=fixture();let stopped=0;
  const p=withSendConfirmation(f.platform,f.settings,{prompt:async()=>false});p.onDecline=()=>{stopped++;};
  await p.translator().translateBatch({...req,purpose:'page'},()=>{}).done;
  assert.equal(stopped,1);assert.equal(f.calls.length,0);
});
test('OCR download confirmation cancels recognition and installed languages skip the card',async()=>{
  const f=fixture();let recognized=0,prompts=0;
  f.platform.comics={async languages(){return {ok:true,languages:[]};},async recognize(){recognized++;return {ok:true};}};
  const p=withSendConfirmation(f.platform,f.settings,{prompt:async()=>{prompts++;return false;}});
  assert.equal((await p.comics.recognize({lang:'eng'})).error.code,'CANCELLED');assert.equal(recognized,0);assert.equal(prompts,1);
  f.platform.comics.languages=async()=>({ok:true,languages:[{lang:'eng'}]});
  await p.comics.recognize({lang:'eng'});assert.equal(recognized,1);assert.equal(prompts,1);
});
test('legacy transports without done wait for terminal results, and cancel settles',async()=>{
  const f=fixture({provider:{active:'mock',profiles:[{id:'mock',kind:'mock',model:'mock'}]}});
  let callback;
  f.platform.translator=()=>({translateBatch(req,cb){callback=cb;return {cancel(){}};}});
  const service=withSendConfirmation(f.platform,f.settings).translator();let settled=false;
  const batch=service.translateBatch(req,()=>{});batch.done.then(()=>{settled=true;});
  await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  callback([{id:'a',text:'draft',stage:'draft'}]);await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  callback([{id:'a',text:'final',stage:'final'}]);await batch.done;assert.equal(settled,true);
  const next=service.translateBatch(req,()=>assert.fail('cancelled result'));await new Promise(r=>setImmediate(r));next.cancel();await next.done;
});
test('concurrent OCR images share the first language download confirmation',async()=>{
  const f=fixture();let accept,prompts=0,recognized=0;
  f.platform.comics={async languages(){return {ok:true,languages:[]};},async recognize(){recognized++;return {ok:true};}};
  const p=withSendConfirmation(f.platform,f.settings,{prompt:()=>{prompts++;return new Promise(r=>{accept=r;});}});
  const a=p.comics.recognize({lang:'eng'}),b=p.comics.recognize({lang:'eng'});
  await new Promise(r=>setImmediate(r));assert.equal(prompts,1);assert.equal(recognized,0);
  accept(true);await Promise.all([a,b]);f.platform.comics.languages=async()=>({ok:true,languages:[{lang:'eng'}]});await p.comics.recognize({lang:'eng'});
  assert.equal(prompts,1);assert.equal(recognized,3);
});

test('deleting OCR data requires source-and-size confirmation again',async()=>{
  const f=fixture();let prompts=0,installed=false;
  f.platform.comics={async languages(){return {ok:true,languages:installed?[{lang:'eng'}]:[]};},async recognize(){installed=true;return {ok:true};}};
  const p=withSendConfirmation(f.platform,f.settings,{prompt:async opts=>{assert.match(opts.message,/GitHub.*4.11 MB/);prompts++;return true;}});
  await p.comics.recognize({lang:'eng'});await p.comics.recognize({lang:'eng'});assert.equal(prompts,1);
  installed=false;await p.comics.recognize({lang:'eng'});assert.equal(prompts,2);
});
test('background refusal shows confirmation and retries text and batch without exposing the error as a translation',async()=>{
 const f=fixture({provider:{active:'mock',profiles:[{id:'mock',kind:'mock',model:'mock'}]}});
 const destination={id:'mt:google',name:'Google',host:'clients5.google.com'};let calls=0,prompts=0;
 f.platform.translator=()=>({async translateText(){return ++calls===1?{ok:false,error:{code:'confirmation-required',destination}}:{ok:true,text:'ok'};},
 translateBatch(req,cb){calls++;cb(req.items.map(it=>calls===1?{id:it.id,error:{code:'confirmation-required',destination}}:{id:it.id,text:'ok'}));return{done:Promise.resolve(),cancel(){}};}});
 const svc=withSendConfirmation(f.platform,f.settings,{prompt:async()=>{prompts++;return true;}}).translator();
 assert.equal((await svc.translateText({text:'fixture'})).text,'ok');assert.equal(prompts,1);
 calls=0;await f.platform.localArea.set({'ui.device':{acked:[]}});const results=[];
 await svc.translateBatch(req,rs=>results.push(...rs)).done;assert.equal(results.length,1);assert.equal(results[0].text,'ok');assert.equal(prompts,2);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmationGuard,requestDestinations,destinationMessage} from '../../extension/shared/destinations.js';
import {createTranslator} from '../../extension/background/translator.js';
import {createHandlers} from '../../extension/background/handlers.js';
import {createMT} from '../../extension/background/mt.js';
import {createQueue} from '../../extension/background/queue.js';
import {createMemoryCache} from '../../extension/background/cache.js';
import {toErrorInfo} from '../../extension/shared/errors.js';
import {testSettings,testProfile,fakeProvider} from './helpers.mjs';

function fixture(mode='llm',engine='microsoft') {
  const settings=testSettings({profile:testProfile({baseUrl:'https://consent.example/v1'}),translation:{mode,mt:{engine}}});
  let acked=[],network=0;
  const local={async get(){return {'ui.device':{acked}};}};
  const guard=createConfirmationGuard(local);
  const provider=fakeProvider();
  const mt=createMT({fetchImpl:async()=>{network++;throw Error('offline fixture');}});
  const cache=createMemoryCache();
  const translator=createTranslator({getSettings:async()=>settings,provider,mt,cache,queue:createQueue(),confirmRequest:guard});
  return {settings,translator,cache,guard,ack(ids){acked=ids;},requests:()=>network+provider.calls.length};
}

for(const mode of ['mt','llm','mt+llm','auto']) for(const purpose of ['page','selection','hover','input','pdf','text','subtitle','comics']) {
  test(`worker rejects unconfirmed ${purpose}/${mode} with zero MT/LLM network calls`,async()=>{
    const f=fixture(mode);
    await assert.rejects(f.translator.translate({purpose,items:[{id:1,text:'Synthetic text'}]}),e=>{
      const info=toErrorInfo(e);assert.equal(info.code,'confirmation-required');assert.ok(info.destination.id);assert.ok(info.destination.name);return true;
    });
    assert.equal(f.requests(),0);
    const handlers=createHandlers({translator:f.translator,getSettings:async()=>f.settings});
    const response=await handlers['translate-text']({purpose,text:'Synthetic text'},{});
    assert.equal(response.error.code,'confirmation-required');assert.ok(response.error.destination.host);assert.equal(f.requests(),0);
  });
}
test('acknowledging only primary cannot authorize a fallback, and official engines have no free destination',async()=>{
  const f=fixture('mt');f.ack(['mt:microsoft']);
  await assert.rejects(f.guard(f.settings,{}),e=>e.destination.id==='mt:google');assert.equal(f.requests(),0);
  for(const engine of ['deepl','microsoft-api'])assert.deepEqual(requestDestinations(fixture('mt',engine).settings).map(d=>d.id),['mt:'+engine]);
  assert.match(destinationMessage(requestDestinations(f.settings)[1]),/微软失败时才用谷歌/);
  assert.match(destinationMessage(requestDestinations(fixture().settings)[0]),/文字和标题/);
});
test('mock and loopback are exempt; remote override and unreadable state fail closed',async()=>{
  const f=fixture();
  const local=testSettings({profile:testProfile(),translation:{mode:'llm'}});
  await f.guard(local,{});
  await f.guard(testSettings({translation:{mode:'mt',mt:{engine:'mock'}}}),{});
  await assert.rejects(f.guard(f.settings,{}),{code:'confirmation-required'});
  await assert.rejects(createConfirmationGuard({get:async()=>{throw Error('unavailable');}})(f.settings,{}));
  assert.equal(f.requests(),0);
});
test('incognito translation neither reads nor writes shared translation cache',async()=>{
  const settings=testSettings();const provider=fakeProvider();
  const cache={async getMany(){assert.fail('incognito read');},async putMany(){assert.fail('incognito write');}};
  const translator=createTranslator({provider,cache,queue:createQueue(),getSettings:async()=>settings});
  await translator.translateTextEx({text:'A synthetic paragraph for translation.',incognito:true});
  assert.equal(provider.calls.length,1);
});
test('official MT failure makes one official request and never reaches free endpoints',async()=>{
  for(const engine of ['deepl','microsoft-api']){
    const urls=[];const mt=createMT({getSecret:async()=> 'sk-test-not-real',fetchImpl:async url=>{urls.push(url);return{status:503,headers:{get(){}},text:async()=>''};}});
    const results=[];await mt.translate({items:[{id:1,text:'Synthetic text'}],to:'zh-CN',chain:[engine,'microsoft','google'],onResults:r=>results.push(...r)});
    assert.equal(urls.length,1);assert.ok(results[0].error);assert.match(results[0].error.message,/未转发/);
    assert.ok(!urls.some(url=>url.includes('edge.microsoft.com')||url.includes('clients5.google.com')));
  }
});

test('MT rechecks before HTTP and LLM retries recheck before each HTTP attempt',async()=>{
  const {createProviders}=await import('../../extension/background/providers.js');
  const {DLError}=await import('../../extension/shared/errors.js');
  let mtNetwork=0;
  const refusal=()=>{throw new DLError('confirmation-required','Confirm',{destination:{id:'mt:microsoft',name:'Microsoft',host:'edge.microsoft.com'}});};
  const mt=createMT({confirmEngine:refusal,fetchImpl:async()=>{mtNetwork++;assert.fail('unconfirmed MT fetch');}});
  await assert.rejects(mt.translate({items:[{id:1,text:'fixture'}],to:'zh-CN',chain:['microsoft']}),{code:'confirmation-required'});
  assert.equal(mtNetwork,0);
  let network=0,checks=0;
  const providers=createProviders({fetchImpl:async()=>{network++;return {status:400,headers:{get(){}},text:async()=>JSON.stringify({error:{message:'response_format unsupported'}})};}});
  await assert.rejects(providers.chat({profile:testProfile({baseUrl:'https://fixture.example/v1'}),messages:[{role:'user',content:'fixture'}],
    beforeSend:()=>{if(++checks===2)refusal();}}),{code:'confirmation-required'});
  assert.equal(checks,2);assert.equal(network,1,'second HTTP must not start after consent revocation');
});

test('incognito MT also bypasses cache reads and writes',async()=>{
 const settings=testSettings({translation:{mode:'mt',mt:{engine:'mock'}}});
 const cache={getMany(){assert.fail('private MT read');},putMany(){assert.fail('private MT write');}};
 const translator=createTranslator({provider:fakeProvider(),cache,queue:createQueue(),getSettings:async()=>settings});
 assert.ok((await translator.translateTextEx({text:'Synthetic text.',incognito:true})).text);
});

test('worker text handlers keep incognito and unknown sidebar contexts out of cache',async()=>{
 const seen=[];const handlers=createHandlers({getSettings:async()=>testSettings(),
   privateContext:sender=>sender?.tab?.incognito!==false,
   translator:{async translateTextEx(req){seen.push(req.incognito);return{text:'translated',by:'llm'};}}});
 for(const sender of [{tab:{incognito:true}},{},{tab:{incognito:false}}])await handlers['translate-text']({text:'fixture'},sender);
 assert.deepEqual(seen,[true,true,false]);
});

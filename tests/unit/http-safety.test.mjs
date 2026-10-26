import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createProviders} from '../../extension/background/providers.js';
import {createMT} from '../../extension/background/mt.js';
import {createGMHttp,createFetchHttp,asFetch,readResponseText,MAX_BYTES} from '../../extension/platform/http.js';
import {classify} from '../../extension/shared/errors.js';
import {ERR} from '../../extension/shared/protocol.js';
import {setUiLanguage,t} from '../../extension/shared/i18n.js';

const profile={id:'fixture',kind:'openai',baseUrl:'https://example.com/v1',model:'fixture',apiKey:'sk-test-not-real'};
const call=(api,method)=>method==='chat'?api.chat({profile,messages:[{role:'user',content:'synthetic text'}]}):api.listModels(profile);

for(const language of ['zh-CN','en'])test(`redirect and size copy/actions are shared: ${language}`,()=>{
  setUiLanguage(language);
  for(const [code,key,category,action]of [[ERR.REDIRECT,'errRedirect','redirect','settings'],[ERR.RESPONSE_SIZE,'errResponseSize','size','details']]){
    const info=classify({code});assert.equal(info.message,t(key));assert.equal(info.category,category);
    assert.equal(info.action,action);assert.equal(info.retryable,false);
  }
  assert.equal(classify({status:307}).category,'redirect');
  assert.equal(classify(new TypeError('Failed to fetch')).category,'network');
  setUiLanguage('zh-CN');
});

test('real fetch: 301/307/308 never reach a second origin with POST, Azure key, or model-list request',async()=>{
  const forwarded=[],sourceCalls=[];
  const target=createServer((req,res)=>{forwarded.push(req.url);req.resume();res.end('{}');});
  target.listen(0,'127.0.0.1');await once(target,'listening');
  let status=307;
  const source=createServer((req,res)=>{sourceCalls.push(req.method);req.resume();res.writeHead(status,{Location:`http://127.0.0.1:${target.address().port}/sink`});res.end();});
  source.listen(0,'127.0.0.1');await once(source,'listening');
  const url=`http://127.0.0.1:${source.address().port}/v1`;
  try{
    for(status of [301,307,308]){
      const before=sourceCalls.length;
      const api=createProviders({fetchImpl:fetch});
      for(const method of ['chat','listModels']){
        const p={...profile,baseUrl:url};
        await assert.rejects(method==='chat'?api.chat({profile:p,messages:[{role:'user',content:'synthetic text'}]}):api.listModels(p),e=>classify(e).category==='redirect');
      }
      for(const run of [()=>createFetchHttp(fetch)({url,method:'POST',body:'synthetic text'}),()=>asFetch(createFetchHttp(fetch))(url,{method:'POST',body:'synthetic text'})]){
        await assert.rejects(run,e=>classify(e).category==='redirect');
      }
      let results;
      const mt=createMT({getSecret:async()=> 'sk-test-not-real',fetchImpl:(_,init)=>{assert.equal(init.redirect,'error');assert.equal(init.headers['Ocp-Apim-Subscription-Key'],'sk-test-not-real');return fetch(url,init);}});
      await mt.translate({items:[{id:1,text:'synthetic text'}],to:'zh-CN',chain:['microsoft-api'],onResults:list=>{results=list;}});
      assert.equal(results[0].error.category,'redirect');
      assert.equal(sourceCalls.length-before,5);
      assert.equal(forwarded.length,0);
    }
  }finally{source.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>target.close(r))]);}
});

function reply({status=200,declared,stream=true,text}={}){
  let cancelled=0,reads=0;
  const headers=new Headers(declared===undefined?{}:{'Content-Length':String(declared)});
  const response={status,headers,text:async()=>text??'x'.repeat(MAX_BYTES+1)};
  if(stream)response.body={cancel:async()=>{cancelled++;},getReader:()=>({
    read:async()=>{reads++;return reads===1?{value:new Uint8Array(MAX_BYTES),done:false}:{value:new Uint8Array(1),done:false};},
    cancel:async()=>{cancelled++;},releaseLock(){},
  })};
  return {response,get cancelled(){return cancelled;},get reads(){return reads;}};
}

for(const method of ['chat','listModels'])for(const status of [200,503])for(const declared of [undefined,1,MAX_BYTES+1]){
  test(`${method} HTTP ${status}: byte cap cancels ${declared>MAX_BYTES?'at Content-Length':'while reading'}`,async()=>{
    const fixture=reply({status,declared});
    const api=createProviders({fetchImpl:async(_,init)=>{assert.equal(init.redirect,'error');return fixture.response;}});
    await assert.rejects(call(api,method),e=>e.code===ERR.RESPONSE_SIZE);
    assert.equal(fixture.cancelled,1);assert.equal(fixture.reads,declared>MAX_BYTES?0:2);
  });
}

test('byte limit counts UTF-8, allows exactly 4 MiB, and also bounds buffered adapters and SSE',async()=>{
  const huge='\u4e2d'.repeat(Math.floor(MAX_BYTES/3)+1);
  await assert.rejects(readResponseText(new Response(huge)),e=>e.code===ERR.RESPONSE_SIZE);
  assert.equal((await readResponseText(new Response('x'.repeat(MAX_BYTES)))).length,MAX_BYTES);
  await assert.rejects(readResponseText(reply({stream:false,text:huge}).response),e=>e.code===ERR.RESPONSE_SIZE);
  const fixture=reply();fixture.response.headers.set('content-type','text/event-stream');
  const api=createProviders({fetchImpl:async()=>fixture.response});
  await assert.rejects(call(api,'chat'),e=>e.code===ERR.RESPONSE_SIZE);
  assert.equal(fixture.cancelled,1);
});

test('fetch adapter and official MT apply Content-Length/stream limits before parsing JSON or error prose',async()=>{
  for(const status of [200,503])for(const declared of [undefined,MAX_BYTES+1]){
    const fixture=reply({status,declared});
    await assert.rejects(createFetchHttp(async()=>fixture.response)({url:'https://example.com'}),e=>e.code===ERR.RESPONSE_SIZE);
    assert.equal(fixture.cancelled,1);
    const next=reply({status,declared});let results;
    await createMT({getSecret:async()=> 'sk-test-not-real',fetchImpl:async()=>next.response}).translate({items:[{id:1,text:'synthetic'}],to:'zh-CN',chain:['microsoft-api'],onResults:list=>{results=list;}});
    assert.equal(results[0].error.code,ERR.RESPONSE_SIZE);assert.equal(next.cancelled,1);
  }
});

for(const event of ['onload','onreadystatechange','onprogress'])test(`GM ${event}: rejects a different final origin before progress consumers`,async()=>{
  let requests=0,aborts=0,deltas=0;
  const http=createGMHttp(req=>{
    requests++;assert.equal(req.redirect,'error');
    queueMicrotask(()=>{req[event]({status:200,finalUrl:'https://second.example.com/result',responseHeaders:'Content-Type: text/event-stream',responseText:'data: secret-test'});req.onload({status:200,responseText:'ignored'});});
    return {abort(){aborts++;}};
  });
  await assert.rejects(http({url:'https://example.com',method:'POST',body:'synthetic',onText:()=>deltas++}),e=>e.code===ERR.REDIRECT);
  assert.equal(requests,1);assert.equal(aborts,1);assert.equal(deltas,0);
});

test('GM aborts 3xx, oversize progress, declared lengths and UTF-8 bodies, including synchronous callbacks',async()=>{
  for(const [event,result,code]of [
    ...[301,307,308].map(status=>['onload',{status},ERR.REDIRECT]),
    ['onprogress',{loaded:MAX_BYTES+1},ERR.RESPONSE_SIZE],
    ['onreadystatechange',{responseHeaders:`Content-Length: ${MAX_BYTES+1}`},ERR.RESPONSE_SIZE],
    ['onload',{status:200,responseText:'\u4e2d'.repeat(Math.floor(MAX_BYTES/3)+1)},ERR.RESPONSE_SIZE],
  ]){
    let aborts=0;
    const http=createGMHttp(req=>{req[event](result);return {abort(){aborts++;}};});
    await assert.rejects(http({url:'https://example.com'}),e=>e.code===code);
    assert.equal(aborts,1);
  }
});

test('GM permits an unchanged origin and exact limit; response provenance and 3xx are checked even for injected fetch',async()=>{
  const http=createGMHttp(req=>{queueMicrotask(()=>req.onload({status:200,finalUrl:'https://example.com/result',responseText:'x'.repeat(MAX_BYTES)}));return {};});
  assert.equal((await http({url:'https://example.com'})).text.length,MAX_BYTES);
  for(const res of [{status:307},{status:200,redirected:true},{status:200,url:'https://second.example.com'}]){
    let cancelled=0;res.body={cancel:async()=>cancelled++};
    await assert.rejects(readResponseText(res,{url:'https://example.com'}),e=>e.code===ERR.REDIRECT);assert.equal(cancelled,1);
  }
});

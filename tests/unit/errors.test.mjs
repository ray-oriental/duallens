import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, scrub, parseRetryAfter, partialFailure, toErrorInfo, DLError, autoRetryDelay } from '../../extension/shared/errors.js';
import { ERR } from '../../extension/shared/protocol.js';
import { t, setUiLanguage } from '../../extension/shared/i18n.js';
import { createProviders } from '../../extension/background/providers.js';
import { createGMHttp } from '../../extension/platform/http.js';
import { createMT } from '../../extension/background/mt.js';

for (const language of ['zh-CN','en']) test(`error catalogue, actions and safe detail: ${language}`, () => {
  setUiLanguage(language);
  for (const [error, category, action] of [
    [{code:ERR.NETWORK},'network','retry'], [{code:ERR.TIMEOUT},'timeout','retry'],
    [{code:ERR.RATE_LIMITED,status:429},'rate','retry'], [{status:503},'server','retry'],
    [{status:401},'auth','settings'], [{status:403},'auth','settings'], [{status:404},'address','settings'],
    [{code:ERR.PARSE},'parse','retry'], [{category:'html'},'html','settings'],
    [{serverCode:'model_not_found'},'model','settings'], [{status:402},'quota','settings'],
    [{serverCode:'content_policy_violation'},'refused','details'], [{code:ERR.CONFIG},'config','settings'],
    [{code:ERR.CONFIRMATION_REQUIRED},'confirmation','details'], [{code:ERR.PERMISSION},'permission','details'],
    [{code:ERR.RESTRICTED},'restricted','details'], [{code:ERR.INJECTION},'injection','retry'],
    [{name:'QuotaExceededError'},'storage','settings'], [{code:ERR.PARTIAL,count:3},'partial','retry'],
    [{code:ERR.FALLBACK},'fallback','details'], [{code:ERR.CANCELLED},'cancelled','details'],
    [{category:'gm'},'gm','retry'], [{message:'untrusted raw JSON sk-test-not-real'},'unknown','details'],
    [{category:'image'},'image','retry'],
  ]) {
    const info=classify(error,{online:true});
    assert.equal(info.category,category); assert.equal(info.action,action);
    assert.equal(info.message,t('err'+category[0].toUpperCase()+category.slice(1),[3]));
    assert.doesNotMatch(info.message,/sk-test-not-real|untrusted raw JSON/);
  }
  assert.equal(classify({code:ERR.NETWORK},{online:false}).message,t('errOffline'));
  assert.equal(classify({category:'gm'},{online:false}).category,'offline');
  assert.equal(classify({status:429,retryAfterMs:1201}).message,t('errRateWait',[2]));
  assert.equal(classify({code:ERR.PARTIAL,count:2,status:429,retryAfterMs:1201}).message,t('errPartial',[2])+' '+t('errRateWait',[2]));
  assert.equal(classify({status:429}).message,t('errRate'));
  assert.equal(classify({status:401,service:'OpenAI'}).detail,'OpenAI · HTTP 401');
  assert.equal(classify({service:'Bearer private-token',status:999}).detail,t('errNoDetail'));
  setUiLanguage('zh-CN');
});

test('Retry-After accepts seconds, decimal seconds, dates, past dates; rejects invalid/nonfinite',()=>{
  assert.equal(parseRetryAfter('2'),2000); assert.equal(parseRetryAfter('1.25'),1250);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:01:00 GMT',1000),59000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT',1000),0);
  for(const value of [null,undefined,'','soon','Infinity','-2','+3','9'.repeat(400)])assert.equal(parseRetryAfter(value),undefined);
});

test('scrub covers exact opaque keys, Bearer/DeepL tokens, JSON/query secrets and JWT',()=>{
  const text='opaque-test-key Bearer bearer-test DeepL-Auth-Key deepl-test sk-test-not-real "api_key":"json-test" ?token=query-test&x=1 eyJtest.abc.def';
  const clean=scrub(text,['opaque-test-key']);
  for(const secret of ['opaque-test-key','bearer-test','deepl-test','sk-test-not-real','json-test','query-test','eyJtest.abc.def'])assert.ok(!clean.includes(secret));
});

test('wire preserves bounded safe metadata and consent, discards raw server codes and prose',()=>{
  const e=new DLError(ERR.RATE_LIMITED,'Bearer private-test',{status:429,retryAfterMs:2500,serverCode:'raw private-test',service:'OpenRouter'});
  const wire=toErrorInfo(e);
  assert.equal(wire.status,429);assert.equal(wire.retryAfterMs,2500);assert.equal(wire.service,'OpenRouter');
  assert.ok(!JSON.stringify(wire).includes('private-test'));assert.equal(wire.serverCode,undefined);
  const destination={id:'mt:microsoft',name:'Microsoft'};
  assert.deepEqual(toErrorInfo(new DLError(ERR.CONFIRMATION_REQUIRED,'Confirm',{destination})).destination,destination);
  assert.equal(toErrorInfo(new Error('secret-test')).message,t('errUnknown'));
});

test('partial failure counts live failed units only',()=>{
  const info=partialFailure([{state:'error'},{state:'done'},{state:'pending'},{state:'error',dead:true},{state:'error',autoRetry:true},{state:'error'}]);
  assert.equal(info.count,2);assert.equal(info.message,t('errPartial',[2]));
  assert.equal(partialFailure([]).count,0);
});

test('only temporary failures automatically retry twice, with a bounded Retry-After',()=>{
  for(const error of [{code:ERR.NETWORK},{code:ERR.TIMEOUT},{category:'offline'},{category:'gm'},{status:500},{status:503}]){
    assert.equal(classify(error).retryable,true);
    assert.equal(autoRetryDelay(error),16000);assert.equal(autoRetryDelay(error,1),16000);assert.equal(autoRetryDelay(error,2),null);
  }
  assert.equal(autoRetryDelay({status:429}),60000);
  assert.equal(autoRetryDelay({status:429,retryAfterMs:1500}),1500);
  assert.equal(autoRetryDelay({status:429,retryAfterMs:0}),0);
  assert.equal(autoRetryDelay({status:429,retryAfterMs:300000}),120000);
  for(const error of [{code:ERR.CONFIG},{status:401},{status:403},{status:404},{code:ERR.PARSE},{category:'html'},
    {serverCode:'model_not_found'},{status:402},{category:'refused'},{code:ERR.CONFIRMATION_REQUIRED},{code:ERR.PERMISSION},
    {code:ERR.RESTRICTED},{code:ERR.INJECTION},{code:ERR.STORAGE},{code:ERR.CANCELLED},{code:ERR.REDIRECT},{code:ERR.RESPONSE_SIZE}]){
    assert.equal(classify(error).retryable,false,JSON.stringify(error));assert.equal(autoRetryDelay(error),null);
  }
});

const profile={id:'fixture',kind:'openai',baseUrl:'https://example.com/v1',model:'fixture',apiKey:'opaque-test-key'};
const fixtures=[
  ['OpenAI',401,{error:{message:'Incorrect API key: opaque-test-key',code:'invalid_api_key'}},'auth'],
  ['OpenAI',429,{error:{type:'insufficient_quota',code:'insufficient_quota'}},'quota'],
  ['OpenAI',429,{error:{code:'rate_limit_exceeded'}},'rate'],
  ['OpenAI',404,{error:{code:'model_not_found',message:'Model not found'}},'model'],
  ['DeepSeek',402,{error:{message:'Insufficient Balance'}},'quota'],
  ['DeepSeek',400,{error:{message:'Model Not Exist'}},'model'],
  ['OpenRouter',402,{error:{message:'Insufficient credits'}},'quota'],
  ['OpenRouter',404,{error:{message:'No endpoints found for model'}},'model'],
  ['OpenRouter',403,{error:{message:'Content moderation flagged',code:'content_filter'}},'refused'],
  ['OpenRouter',503,{error:{message:'Backend unavailable'}},'server'],
];
for(const language of ['zh-CN','en']) test(`realistic HTTP shapes never expose upstream prose: ${language}`,async()=>{
  setUiLanguage(language);
  for(const [service,status,body,category]of fixtures){
    const providers=createProviders({getSecret:async()=>profile.apiKey,fetchImpl:async()=>({status,headers:new Headers({'Retry-After':'1.5'}),text:async()=>JSON.stringify(body)})});
    await assert.rejects(providers.listModels(profile),e=>{
      const info=toErrorInfo(e);assert.equal(info.category,category,service+JSON.stringify(body));
      assert.equal(info.status,status);assert.equal(info.retryAfterMs,1500);
      assert.ok(!JSON.stringify(e).includes(profile.apiKey));assert.ok(!JSON.stringify(info).includes(profile.apiKey));return true;
    });
  }
  setUiLanguage('zh-CN');
});

test('200 content-filter/refusal and SSE error are classified without upstream prose',async()=>{
  for(const body of [{choices:[{message:{refusal:'opaque-test-key'}}]}, {choices:[{finish_reason:'content_filter',message:{content:null}}]}]){
    const api=createProviders({fetchImpl:async()=>({status:200,headers:new Headers(),text:async()=>JSON.stringify(body)})});
    await assert.rejects(api.chat({profile,messages:[]}),e=>e.category==='refused'&&!e.message.includes(profile.apiKey));
  }
  const api=createProviders({fetchImpl:async()=>({status:200,headers:new Headers({'content-type':'text/event-stream'}),text:async()=> 'data: {"error":{"code":"insufficient_quota","message":"opaque-test-key"}}\n\n'})});
  await assert.rejects(api.chat({profile,messages:[]}),e=>e.category==='quota'&&!JSON.stringify(e).includes(profile.apiKey));
});

test('SSE content-filter finish is a refusal, not an empty translation',async()=>{
  const api=createProviders({fetchImpl:async()=>({status:200,headers:new Headers({'content-type':'text/event-stream'}),text:async()=> 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n'})});
  await assert.rejects(api.chat({profile,messages:[]}),e=>e.category==='refused');
});

test('GM transport distinguishes manager failures and timeouts without request data',async()=>{
  for(const [event,category]of [['onerror','gm'],['ontimeout','timeout']]){
    const http=createGMHttp(req=>{queueMicrotask(()=>req[event]({responseText:'private-test'}));return {};});
    await assert.rejects(http({url:'https://example.com',headers:{Authorization:'Bearer private-test'}}),e=>classify(e).category===category&&!e.message.includes('private-test'));
  }
});

test('free MT fallback reports a notice only with a successful backup result',async()=>{
  const mt=createMT({fetchImpl:async url=>({status:url.includes('google')?200:503,headers:new Headers(),text:async()=>url.includes('google')?'["translated"]':'opaque-test-key'})});
  let results;
  await mt.translate({items:[{id:1,text:'hello'}],to:'zh-CN',chain:['microsoft','google'],onResults:list=>{results=list;}});
  assert.equal(results[0].text,'translated');assert.equal(results[0].notice.code,ERR.FALLBACK);
  assert.ok(!JSON.stringify(results).includes(profile.apiKey));
});

test('a blocked HTML controller is an injection failure; native PDF remains restricted',async()=>{
  const {createTabInjector}=await import('../../extension/background/injection.js');
  for(const [url,reason]of [['https://example.com/article','injection-failed'],['https://example.com/file.pdf','restricted']]){
    const injector=createTabInjector({tabs:{get:async()=>({url}),sendMessage:async()=>null},scripting:{insertCSS:async()=>{},executeScript:async()=>{}}});
    assert.deepEqual(await injector.ensure(1),{ok:false,reason});
  }
});

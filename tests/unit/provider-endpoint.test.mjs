import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, normalizeBaseUrl, profileProblem } from '../../extension/background/providers.js';
import { t, setUiLanguage } from '../../extension/shared/i18n.js';
import { ERR } from '../../extension/shared/protocol.js';

const profile = { id:'custom', kind:'openai', baseUrl:'https://example.com/', model:'fixture', apiKey:'sk-test-not-real', timeoutMs:500 };
const catalog = { data:[{id:'fixture'}] };
const completion = { choices:[{message:{content:'translated'}}] };
function provider(replies) {
  const calls=[];
  const api=createProviders({fetchImpl:async(url,init)=>{
    calls.push({url,init});
    const reply=replies.shift(); assert.ok(reply, 'unexpected extra retry');
    return {status:reply.status??200, headers:new Headers(reply.headers), text:async()=>reply.text??JSON.stringify(reply.json)};
  }});
  return {api,calls};
}
const invoke=(api,method,p=profile,extra={})=>method==='chat' ? api.chat({profile:p,messages:[{role:'user',content:'hello'}],...extra}) : api.listModels(p,extra);

test('normalization only completes root HTTP(S) addresses and trims terminal slashes',()=>{
  assert.equal(normalizeBaseUrl(' https://example.com/ ',{completeRoot:true}),'https://example.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/custom/path///',{completeRoot:true}),'https://example.com/custom/path');
  assert.equal(normalizeBaseUrl('https://example.com/?secret=x',{completeRoot:true}),'https://example.com/?secret=x');
  assert.equal(normalizeBaseUrl('https://user:pass@example.com/',{completeRoot:true}),'https://user:pass@example.com');
});
for (const method of ['listModels','chat']) {
  for (const first of [{text:'<!doctype html>homepage'}, {headers:{'content-type':'text/html'},text:'homepage'}, {status:404,json:{error:'missing'}}]) {
    test(`${method}: root HTML or 404 retries /v1 once and reports the successful address`,async()=>{
      const {api,calls}=provider([first,{json:method==='chat'?completion:catalog}]);
      let normalized; const original={...profile};
      await invoke(api,method,original,{onBaseUrl:url=>{normalized=url;}});
      assert.deepEqual(original,profile);
      assert.equal(normalized,'https://example.com/v1');
      const suffix=method==='chat'?'/chat/completions':'/models';
      assert.deepEqual(calls.map(c=>c.url),['https://example.com'+suffix,'https://example.com/v1'+suffix]);
      assert.ok(calls.every(c=>c.init.credentials==='omit'));
    });
  }
  test(`${method}: a root fixed once goes straight to /v1 afterwards`,async()=>{
    const ok={json:method==='chat'?completion:catalog};
    const {api,calls}=provider([{text:'<html>home'},ok,ok]);
    await invoke(api,method);
    let normalized; await invoke(api,method,profile,{onBaseUrl:url=>{normalized=url;}});
    assert.equal(normalized,'https://example.com/v1');
    assert.deepEqual(calls.map(c=>new URL(c.url).pathname.startsWith('/v1')),[false,true,true]);
  });
  test(`${method}: explicit paths are never completed; HTML remains actionable`,async()=>{
    for(const path of ['/v1','/api','/api/v2/']) {
      const {api,calls}=provider([{text:'  <html>homepage</html>'}]);
      await assert.rejects(invoke(api,method,{...profile,baseUrl:'https://example.com'+path}),e=>e.message===t('endpointHtml'));
      assert.equal(calls.length,1);
    }
  });
  test(`${method}: failed /v1 attempt shows webpage guidance and no success callback`,async()=>{
    const {api,calls}=provider([{text:'<html>home'},{text:'<html>still home'}]);
    await assert.rejects(invoke(api,method,profile,{onBaseUrl:()=>assert.fail('must only report success')}),e=>e.message===t('endpointHtml'));
    assert.equal(calls.length,2);
  });
  test(`${method}: auth/404, other non-JSON, snippet and key scrubbing in both UI languages`,async()=>{
    for(const lang of ['zh-CN','en']) {
      setUiLanguage(lang);
      for(const status of [401,403,404]) {
        const {api,calls}=provider([{status,text:'<html>sk-test-not-real'}]);
        await assert.rejects(invoke(api,method,{...profile,baseUrl:'https://example.com/api'}),e=>{
          assert.equal(e.code,status===404?ERR.PROVIDER:ERR.CONFIG);
          assert.equal(e.message,t(status===404?'endpointNotFound':'endpointAuth',[status]));
          assert.equal(e.status,status); assert.ok(!e.message.includes(profile.apiKey)); return true;
        });
        assert.equal(calls.length,1);
      }
      for (const status of [200,502]) {
        const body='sk-test-not-real\r\nraw\t'+ 'x'.repeat(100);
        const {api}=provider([{status,text:body}]);
        const snippet=('*** raw '+ 'x'.repeat(100)).slice(0,80);
        await assert.rejects(invoke(api,method),e=>e.message===t('endpointParse',[status,snippet])&&!e.message.includes(profile.apiKey));
      }
      assert.equal(profileProblem({...profile,model:''}),t('m1e'));
    }
    setUiLanguage('zh-CN');
  });
  test(`${method}: root auth HTML does not trigger a retry`,async()=>{
    const {api,calls}=provider([{status:401,text:'<html>unauthorized'}]);
    await assert.rejects(invoke(api,method),e=>e.code===ERR.CONFIG);
    assert.equal(calls.length,1);
  });
  test(`${method}: cancellation between the root and retry prevents a second network dispatch`,async()=>{
    const ctrl=new AbortController();let count=0;
    const api=createProviders({fetchImpl:async()=>{
      count++;return {status:404,headers:new Headers(),text:async()=>{ctrl.abort();return '{}';}};
    }});
    await assert.rejects(invoke(api,method,profile,{signal:ctrl.signal}),e=>e.code===ERR.CANCELLED);
    assert.equal(count,1);
  });
}

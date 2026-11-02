import test from 'node:test';
import assert from 'node:assert/strict';
import {createGMHttp, asFetch} from '../../extension/platform/http.js';
import {classify, toErrorInfo, DLError} from '../../extension/shared/errors.js';
import {ERR} from '../../extension/shared/protocol.js';
import {setUiLanguage, t} from '../../extension/shared/i18n.js';
import {createMT} from '../../extension/background/mt.js';
import {createProviders} from '../../extension/background/providers.js';
import {createTranslator} from '../../extension/background/translator.js';
import {mergeSettings, DEFAULT_SETTINGS} from '../../extension/shared/settings.js';

for (const timeoutMs of [undefined, 0, -1, NaN, 1200]) test(`GM timeout option: ${timeoutMs}`, async () => {
  let options;
  const http = createGMHttp(req => {
    options = req;
    queueMicrotask(() => req.onload({status:200, responseText:'ok'}));
    return {};
  });
  await http({url:'https://example.com', ...(timeoutMs === undefined ? {} : {timeoutMs})});
  assert.equal(Object.hasOwn(options, 'timeout'), timeoutMs > 0);
  if (timeoutMs > 0) assert.equal(options.timeout, timeoutMs);
});

test('asFetch omits GM timeout and forwards provider cancellation to the handle', async () => {
  let options, aborted = 0;
  const ctrl = new AbortController();
  const pending = asFetch(createGMHttp(req => {options = req; return {abort(){aborted++; req.onabort();}};}))(
    'https://example.com', {signal:ctrl.signal});
  assert.equal(Object.hasOwn(options, 'timeout'), false);
  ctrl.abort();
  await assert.rejects(pending, {name:'AbortError'});
  assert.equal(aborted, 1);
});

for (const language of ['zh-CN', 'en']) test(`GM diagnostics survive wire, MT and provider classification: ${language}`, async () => {
  setUiLanguage(language);
  for (const [event, response, reason, key] of [
    ['onerror', {status:0,error:'not permitted to access https://example.com/?token=private-test'}, 'gm_denied', 'errGmDeniedDetail'],
    ['onerror', {status:403,error:'Request was blocked by the user'}, 'gm_denied', 'errGmDeniedDetail'],
    ['onerror', {status:0,error:'net::ERR_NAME_NOT_RESOLVED'}, 'gm_dns', 'errGmDnsDetail'],
    ['onerror', {status:0,error:'net::ERR_CONNECTION_REFUSED'}, 'gm_refused', 'errGmRefusedDetail'],
    ['onerror', {status:502,error:'untrusted opaque-test-key'}, 'gm_error', 'errGm'],
    ['ontimeout', {status:0,error:'private-test'}, 'gm_timeout', 'errGmTimeoutDetail'],
    ['ontimeout', undefined, 'gm_timeout', 'errGmTimeoutDetail'],
  ]) {
    const http = createGMHttp(req => {queueMicrotask(() => req[event](response)); return {};});
    const inspect = error => {
      assert.ok(error instanceof DLError);
      const info = toErrorInfo(error);
      assert.equal(info.category, event === 'ontimeout' ? 'timeout' : 'gm');
      assert.equal(info.serverCode, reason);
      assert.ok(info.detail.includes(t(key)), info.detail);
      if (response?.status != null) {
        assert.equal(info.status, response.status);
        // Status 0 means the manager never got an HTTP answer; it is kept but not shown.
        if (response.status > 0) assert.ok(info.detail.includes(`HTTP ${response.status}`));
        else assert.ok(!info.detail.includes('HTTP 0'), info.detail);
      }
      const partial = classify({...info, code:ERR.PARTIAL, count:2});
      assert.ok(partial.detail.includes(t(key)));
      assert.ok(classify(JSON.parse(JSON.stringify(info))).detail.includes(t(key)));
      assert.doesNotMatch(JSON.stringify(error) + JSON.stringify(info), /private-test|opaque-test-key|example\.com/);
      return true;
    };
    await assert.rejects(http({url:'https://example.com', body:'opaque-test-key'}), inspect);
    let results;
    await createMT({fetchImpl:asFetch(http)}).translate({items:[{id:1,text:'synthetic text'}],to:'zh-CN',chain:['google'],onResults:list=>{results=list;}});
    assert.ok(results[0].error.detail.includes(t(key)));
    assert.equal(results[0].error.serverCode, reason);
    const api = createProviders({fetchImpl:asFetch(http)});
    await assert.rejects(api.listModels({id:'test',kind:'openai',baseUrl:'https://example.com/v1',model:'test'}), inspect);
  }
  assert.equal(classify({serverCode:'untrusted opaque-test-key',detail:'untrusted opaque-test-key'}).detail,t('errNoDetail'));
  setUiLanguage('zh-CN');
});

test('provider-owned MT and LLM timeouts still abort GM without a manager timeout', async () => {
  let requests = 0, aborts = 0;
  const http = createGMHttp(req => {
    requests++;
    assert.equal(Object.hasOwn(req, 'timeout'), false);
    return {abort(){aborts++;req.onabort();}};
  });
  let results;
  await createMT({fetchImpl:asFetch(http),timeoutMs:10}).translate({items:[{id:1,text:'synthetic'}],to:'zh-CN',chain:['google'],onResults:list=>{results=list;}});
  assert.equal(results[0].error.category,'timeout');
  await assert.rejects(createProviders({fetchImpl:asFetch(http)}).listModels({id:'test',kind:'openai',baseUrl:'https://example.com/v1',model:'test',timeoutMs:10}),e=>classify(e).category==='timeout');
  assert.equal(requests,2); assert.equal(aborts,2);
});

test('GM diagnostics survive MT cooldown and one-shot text translation', async () => {
  let requests = 0;
  const http = createGMHttp(req => {requests++;queueMicrotask(()=>req.onerror({status:0,error:'not permitted'}));return {};});
  const mt = createMT({fetchImpl:asFetch(http),now:()=>0});
  const settings = mergeSettings(DEFAULT_SETTINGS,{provider:{active:'',chain:[]},translation:{mode:'mt',mt:{engine:'google',fallback:false}},cache:{enabled:false}});
  const translator = createTranslator({mt,getSettings:async()=>settings});
  for (let i = 0; i < 3; i++) {
    await assert.rejects(translator.translateTextEx({text:'synthetic text',to:'zh-CN'}),e=>toErrorInfo(e).serverCode==='gm_denied');
  }
  assert.equal(requests,1,'cooldown should not issue another request');
  mt.resetCooldowns();
  await assert.rejects(translator.translateTextEx({text:'synthetic text',to:'zh-CN'}),e=>toErrorInfo(e).serverCode==='gm_denied');
  assert.equal(requests,2);
});

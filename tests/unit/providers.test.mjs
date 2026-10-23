import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, parseRetryAfter, isLocalHost, profileProblem } from '../../extension/background/providers.js';
import { ERR } from '../../extension/shared/protocol.js';
import { sleep } from './helpers.mjs';

const localProvider = (over = {}) => ({
  id: 'localProvider',
  kind: 'openai',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'example/model',
  timeoutMs: 500,
  ...over,
});
const openai = (over = {}) => ({
  id: 'openai',
  kind: 'openai',
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-test-0123456789',
  model: 'gpt-x',
  timeoutMs: 500,
  ...over,
});
const messages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '<seg id="1">Hello <g0>world</g0></seg>\n<seg id="2">A &amp; B</seg>' },
];

// Fake fetch: records requests, replies with a canned response or the result of a function.
function fakeFetch(reply) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const r = typeof reply === 'function' ? await reply(url, init) : reply;
    if (r instanceof Error) throw r;
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status ?? 200, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, text: async () => r.body ?? '' };
  };
  f.calls = calls;
  return f;
}
const ok = (content) => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) });

test('local keyless service: POSTs to /chat/completions, temperature 0.2', async () => {
  const f = fakeFetch(ok('<seg id="1">你好</seg>'));
  const { chat } = createProviders({ fetchImpl: f });
  const text = await chat({ profile: localProvider(), model: 'ollama/qwen3:4b', messages });
  assert.equal(text, '<seg id="1">你好</seg>');
  const [c] = f.calls;
  assert.equal(c.url, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.body.model, 'ollama/qwen3:4b');
  assert.equal(c.body.temperature, 0.2);
  assert.equal(c.body.stream, true);
  assert.deepEqual(c.body.messages, messages);
  assert.equal(c.init.headers.Authorization, undefined);
  assert.equal(c.init.credentials, 'omit');
  assert.doesNotMatch(JSON.stringify(c), /should-not-be-sent/);
});

test('openai: Bearer key, trailing slash on baseUrl tolerated', async () => {
  const f = fakeFetch(ok('x'));
  const { chat } = createProviders({ fetchImpl: f });
  await chat({ profile: openai(), model: 'gpt-x', messages });
  assert.equal(f.calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sk-test-0123456789');
});

test('content given as an array of parts is joined', async () => {
  const f = fakeFetch({ body: JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }) });
  assert.equal(await createProviders({ fetchImpl: f }).chat({ profile: localProvider(), model: 'm', messages }), 'ab');
});

test('429 maps to rate_limited and reads Retry-After (seconds or date)', async () => {
  const { chat } = createProviders({ fetchImpl: fakeFetch({ status: 429, headers: { 'Retry-After': '7' }, body: '{"error":{"message":"slow down"}}' }) });
  await assert.rejects(chat({ profile: localProvider(), model: 'm', messages }), (e) => {
    assert.equal(e.code, ERR.RATE_LIMITED);
    assert.equal(e.retryAfterMs, 7000);
    assert.equal(e.status, 429);
    assert.match(e.message, /slow down/);
    return true;
  });
  const future = new Date(Date.now() + 30000).toUTCString();
  const g = createProviders({ fetchImpl: fakeFetch({ status: 429, headers: { 'retry-after': future } }) });
  await assert.rejects(g.chat({ profile: localProvider(), model: 'm', messages }), (e) => e.retryAfterMs > 25000 && e.retryAfterMs <= 30000);
  const none = createProviders({ fetchImpl: fakeFetch({ status: 429 }) });
  await assert.rejects(none.chat({ profile: localProvider(), model: 'm', messages }), (e) => e.code === ERR.RATE_LIMITED && e.retryAfterMs === undefined);
});

test('status mapping: 401/403 config, 5xx and other 4xx provider', async () => {
  const code = async (status) => {
    const { chat } = createProviders({ fetchImpl: fakeFetch({ status, body: '{"error":{"message":"nope"}}' }) });
    try {
      await chat({ profile: openai(), model: 'm', messages });
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(await code(401), ERR.CONFIG);
  assert.equal(await code(403), ERR.CONFIG);
  assert.equal(await code(404), ERR.PROVIDER);
  assert.equal(await code(500), ERR.PROVIDER);
  assert.equal(await code(503), ERR.PROVIDER);
});

test('the API key never appears in error messages, even when the server echoes it', async () => {
  const key = 'sk-test-0123456789';
  const { chat } = createProviders({ fetchImpl: fakeFetch({ status: 401, body: JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }) }) });
  await assert.rejects(chat({ profile: openai({ apiKey: key }), model: 'm', messages }), (e) => {
    assert.doesNotMatch(e.message, /sk-test-0123456789/);
    assert.match(e.message, /HTTP 401/);
    return true;
  });
});

test('malformed responses map to parse_error', async () => {
  const bad = async (reply) => {
    const { chat } = createProviders({ fetchImpl: fakeFetch(reply) });
    try {
      await chat({ profile: localProvider(), model: 'm', messages });
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(await bad({ body: 'not json' }), ERR.PARSE);
  assert.equal(await bad({ body: '{}' }), ERR.PARSE);
  assert.equal(await bad({ body: '{"choices":[]}' }), ERR.PARSE);
});

test('network failure maps to network_error with the service host and no URL path', async () => {
  const { chat } = createProviders({ fetchImpl: fakeFetch(new TypeError('Failed to fetch')) });
  await assert.rejects(chat({ profile: localProvider(), model: 'm', messages }), (e) => {
    assert.equal(e.code, ERR.NETWORK);
    assert.match(e.message, /127\.0\.0\.1:1234/);
    assert.doesNotMatch(e.message, /\/v1/);
    return true;
  });
});

test('timeout aborts the request and reports network_error', async () => {
  let aborted = false;
  const f = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  const { chat } = createProviders({ fetchImpl: f });
  await assert.rejects(chat({ profile: localProvider({ timeoutMs: 30 }), model: 'm', messages }), (e) => e.code === ERR.NETWORK && /超时/.test(e.message));
  assert.equal(aborted, true);
});

test('every compatible service retains its configured first-response timeout', async () => {
  const f = fakeFetch(ok('hello'));
  const { chat } = createProviders({ fetchImpl: f });
  for (const profile of [localProvider({timeoutMs:130000}), openai({timeoutMs:130000})]) {
    await chat({profile,messages}); assert.equal(f.calls.at(-1).init.timeoutMs,130000);
  }
});

test('localProvider streaming: first token may arrive late, then the configured idle timeout detects a stall',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const flush=()=>new Promise(r=>setImmediate(r));
  let stream,aborted=false;
  const f=async(url,init)=>new Response(new ReadableStream({start(c){
    stream=c;init.signal.addEventListener('abort',()=>{aborted=true;c.error(new DOMException('aborted','AbortError'));});
  }}),{headers:{'Content-Type':'text/event-stream'}});
  const outcome=createProviders({fetchImpl:f}).chat({profile:localProvider({timeoutMs:130000}),model:'auto',messages}).then(()=>'finished',e=>e);
  await flush();
  t.mock.timers.tick(100000);await flush();
  assert.equal(aborted,false,'100 s before the first token is still within the first-token allowance');
  stream.enqueue(new TextEncoder().encode('data: {"model":"ollama/qwen3:4b","choices":[{"delta":{"content":"a"}}]}\n\n'));await flush();
  t.mock.timers.tick(129900);await flush();
  assert.equal(aborted,false);
  t.mock.timers.tick(200);
  const e=await outcome;
  assert.equal(aborted,true);assert.equal(e.code,ERR.NETWORK);assert.match(e.message,/超时（130 秒）/);
});

test('every error status keeps Retry-After and its machine-readable code',async()=>{
  const {chat}=createProviders({fetchImpl:fakeFetch({status:503,headers:{'Retry-After':'3'},body:'{"error":{"code":"service_unavailable","message":"No backend"}}'})});
  await assert.rejects(chat({profile:localProvider(),model:'auto',messages}),e=>e.status===503&&e.serverCode==='service_unavailable'&&e.retryAfterMs===3000);
  const busy=createProviders({fetchImpl:fakeFetch({status:429,headers:{'Retry-After':'2'},body:'{"error":{"code":"rate_limit_exceeded"}}'})});
  await assert.rejects(busy.chat({profile:localProvider(),model:'auto',messages}),e=>e.code===ERR.RATE_LIMITED&&e.serverCode==='rate_limit_exceeded'&&e.retryAfterMs===2000);
});

test('an external abort reports cancelled', async () => {
  const f = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const { chat } = createProviders({ fetchImpl: f });
  const ctrl = new AbortController();
  const p = chat({ profile: localProvider({ timeoutMs: 5000 }), model: 'm', messages, signal: ctrl.signal });
  await sleep(5);
  ctrl.abort();
  await assert.rejects(p, (e) => e.code === ERR.CANCELLED);
  await assert.rejects(chat({ profile: localProvider(), model: 'm', messages, signal: ctrl.signal }), (e) => e.code === ERR.CANCELLED);
});

test('config problems are caught before any request is made', async () => {
  const f = fakeFetch(ok('x'));
  const { chat } = createProviders({ fetchImpl: f });
  for (const profile of [
    openai({ baseUrl: '' }),
    openai({ model: '' }),
    openai({ baseUrl: 'ftp://x/v1' }),
    openai({ baseUrl: 'http://api.example.com/v1' }), // key over plain http to a remote host
    openai({ apiKey: 'bad\nkey' }),
    { kind: 'wat', baseUrl: 'http://127.0.0.1/v1', model: 'm' },
  ]) {
    await assert.rejects(chat({ profile, model: profile.model, messages }), (e) => e.code === ERR.CONFIG, JSON.stringify(profile.baseUrl));
  }
  assert.equal(f.calls.length, 0);
});

test('profileProblem and isLocalHost', () => {
  assert.equal(profileProblem(localProvider()), null);
  assert.equal(profileProblem(openai()), null);
  assert.equal(profileProblem({ kind: 'mock' }), null);
  assert.equal(profileProblem(openai({ baseUrl: ('http://192.'+'168.1.5:8000/v1') })), null);
  assert.equal(profileProblem(openai({ baseUrl: 'http://localhost:11434/v1', apiKey: '' })), null);
  assert.equal(profileProblem(openai({ baseUrl: 'http://api.example.com/v1', apiKey: '' })), null); // no secret, nothing to leak
  assert.ok(profileProblem(null));
  for (const h of ['localhost', '127.0.0.1', ('10.'+'1.2.3'), '172.'+'16.0.1', '172.'+'31.9.9', '192.'+'168.0.1', 'nas', 'box.local', '[::1]']) {
    assert.equal(isLocalHost(h), true, h);
  }
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1']) assert.equal(isLocalHost(h), false, h);
});

test('parseRetryAfter', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('1.5'), 1500);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
  assert.equal(parseRetryAfter(new Date(1000 + 5000).toUTCString(), 1000), 5000 - (1000 % 1000));
  assert.equal(parseRetryAfter(new Date(0).toUTCString(), 99999), 0);
});

test('listModels: OpenAI shape, dedup and sort; errors map like chat', async () => {
  const f = fakeFetch({ body: JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { name: 'c-name' }] }) });
  const { listModels } = createProviders({ fetchImpl: f });
  const models = await listModels(openai());
  assert.deepEqual(models.map((m) => m.id), ['a', 'b', 'c-name']);
  assert.equal(f.calls[0].url, 'https://api.example.com/v1/models');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sk-test-0123456789');
  const g = createProviders({ fetchImpl: fakeFetch({ status: 500 }) });
  await assert.rejects(g.listModels(localProvider()), (e) => e.code === ERR.PROVIDER);
  const noKey = fakeFetch({ body: '{"data":[]}' });
  await createProviders({ fetchImpl: noKey }).listModels(localProvider({ model: '' }));
  assert.equal(noKey.calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(await createProviders().listModels({ kind: 'mock' }).then((m) => m.map((x) => x.id)), ['mock', 'mock-error', 'mock-slow']);
});

test('mock: prefixes every segment, keeps markers and ids, never touches the network', async () => {
  const delays = [];
  const { chat } = createProviders({
    fetchImpl: () => assert.fail('mock must not use fetch'),
    sleep: async (ms) => delays.push(ms),
    random: () => 0.5,
  });
  const out = await chat({ profile: { kind: 'mock', model: 'mock' }, model: 'mock', messages });
  assert.equal(out, '<seg id="1">【译】Hello <g0>world</g0></seg>\n<seg id="2">【译】A &amp; B</seg>');
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 30 && delays[0] <= 120);
});

test('mock: delay range and special models', async () => {
  const seen = [];
  const { chat } = createProviders({ sleep: async (ms) => seen.push(ms), random: () => 0 });
  await chat({ profile: { kind: 'mock' }, model: 'mock', messages });
  const hi = createProviders({ sleep: async (ms) => seen.push(ms), random: () => 0.999999 });
  await hi.chat({ profile: { kind: 'mock' }, model: 'mock', messages });
  assert.deepEqual(seen, [30, 120]);
  await assert.rejects(chat({ profile: { kind: 'mock' }, model: 'mock-error', messages }), (e) => e.code === ERR.PROVIDER);
  assert.equal(await chat({ profile: { kind: 'mock' }, model: 'mock', messages: [{ role: 'user', content: 'plain' }] }), '【译】plain');
});

test('mock: abortable', async () => {
  const { chat } = createProviders();
  const ctrl = new AbortController();
  const p = chat({ profile: { kind: 'mock' }, model: 'mock', messages, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.code === ERR.CANCELLED);
});

// The settings page and the userscript wrap transport in a buffered text() call with plain-object headers;
// an OpenAI-compatible server that streams (as requested) must still parse, not fail as "not JSON".
test('buffered SSE replies (wrapped transports, plain-object headers) are parsed as a stream', async () => {
  const sse = (events) => events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join('');
  const chunk = (content, finish = null) => ({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] });
  const wrapped = (body, headers) => async () => ({ status: 200, headers, text: async () => body });
  const cases = [
    [sse([chunk('{"t":["你好，'), chunk('世界。"]}'), '[DONE]']), { 'content-type': 'text/event-stream; charset=utf-8' }],
    [sse([chunk('{"t":["你好，'), chunk('世界。"]}', 'stop')]), {}], // no [DONE], no content-type: recognised by "data:"
  ];
  for (const [body, headers] of cases) {
    const p = createProviders({ fetchImpl: wrapped(body, headers), getSecret: async () => '' });
    const content = await p.chat({ profile: openai(), messages });
    assert.equal(content, '{"t":["你好，世界。"]}');
  }
  // A truncated stream (no [DONE], no finish_reason) is still reported as incomplete.
  const truncated = createProviders({ fetchImpl: wrapped(sse([chunk('{"t":["你好')]), {}), getSecret: async () => '' });
  await assert.rejects(truncated.chat({ profile: openai(), messages }), e => e.code === ERR.PROVIDER);
});

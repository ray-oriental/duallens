import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSEParser, createTranslationStream } from '../../extension/shared/stream.js';
import { createProviders } from '../../extension/background/providers.js';
import { createGMHttp, asFetch } from '../../extension/platform/http.js';
import { TranslateClient } from '../../extension/content/client.js';
import { makeRig, run, readSegs, sleep, testProfile } from './helpers.mjs';

const profile = { id: 'local', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'test', timeoutMs: 100 };
const event = text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\r\n\r\n';
const wire = event('{"t":[') + event('"你好","世界"]}') + 'data: [DONE]\r\n\r\n';

test('JSON strings are emitted at every possible chunk boundary, with escaped quotes, slashes, unicode and newlines', () => {
  const values = ['你好"\\\n', '世界 😀 \u0001', 'literal ], {"t": and \\u1234'];
  const text = JSON.stringify({ t: values });
  for (let split = 0; split <= text.length; split++) {
    const out = [], parser = createTranslationStream(3, (i, value) => out.push([i, value]));
    parser.push(text.slice(0, split)); parser.push(text.slice(split));
    assert.deepEqual(out, values.map((v, i) => [i, v.trim()])); assert.equal(parser.valid(), true);
  }
  const out = [], p = createTranslationStream(3, (_, value) => out.push(value));
  for (const ch of text) p.push(ch);
  assert.deepEqual(out, values.map(v => v.trim())); assert.equal(p.valid(), true);
});

test('malformed, interrupted, extra and missing items never validate', () => {
  for (const text of ['{"t":["one"', '{"t":["one"]}', '{"t":["one","two","extra"]}', '{"t":[42,"two"]}', '{"t":["bad\\x","two"]}']) {
    const p = createTranslationStream(2, () => {}); p.push(text); assert.equal(p.valid(), false);
  }
});

test('SSE handles CRLF, multiline data, comments and every byte-sized text boundary', () => {
  const out = [], p = createSSEParser(s => out.push(s));
  for (const ch of ': ping\r\ndata: one\r\ndata: two\r\n\r\ndata: end\n\n') p.push(ch);
  p.end(); assert.deepEqual(out, ['one\ntwo', 'end']);
});

test('native fetch SSE decodes split UTF-8 and reports data before response completion', async () => {
  const bytes = new TextEncoder().encode(wire), out = [];
  const providers = createProviders({ fetchImpl: async (_, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response(new ReadableStream({ start(ctrl) { for (const b of bytes) ctrl.enqueue(Uint8Array.of(b)); ctrl.close(); } }),
      { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal(await providers.chat({ profile, messages: [], onDelta: s => out.push(s) }), '{"t":["你好","世界"]}');
  assert.equal(out.length, 2);
});

test('an endpoint rejecting stream falls back once and remembers non-streaming support', async () => {
  const sent = [];
  const providers = createProviders({ fetchImpl: async (_, init) => {
    const payload = JSON.parse(init.body); sent.push(payload.stream);
    return payload.stream ? new Response('{"error":{"message":"stream unsupported"}}', { status: 400 })
      : new Response('{"choices":[{"message":{"content":"answer"}}]}');
  } });
  for (let i = 0; i < 2; i++) assert.equal(await providers.chat({ profile, messages: [] }), 'answer');
  assert.deepEqual(sent, [true, false, false]);
});

test('secret redaction spans SSE event boundaries before any partial callback', async () => {
  const secret = 'sk-test-not-real', out = [];
  const providers = createProviders({ getSecret: async () => secret, fetchImpl: async () =>
    new Response(event('prefix sk-test-') + event('not-real suffix') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.equal(await providers.chat({ profile, messages: [], onDelta: s => out.push(s) }), 'prefix *** suffix');
  assert.equal(out.join(''), 'prefix *** suffix');
});

test('a cancelled streaming request reports no subsequent items', async () => {
  const ctrl = new AbortController(), seen = [];
  const rig = makeRig({ provider: async ({ onDelta }) => {
    onDelta('{"t":["第一段",'); ctrl.abort(); onDelta('"第二段"]}'); return '{"t":["第一段","第二段"]}';
  } });
  await run(rig, { items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] },
    { signal: ctrl.signal, onPartial: values => seen.push(...values) });
  assert.deepEqual(seen.map(v => v.id), ['a']);
});

test('GM progress/readystatechange do not duplicate chunks; no progress support still decodes at onload', async () => {
  for (const progress of [false, true]) {
    const out = [];
    const http = createGMHttp(req => {
      const response = { status: 200, responseHeaders: 'Content-Type: text/event-stream', responseText: '' };
      queueMicrotask(() => {
        if (progress) for (const ch of wire) { response.responseText += ch; req.onprogress(response); req.onreadystatechange(response); }
        response.responseText = wire; req.onload(response);
      });
      return { abort() {} };
    });
    const providers = createProviders({ fetchImpl: asFetch(http) });
    assert.equal(await providers.chat({ profile, messages: [], onDelta: s => out.push(s) }), '{"t":["你好","世界"]}');
    assert.equal(out.join(''), '{"t":["你好","世界"]}');
  }
});

test('stream truncation fails and inactivity timeout cancels reader; incremental data resets timeout', async () => {
  const truncated = createProviders({ fetchImpl: async () => new Response(event('prefix'), { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(truncated.chat({ profile, messages: [] }), e => e.status === 502);
  let cancelled = false;
  const stalled = createProviders({ fetchImpl: async (_, init) => new Response(new ReadableStream({
    start(ctrl) { init.signal.addEventListener('abort', () => { cancelled = true; ctrl.error(new Error('aborted')); }); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects(stalled.chat({ profile: { ...profile, timeoutMs: 15 }, messages: [] }), /超时/);
  assert.equal(cancelled, true);
  const streaming = createProviders({ fetchImpl: async () => new Response(new ReadableStream({ async start(ctrl) {
    for (let i = 0; i < 5; i++) { await sleep(12); ctrl.enqueue(new TextEncoder().encode(event('x'))); }
    ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); ctrl.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.equal(await streaming.chat({ profile: { ...profile, timeoutMs: 40 }, messages: [] }), 'xxxxx');
});

test('translator displays a complete string before the provider finishes and validates before caching', async () => {
  let release, early;
  const blocked = new Promise(r => { release = r; });
  const rig = makeRig({ provider: async ({ onDelta }) => { onDelta('{"t":["第一段",'); await blocked; onDelta('"第二段"]}'); return '{"t":["第一段","第二段"]}'; } });
  const pending = run(rig, { items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] }, { onPartial: r => { early = r; } });
  await sleep(15); assert.equal(early[0].text, '第一段'); assert.equal(await rig.cache.count(), 0);
  release(); await pending; assert.equal(await rig.cache.count(), 2);
});

test('length mismatch uses whole-batch validation and half-size retry, with no duplicate callbacks', async () => {
  let calls = 0;
  const rig = makeRig({ provider: async ({ messages, onDelta }) => {
    calls++; const t = readSegs(messages).map(s => '译' + s.text);
    const result = JSON.stringify({ t: calls === 1 ? t.slice(0, 1) : t });
    onDelta(result); return result;
  } });
  const r = await run(rig, { items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] });
  assert.equal(calls, 3); assert.equal(r.total, 2); assert.equal(r.results.get('b').text, '译two');
});

test('one-shot text requires final validation even when a malformed stream has already emitted a string', async () => {
  const rig = makeRig({ provider: async ({ onDelta }) => {
    const content = '{"t":["invalid prefix","extra"]}'; onDelta(content); return content;
  } });
  await assert.rejects(rig.translator.translateText({ text: 'hello', to: 'zh-CN' }), e => e.code === 'parse_error');
  assert.equal(await rig.cache.count(), 0);
});

test('first visible batch caps at six items and 2000 chars, subsequent batch uses profile budget', async () => {
  const sizes = [];
  const rig = makeRig({ profile: testProfile({ maxItems: 20, maxChars: 4000 }), provider: async ({ messages }) => {
    const segs = readSegs(messages); sizes.push(segs.map(s => s.text)); return JSON.stringify({ t: segs.map(s => '译' + s.text) });
  } });
  await run(rig, { items: Array.from({ length: 14 }, (_, i) => ({ id: i, text: String(i) + 'x'.repeat(350) })) });
  assert.ok(sizes[0].length <= 6); assert.ok(sizes[0].join('').length <= 2000);
  assert.ok(sizes[1].length > sizes[0].length);
});

test('visible work gates prefetch, synchronous callbacks and cancelAll do not leak or dispatch queued jobs', async () => {
  const started = [], callbacks = [];
  const client = new TranslateClient({ translator: () => ({ translateBatch(req, callback) {
    started.push(req.priority); callbacks.push(() => callback(req.items)); return { cancel() {} };
  } }) });
  client.request({ priority: 1, items: [{ id: 'near' }] }, {});
  client.request({ priority: 0, items: [{ id: 'visible' }] }, {});
  await sleep(0); assert.deepEqual(started, [0]); callbacks[0](); assert.deepEqual(started, [0, 1]);
  client.cancelAll(); assert.equal(client.outstanding(), 0);
  const sync = new TranslateClient({ translator: () => ({ translateBatch(req, callback) { callback(req.items); return { cancel() {} }; } }) });
  let done = 0; sync.request({ items: [{ id: 1 }] }, { onDone: () => done++ }); assert.equal(sync.outstanding(), 0); assert.equal(done, 1);
});

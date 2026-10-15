import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MT_ENGINES, MT_PLACEHOLDER, chunkItems, createMT, deeplTarget, finishItem, googleLang, hasMarkers, msLang, mtChain, sameMarkers,
} from '../../extension/background/mt.js';
import { ERR } from '../../extension/shared/protocol.js';

// A scripted fetch: route(url, init, call) -> { status?, body, headers? } | throws.
function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = { url, method: init.method, headers: init.headers || {}, body: init.body, signal: init.signal };
    calls.push(call);
    const out = await route(url, init, call);
    return { status: out.status ?? 200, headers: { get: (name) => out.headers?.[String(name).toLowerCase()] ?? null }, text: async () => out.body ?? '' };
  };
  fn.calls = calls;
  return fn;
}
const msBody = (...texts) => JSON.stringify(texts.map(text => ({ detectedLanguage: { language: 'en', score: 1 }, translations: [{ text, to: 'zh-Hans' }] })));
const sentBodies = (fetch) => fetch.calls.map(c => JSON.parse(c.body));
async function run(mt, items, over = {}) {
  const got = [];
  await mt.translate({ items, to: 'zh-CN', from: 'auto', chain: ['microsoft'], onResults: (list) => got.push(...list), ...over });
  return new Map(got.map(r => [r.id, r]));
}

test('chain order: primary first, the free engines as fallback, mock alone', () => {
  assert.deepEqual(mtChain(), ['microsoft', 'google']);
  assert.deepEqual(mtChain({ engine: 'google' }), ['google', 'microsoft']);
  assert.deepEqual(mtChain({ engine: 'deepl' }), ['deepl', 'microsoft', 'google']);
  assert.deepEqual(mtChain({ engine: 'deepl', fallback: false }), ['deepl']);
  assert.deepEqual(mtChain({ engine: 'mock' }), ['mock']);
  assert.deepEqual(mtChain({ engine: 'unknown-engine' }), ['microsoft', 'google']);
  assert.ok(MT_ENGINES.every(e => e.id && e.name));
});

test('language codes follow each vendor', () => {
  assert.equal(msLang('zh-CN'), 'zh-Hans');
  assert.equal(msLang('zh-TW'), 'zh-Hant');
  assert.equal(msLang('auto'), '');
  assert.equal(msLang('ja'), 'ja');
  assert.equal(googleLang('auto'), 'auto');
  assert.equal(googleLang('zh-CN'), 'zh-CN');
  assert.equal(deeplTarget('zh-CN'), 'ZH-HANS');
  assert.equal(deeplTarget('en'), 'EN-US');
  assert.equal(deeplTarget('ja'), 'JA');
});

test('placeholder validation: same markers survive, anything else degrades to plain text', () => {
  const src = 'Hi <g0>there</g0> and <x1/> <g2>you <g3>all</g3></g2>';
  assert.equal(hasMarkers(src), true);
  assert.equal(hasMarkers('Tom &amp; Jerry'), false);
  assert.equal(sameMarkers(src, '你好<g0>那里</g0>和<x1/><g2>大家<g3>全部</g3></g2>'), true);
  assert.equal(sameMarkers(src, '你好<g0>那里</g0>和<g2>大家<g3>全部</g3></g2>'), false, 'a dropped <x1/>');
  assert.equal(sameMarkers(src, '你好<g0>那里</g0>和<x1/><x1/><g2>大家<g3>全部</g3></g2>'), false, 'a duplicated <x1/>');
  assert.equal(sameMarkers(src, '你好<g0>那里和<x1/><g2>大家</g0><g3>全部</g3></g2>'), false, 'broken nesting');
  assert.deepEqual(finishItem(src, '你好<g0>那里</g0>和<x1></x1><g2>大家<g3>全部</g3></g2>', true), { text: '你好<g0>那里</g0>和<x1/><g2>大家<g3>全部</g3></g2>' }, '<x1></x1> is normalized');
  assert.deepEqual(finishItem(src, '你好&amp;那里<g0>和</g0>', true), { text: '你好&amp;那里和', plain: true });
  assert.deepEqual(finishItem('a &lt; b', 'a < b', false), { text: 'a &lt; b' }, 'plain output is re-escaped for the markup protocol');
});

test('chunking: a small first request, then bigger ones, by items and characters', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(10) }));
  const chunks = chunkItems(items, { firstItems: 5, firstChars: 1000, maxItems: 20, maxChars: 1000 });
  assert.deepEqual(chunks.map(c => c.length), [5, 20, 20, 5]);
  const long = chunkItems([{ id: 1, text: 'a'.repeat(30) }, { id: 2, text: 'b'.repeat(30) }, { id: 3, text: 'c' }], { firstItems: 9, firstChars: 40, maxItems: 9, maxChars: 40 });
  assert.deepEqual(long.map(c => c.map(x => x.id)), [[1], [2, 3]]);
});

test('microsoft (free): plain items go unescaped as plain, marked items as html, results are re-escaped', async () => {
  const fetch = fakeFetch((url, init) => {
    const texts = JSON.parse(init.body);
    return { body: msBody(...texts.map(t => (/<g0>/.test(t) ? '你好<g0>世界</g0>' : t === 'Tom & Jerry <3' ? '汤姆 & 杰瑞 <3' : '翻译'))) };
  });
  const mt = createMT({ fetchImpl: fetch });
  const got = await run(mt, [{ id: 'a', text: 'Hello <g0>world</g0>' }, { id: 'b', text: 'Tom &amp; Jerry &lt;3' }]);
  assert.equal(fetch.calls.length, 2, 'one html request and one plain request');
  const html = fetch.calls.find(c => c.url.includes('textType=html'));
  const plain = fetch.calls.find(c => !c.url.includes('textType'));
  assert.match(html.url, /^https:\/\/edge\.microsoft\.com\/translate\/translatetext\?/);
  assert.match(html.url, /to=zh-Hans/);
  assert.doesNotMatch(html.url, /from=\w/, 'auto source omits from');
  assert.deepEqual(JSON.parse(html.body), ['Hello <g0>world</g0>']);
  assert.deepEqual(JSON.parse(plain.body), ['Tom & Jerry <3'], 'entities are decoded for plain requests');
  assert.equal(html.headers['Content-Type'], 'application/json');
  assert.deepEqual(got.get('a'), { id: 'a', engine: 'microsoft', text: '你好<g0>世界</g0>' });
  assert.deepEqual(got.get('b'), { id: 'b', engine: 'microsoft', text: '汤姆 &amp; 杰瑞 &lt;3' });
});

test('microsoft: an explicit source language is sent, and dropped markers degrade the item to plain text', async () => {
  const fetch = fakeFetch(() => ({ body: msBody('你好世界') }));
  const mt = createMT({ fetchImpl: fetch });
  const got = await run(mt, [{ id: 1, text: 'こんにちは<g0>世界</g0><x1/>' }], { from: 'ja', to: 'zh-TW' });
  assert.match(fetch.calls[0].url, /from=ja/);
  assert.match(fetch.calls[0].url, /to=zh-Hant/);
  assert.deepEqual(got.get(1), { id: 1, engine: 'microsoft', text: '你好世界', plain: true });
});

test('microsoft: a wrong item count is a parse error, not a misaligned translation', async () => {
  const fetch = fakeFetch(() => ({ body: msBody('只有一条') }));
  const mt = createMT({ fetchImpl: fetch });
  const got = await run(mt, [{ id: 1, text: 'one' }, { id: 2, text: 'two' }]);
  assert.equal(got.get(1).error.code, ERR.PARSE);
  assert.equal(got.get(2).error.code, ERR.PARSE);
});

test('401 from the tokenless endpoint switches to the token flow, and the token is cached until a minute before expiry', async () => {
  let clock = 1_000_000;
  const exp = Math.floor(clock / 1000) + 600;
  const jwt = ['e30', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'sig'].join('.');
  let tokenless = 0;
  const fetch = fakeFetch((url) => {
    if (url.startsWith('https://edge.microsoft.com/translate/translatetext')) { tokenless++; return { status: 401, body: '' }; }
    if (url === 'https://edge.microsoft.com/translate/auth') return { body: jwt };
    return { body: msBody('带令牌') };
  });
  const mt = createMT({ fetchImpl: fetch, now: () => clock });
  const first = await run(mt, [{ id: 1, text: 'one' }]);
  assert.equal(first.get(1).text, '带令牌');
  const api = fetch.calls.find(c => c.url.startsWith('https://api-edge.cognitive.microsofttranslator.com/translate?'));
  assert.equal(api.headers.Authorization, `Bearer ${jwt}`);
  assert.deepEqual(JSON.parse(api.body), [{ Text: 'one' }]);
  const authCalls = () => fetch.calls.filter(c => c.url.endsWith('/translate/auth')).length;
  assert.equal(authCalls(), 1);
  assert.equal(tokenless, 1);
  clock += 5 * 60_000; // 300 s of a 600 s token: still valid
  await run(mt, [{ id: 1, text: 'two' }]);
  assert.equal(authCalls(), 1, 'the cached token is reused');
  clock += 4 * 60_000; // inside the last minute: refreshed
  await run(mt, [{ id: 1, text: 'three' }]);
  assert.equal(authCalls(), 2);
});

test('google: auto source answers [[text, lang]], explicit source answers [text]; html format only for marked items', async () => {
  const fetch = fakeFetch((url, init) => {
    const params = new URLSearchParams(init.body);
    return { body: JSON.stringify(params.get('sl') === 'auto' ? params.getAll('q').map(q => ['译:' + q, 'en']) : params.getAll('q').map(q => '译:' + q)) };
  });
  const mt = createMT({ fetchImpl: fetch });
  const auto = await run(mt, [{ id: 1, text: 'plain & text' }], { chain: ['google'] });
  assert.equal(auto.get(1).text, '译:plain &amp; text');
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://clients5.google.com/translate_a/t');
  assert.match(call.headers['Content-Type'], /x-www-form-urlencoded/);
  const sent = new URLSearchParams(call.body);
  assert.equal(sent.get('client'), 'dict-chrome-ex');
  assert.equal(sent.get('tl'), 'zh-CN');
  assert.equal(sent.get('format'), null);
  assert.equal(sent.getAll('q')[0], 'plain & text');
  const explicit = await run(mt, [{ id: 2, text: 'hi <g0>there</g0>' }], { chain: ['google'], from: 'en' });
  assert.equal(new URLSearchParams(fetch.calls[1].body).get('format'), 'html');
  assert.equal(new URLSearchParams(fetch.calls[1].body).get('sl'), 'en');
  assert.equal(explicit.get(2).text, '译:hi <g0>there</g0>');
});

test('fallback: a failing engine hands the batch to the next, and is skipped while cooling down', async () => {
  let clock = 5000;
  const fetch = fakeFetch((url) => {
    if (url.includes('edge.microsoft.com')) return { status: 503, body: 'down' };
    return { body: JSON.stringify([['谷歌译文', 'en']]) };
  });
  const mt = createMT({ fetchImpl: fetch, now: () => clock });
  const chain = ['microsoft', 'google'];
  const a = await run(mt, [{ id: 1, text: 'one' }], { chain });
  assert.deepEqual([a.get(1).engine, a.get(1).text], ['google', '谷歌译文']);
  assert.equal(fetch.calls.filter(c => c.url.includes('edge.microsoft.com')).length, 1);
  await run(mt, [{ id: 1, text: 'two' }], { chain });
  assert.equal(fetch.calls.filter(c => c.url.includes('edge.microsoft.com')).length, 1, 'microsoft is cooling');
  clock += 20_000; // first cooldown is 15 s
  await run(mt, [{ id: 1, text: 'three' }], { chain });
  assert.equal(fetch.calls.filter(c => c.url.includes('edge.microsoft.com')).length, 2, 'retried after the cooldown');
});

test('all engines failing or cooling yields per-item errors; cooling engines cost no request', async () => {
  const fetch = fakeFetch(() => ({ status: 429, body: '', headers: { 'retry-after': '30' } }));
  const mt = createMT({ fetchImpl: fetch, now: () => 1 });
  const first = await run(mt, [{ id: 1, text: 'x' }], { chain: ['microsoft', 'google'] });
  assert.equal(first.get(1).error.code, ERR.RATE_LIMITED);
  const before = fetch.calls.length;
  const second = await run(mt, [{ id: 1, text: 'y' }], { chain: ['microsoft', 'google'] });
  assert.equal(fetch.calls.length, before, 'fail fast');
  assert.equal(second.get(1).error.code, ERR.NETWORK);
});

test('a hung request times out and falls to the next engine', async () => {
  const fetch = fakeFetch((url, init) => (url.includes('edge.microsoft.com')
    ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    : { body: JSON.stringify([['备用', 'en']]) }));
  const mt = createMT({ fetchImpl: fetch, timeoutMs: 30 });
  const got = await run(mt, [{ id: 1, text: 'x' }], { chain: ['microsoft', 'google'] });
  assert.deepEqual([got.get(1).engine, got.get(1).text], ['google', '备用']);
});

test('cancelling rejects quietly and reports nothing', async () => {
  const ctrl = new AbortController();
  const fetch = fakeFetch((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const mt = createMT({ fetchImpl: fetch });
  const seen = [];
  const pending = mt.translate({ items: [{ id: 1, text: 'x' }], to: 'zh-CN', chain: ['microsoft'], signal: ctrl.signal, onResults: l => seen.push(...l) });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(pending, (e) => e.code === ERR.CANCELLED);
  assert.deepEqual(seen, []);
});

test('deepl: key from secrets, free-tier host for :fx keys, xml tag handling only for marked items, key never in errors', async () => {
  const keys = { 'mt-deepl': 'abc123:fx' };
  const fetch = fakeFetch((url, init) => {
    const body = JSON.parse(init.body);
    return { body: JSON.stringify({ translations: body.text.map(t => ({ text: '德:' + t })) }) };
  });
  const mt = createMT({ fetchImpl: fetch, getSecret: async id => keys[id] || '' });
  const got = await run(mt, [{ id: 1, text: 'Hi <g0>there</g0>' }, { id: 2, text: 'plain' }], { chain: ['deepl'], from: 'en' });
  const free = fetch.calls.every(c => c.url === 'https://api-free.deepl.com/v2/translate');
  assert.equal(free, true);
  assert.equal(fetch.calls[0].headers.Authorization, 'DeepL-Auth-Key abc123:fx');
  const bodies = sentBodies(fetch);
  const xml = bodies.find(b => b.tag_handling);
  assert.equal(xml.tag_handling, 'xml');
  assert.equal(xml.target_lang, 'ZH-HANS');
  assert.equal(xml.source_lang, 'EN');
  assert.equal(got.get(1).text, '德:Hi <g0>there</g0>');
  assert.equal(got.get(2).text, '德:plain');
  keys['mt-deepl'] = 'paid-key-without-suffix';
  const paid = fakeFetch((url) => ({ status: 403, body: 'forbidden paid-key-without-suffix' }));
  const failing = await run(createMT({ fetchImpl: paid, getSecret: async id => keys[id] || '' }), [{ id: 1, text: 'x' }], { chain: ['deepl'] });
  assert.equal(paid.calls[0].url, 'https://api.deepl.com/v2/translate');
  assert.equal(failing.get(1).error.code, ERR.CONFIG);
  assert.doesNotMatch(JSON.stringify(failing.get(1)), /paid-key/);
});

test('keyed engines without a key are a config error and the chain moves on', async () => {
  const fetch = fakeFetch((url) => ({ body: msBody('微软') }));
  const mt = createMT({ fetchImpl: fetch });
  const got = await run(mt, [{ id: 1, text: 'x' }], { chain: ['deepl', 'microsoft'] });
  assert.deepEqual([got.get(1).engine, got.get(1).text], ['microsoft', '微软']);
  assert.equal(fetch.calls.length, 1, 'DeepL was never called without a key');
});

test('microsoft-api sends the key and the region header', async () => {
  const fetch = fakeFetch((url) => ({ body: msBody('官方') }));
  const mt = createMT({ fetchImpl: fetch, getSecret: async id => (id === 'mt-microsoft-api' ? 'KEY' : '') });
  await run(mt, [{ id: 1, text: 'x' }], { chain: ['microsoft-api'], region: 'eastasia' });
  const call = fetch.calls[0];
  assert.match(call.url, /^https:\/\/api\.cognitive\.microsofttranslator\.com\/translate\?api-version=3\.0/);
  assert.equal(call.headers['Ocp-Apim-Subscription-Key'], 'KEY');
  assert.equal(call.headers['Ocp-Apim-Subscription-Region'], 'eastasia');
  assert.deepEqual(JSON.parse(call.body), [{ Text: 'x' }]);
});

test('mock engine is offline, deterministic and keeps markers', async () => {
  const fetch = fakeFetch(() => { throw new Error('must not be called'); });
  const mt = createMT({ fetchImpl: fetch });
  const got = await run(mt, [{ id: 1, text: 'a <g0>b</g0>' }, { id: 2, text: 'x &amp; y' }], { chain: ['mock'] });
  assert.equal(got.get(1).text, `${MT_PLACEHOLDER}a <g0>b</g0>`);
  assert.equal(got.get(2).text, `${MT_PLACEHOLDER}x &amp; y`);
  assert.equal(fetch.calls.length, 0);
});

test('test(): one engine, no fallback, reports latency and a sample', async () => {
  let clock = 100;
  const fetch = fakeFetch(() => { clock += 40; return { body: msBody('你好，世界。') }; });
  const mt = createMT({ fetchImpl: fetch, now: () => clock });
  const ok = await mt.test({ engine: 'microsoft' });
  assert.deepEqual([ok.engine, ok.sample], ['microsoft', '你好，世界。']);
  assert.ok(ok.latencyMs >= 40);
  const bad = createMT({ fetchImpl: fakeFetch(() => ({ status: 500 })) });
  await assert.rejects(bad.test({ engine: 'microsoft' }), (e) => e.code === ERR.PROVIDER);
  await assert.rejects(bad.test({ engine: 'nope' }), (e) => e.code === ERR.CONFIG);
});

test('a request is not made for an empty batch and results arrive per request', async () => {
  const fetch = fakeFetch((url, init) => ({ body: msBody(...JSON.parse(init.body).map(t => '译' + t)) }));
  const mt = createMT({ fetchImpl: fetch });
  const batches = [];
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i, text: 'item ' + i }));
  await mt.translate({ items, to: 'zh-CN', chain: ['microsoft'], onResults: l => batches.push(l.length), limits: { firstItems: 10, firstChars: 9999, maxItems: 10, maxChars: 9999, concurrency: 1 } });
  assert.deepEqual(batches.sort((a, b) => a - b), [5, 10, 10]);
  const calls = fetch.calls.length;
  await mt.translate({ items: [], to: 'zh-CN', chain: ['microsoft'] });
  assert.equal(fetch.calls.length, calls);
});

test('partial MT omissions fall back only the missing items, preserving successful neighbours', async () => {
  const fetch = fakeFetch((url, init) => url.includes('edge.microsoft.com')
    ? { body: msBody('首段译文', '') }
    : { body: JSON.stringify(['备用译文']) });
  const got = await run(createMT({ fetchImpl: fetch }), [{ id: 1, text: 'First' }, { id: 2, text: 'Second' }], { chain: ['microsoft', 'google'] });
  assert.equal(got.get(1).text, '首段译文');
  assert.equal(got.get(1).engine, 'microsoft');
  assert.equal(got.get(2).text, '备用译文');
  assert.deepEqual(new URLSearchParams(fetch.calls[1].body).getAll('q'), ['Second']);
});

test('oversized inline groups are split into bounded plain pieces and reported once under the original id', async () => {
  const fetch = fakeFetch((_url, init) => ({ body: msBody(...JSON.parse(init.body)) }));
  const text = 'word '.repeat(20000).trim();
  const got = await run(createMT({ fetchImpl: fetch }), [{ id: 'long', text: `<g0>${text}</g0>` }]);
  assert.equal(got.size, 1);
  assert.equal(got.get('long').plain, true);
  assert.equal(got.get('long').text.replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.equal(got.get('long').engine, 'microsoft');
  assert.ok(fetch.calls.every(c => JSON.parse(c.body).join('').length <= 8000));
  assert.ok(fetch.calls.every(c => !c.url.includes('textType')));
});

test('mobile HTTP concurrency is bounded across separate translate calls; queued cancellation makes no request', async () => {
  let active = 0, peak = 0;
  const fetch = fakeFetch(async (_url, init) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return { body: msBody(...JSON.parse(init.body)) };
  });
  const mt = createMT({ fetchImpl: fetch, limits: { firstItems: 10, firstChars: 3000, maxItems: 12, maxChars: 8000, concurrency: 2 } });
  const ctrl = new AbortController();
  const first = run(mt, [{ id: 1, text: 'first' }]);
  const second = run(mt, [{ id: 2, text: 'second' }]);
  const cancelled = run(mt, [{ id: 3, text: 'cancelled' }], { signal: ctrl.signal });
  const rejection = assert.rejects(cancelled, e => e.code === ERR.CANCELLED);
  ctrl.abort();
  await Promise.all([first, second, rejection]);
  assert.equal(peak, 2);
  assert.equal(fetch.calls.length, 2);
  const already = new AbortController(); already.abort();
  await assert.rejects(run(mt, [{ id: 4, text: 'never' }], { signal: already.signal }), e => e.code === ERR.CANCELLED);
  assert.equal(fetch.calls.length, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache } from '../../extension/background/cache.js';
import { ERR, err, fakeProvider, makeRig, run, sleep, testProfile, testSettings, writeSegs } from './helpers.mjs';
import { mergeSettings } from '../../extension/shared/settings.js';

const items = (...texts) => texts.map((text, i) => ({ id: `i${i + 1}`, text }));
const textOf = (r, id) => r.results.get(id).text;

test('translates a request and reports each id exactly once', async () => {
  const rig = makeRig();
  const r = await run(rig, { items: items('Hello', 'World <g0>link</g0>') });
  assert.equal(textOf(r, 'i1'), '【译】Hello');
  assert.equal(textOf(r, 'i2'), '【译】World <g0>link</g0>');
  assert.equal(r.total, 2);
  assert.equal(rig.provider.calls.length, 1);
  assert.equal(rig.provider.calls[0].model, 'm1');
});

test('the page title and target language reach the prompt', async () => {
  const rig = makeRig();
  await run(rig, { items: items('Hello'), to: 'ja', context: { title: 'My Title' } });
  const sys = rig.provider.calls[0].messages[0].content;
  assert.match(sys, /Japanese/);
  assert.match(sys, /My Title/);
});

test('cache: a second identical request is answered without calling the model', async () => {
  const rig = makeRig();
  const first = await run(rig, { items: items('Hello', 'World') });
  assert.equal(rig.provider.calls.length, 1);
  assert.equal(await rig.cache.count(), 2);
  const second = await run(rig, { items: items('World', 'Hello') });
  assert.equal(rig.provider.calls.length, 1, 'no new provider call');
  assert.equal(second.batches.length, 1, 'all hits come back in one partial');
  assert.equal(textOf(second, 'i1'), textOf(first, 'i2'));
});

test('cache is keyed on target language, model, preset and glossary', async () => {
  const rig = makeRig();
  await run(rig, { items: items('Hello') });
  await run(rig, { items: items('Hello'), to: 'ja' });
  assert.equal(rig.provider.calls.length, 2, 'different target language is a miss');

  const other = makeRig({
    cache: rig.cache,
    provider: rig.provider,
    settings: testSettings({ prompt: { preset: 'tech' } }),
  });
  await run(other, { items: items('Hello') });
  assert.equal(rig.provider.calls.length, 3, 'different preset is a miss');

  const withGlossary = makeRig({
    cache: rig.cache,
    provider: rig.provider,
    settings: testSettings({ glossary: [{ src: 'Hello', dst: '你好' }] }),
  });
  await run(withGlossary, { items: items('Hello') });
  assert.equal(rig.provider.calls.length, 4, 'glossary change is a miss');
  assert.match(rig.provider.calls[3].messages[0].content, /Hello → 你好/);
});

test('cache disabled in settings: nothing is read or written', async () => {
  const rig = makeRig({ settings: testSettings({ cache: { enabled: false } }) });
  await run(rig, { items: items('Hello') });
  await run(rig, { items: items('Hello') });
  assert.equal(rig.provider.calls.length, 2);
  assert.equal(await rig.cache.count(), 0);
});

test('cache entries older than ttlDays are treated as misses', async () => {
  let clock = 1_000_000;
  const cache = createMemoryCache({ now: () => clock });
  const rig = makeRig({ cache });
  await run(rig, { items: items('Hello') });
  clock += 29 * 86400000;
  await run(rig, { items: items('Hello') });
  assert.equal(rig.provider.calls.length, 1, 'day 29: still a hit');
  clock += 2 * 86400000;
  await run(rig, { items: items('Hello') });
  assert.equal(rig.provider.calls.length, 2, 'day 31: expired');
});

test('a broken cache never breaks translation', async () => {
  const cache = {
    getMany: async () => {
      throw new Error('idb exploded');
    },
    putMany: async () => {
      throw new Error('quota');
    },
    count: async () => 0,
    clear: async () => {},
  };
  const rig = makeRig({ cache });
  const r = await run(rig, { items: items('Hello') });
  assert.equal(textOf(r, 'i1'), '【译】Hello');
});

test('identical texts in one request are translated once and fanned out', async () => {
  const rig = makeRig();
  const r = await run(rig, { items: items('Read more', 'Other', 'Read more', 'Read more') });
  assert.equal(rig.provider.calls[0].segs.length, 2);
  assert.equal(textOf(r, 'i1'), '【译】Read more');
  assert.equal(textOf(r, 'i3'), '【译】Read more');
  assert.equal(textOf(r, 'i4'), '【译】Read more');
  assert.equal(r.total, 4);
});

test('blank text is returned as-is without calling the model', async () => {
  const rig = makeRig();
  const r = await run(rig, { items: [{ id: 'a', text: '   ' }, { id: 'b', text: '' }] });
  assert.equal(r.total, 2);
  assert.equal(textOf(r, 'a'), '   ');
  assert.equal(rig.provider.calls.length, 0);
});

test('batches follow the profile limits and run concurrently', async () => {
  const rig = makeRig({ profile: testProfile({ maxItems: 3, concurrency: 2 }) });
  const r = await run(rig, { items: items('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7') });
  assert.equal(rig.provider.calls.length, 3);
  assert.deepEqual(rig.provider.calls.map((c) => c.segs.length), [3, 3, 1]);
  assert.equal(r.total, 7);
  for (let i = 1; i <= 7; i++) assert.equal(textOf(r, `i${i}`), `【译】a${i}`);
});

test('model output is mapped back by id even when reordered', async () => {
  const provider = fakeProvider(({ segs }) => writeSegs([...segs].reverse(), (t) => `<${t}>`.replace(/[<>]/g, '') + '!'));
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('one', 'two', 'three') });
  assert.deepEqual([textOf(r, 'i1'), textOf(r, 'i2'), textOf(r, 'i3')], ['one!', 'two!', 'three!']);
});

test('a missing segment is retried once on its own and then succeeds', async () => {
  let dropped = false;
  const provider = fakeProvider(({ segs }) => {
    if (!dropped && segs.length > 1) {
      dropped = true;
      return writeSegs(segs.filter((s) => s.text !== 'two'));
    }
    return writeSegs(segs);
  });
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('one', 'two', 'three') });
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(provider.calls[1].segs.map((s) => s.text), ['two']);
  assert.equal(textOf(r, 'i2'), '【译】two');
  assert.equal(r.total, 3);
  assert.equal(await rig.cache.count(), 3);
});

test('a segment missing again after the retry becomes a parse error; the rest are unaffected', async () => {
  const provider = fakeProvider(({ segs }) => writeSegs(segs.filter((s) => s.text !== 'bad')));
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('good', 'bad', 'fine') });
  assert.equal(provider.calls.length, 2, 'exactly one retry');
  assert.equal(textOf(r, 'i1'), '【译】good');
  assert.equal(textOf(r, 'i3'), '【译】fine');
  assert.equal(r.results.get('i2').error.code, ERR.PARSE);
  assert.equal(r.total, 3);
  assert.equal(await rig.cache.count(), 2, 'failures are not cached');
});

test('a bare reply after retry is rejected by JSON protocol', async () => {
  const provider = fakeProvider(({ segs, n }) => (n === 1 ? writeSegs(segs.filter((s) => s.text !== 'two')) : '好的翻译'));
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('one', 'two') });
  assert.equal(r.results.get('i2').error.code, ERR.PARSE);
});

test('a reply of pure prose fails every segment with a parse error', async () => {
  const provider = fakeProvider(() => 'I am sorry, I cannot translate this.');
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('one', 'two') });
  assert.equal(r.results.get('i1').error.code, ERR.PARSE);
  assert.equal(r.results.get('i2').error.code, ERR.PARSE);
  assert.equal(provider.calls.length, 3, 'one batch and two halves for JSON recovery');
});

test('429: the batch is retried after Retry-After and eventually succeeds', async () => {
  const provider = fakeProvider(({ segs, n }) => {
    if (n === 1) throw err(ERR.RATE_LIMITED, 'slow down', { retryAfterMs: 50 });
    return writeSegs(segs);
  });
  const rig = makeRig({ provider });
  const t0 = Date.now();
  const r = await run(rig, { items: items('Hello') });
  assert.ok(Date.now() - t0 < 200, 'fallback without waiting out primary cooldown');
  assert.equal(textOf(r, 'i1'), '【译】Hello');
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(provider.calls.map((c) => c.model), ['m1', 'm2']);
});

test('fallback: after repeated failures the batch moves to the next model and is cached under it', async () => {
  const provider = fakeProvider(({ segs, model }) => {
    if (model === 'm1') throw err(ERR.PROVIDER, 'primary down');
    return writeSegs(segs, (t) => `${model}:${t}`);
  });
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('Hello') });
  assert.deepEqual(provider.calls.map((c) => c.model), ['m1', 'm2']);
  assert.equal(textOf(r, 'i1'), 'm2:Hello');
  // while the queue sits on m2, the next request finds the m2 entry
  const again = await run(rig, { items: items('Hello') });
  assert.equal(provider.calls.length, 2);
  assert.equal(textOf(again, 'i1'), 'm2:Hello');
});

test('later batches of the same request go straight to the fallback once it is chosen', async () => {
  const provider = fakeProvider(async ({ segs, model }) => {
    await sleep(2);
    if (model === 'm1') throw err(ERR.NETWORK, 'down');
    return writeSegs(segs);
  });
  const rig = makeRig({ provider, profile: testProfile({ maxItems: 1, concurrency: 1 }) });
  const r = await run(rig, { items: items('a', 'b', 'c', 'd') });
  assert.equal(r.total, 4);
  for (const id of ['i1', 'i2', 'i3', 'i4']) assert.ok(!r.results.get(id).error, id);
  const m1 = provider.calls.filter((c) => c.model === 'm1').length;
  assert.ok(m1 <= 3, `primary was tried at most 3 times, not once per batch (${m1})`);
});

test('permanent failure reports provider errors for every id after the attempts run out', async () => {
  const provider = fakeProvider(() => {
    throw err(ERR.PROVIDER, 'always broken');
  });
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('a', 'b') });
  assert.equal(r.total, 2);
  assert.equal(r.results.get('i1').error.code, ERR.PROVIDER);
  assert.match(r.results.get('i2').error.message, /always broken/);
  assert.equal(provider.calls.length, 4);
});

test('config problems are reported without calling the model', async () => {
  const profile = testProfile({ id: 'o', kind: 'openai', baseUrl: '', apiKey: '' });
  const rig = makeRig({ profile });
  const r = await run(rig, { items: items('a', 'b') });
  assert.equal(r.results.get('i1').error.code, ERR.CONFIG);
  assert.equal(r.results.get('i2').error.code, ERR.CONFIG);
  assert.equal(rig.provider.calls.length, 0);
});

test('a config error from the provider (bad key) is not retried', async () => {
  const provider = fakeProvider(() => {
    throw err(ERR.CONFIG, '认证失败');
  });
  const rig = makeRig({ provider });
  const r = await run(rig, { items: items('a') });
  assert.equal(r.results.get('i1').error.code, ERR.CONFIG);
  assert.equal(provider.calls.length, 1);
});

test('long text is split, translated piece by piece and re-joined into one result', async () => {
  const sentence = 'This is a reasonably long sentence number X. ';
  const long = Array.from({ length: 12 }, (_, i) => sentence.replace('X', String(i))).join('').trim();
  const rig = makeRig({ profile: testProfile({ maxChars: 120, maxItems: 10 }) });
  const r = await run(rig, { items: [{ id: 'long', text: long }, { id: 'short', text: 'Tiny' }] });
  assert.equal(r.total, 2, 'one result for the long item, not one per piece');
  const pieces = rig.provider.calls.flatMap((c) => c.segs.map((s) => s.text)).filter((t) => t !== 'Tiny');
  assert.ok(pieces.length >= 4);
  for (const p of pieces) assert.ok(p.length <= 120, `piece within maxChars: ${p.length}`);
  const joined = textOf(r, 'long');
  assert.equal(joined.replace(/【译】/g, '').replace(/ /g, ''), long.replace(/ /g, ''));
  assert.equal((joined.match(/【译】/g) || []).length, pieces.length);
  assert.equal(textOf(r, 'short'), '【译】Tiny');
  // the joined result is cached under the whole text
  const again = await run(rig, { items: [{ id: 'long', text: long }] });
  assert.equal(textOf(again, 'long'), joined);
});

test('one failed piece fails the whole long item, others still succeed', async () => {
  const sentence = 'Sentence number X is here. ';
  const long = Array.from({ length: 8 }, (_, i) => sentence.replace('X', String(i))).join('').trim();
  const provider = fakeProvider(({ segs }) => {
    if (segs.some((s) => s.text.includes('number 5'))) throw err(ERR.CONFIG, 'refused');
    return writeSegs(segs);
  });
  const rig = makeRig({ provider, profile: testProfile({ maxChars: 60, maxItems: 1, concurrency: 1 }) });
  const r = await run(rig, { items: [{ id: 'long', text: long }, { id: 'ok', text: 'Fine' }] });
  assert.equal(r.results.get('long').error.code, ERR.CONFIG);
  assert.equal(textOf(r, 'ok'), '【译】Fine');
  assert.equal(r.total, 2);
});

test('aborting stops reporting and resolves quietly', async () => {
  const provider = fakeProvider(async ({ segs, signal }) => {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 200);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(err(ERR.CANCELLED));
      });
    });
    return writeSegs(segs);
  });
  const rig = makeRig({ provider });
  const ctrl = new AbortController();
  const seen = [];
  const p = rig.translator.translate({ reqId: 'x', to: 'zh-CN', items: items('a', 'b') }, { signal: ctrl.signal, onPartial: (r) => seen.push(r) });
  await sleep(10);
  ctrl.abort();
  await p;
  assert.deepEqual(seen, []);
  assert.equal(provider.calls.length, 1, 'no retry after cancel');
});

test('priority is passed to the queue: visible work overtakes prefetch', async () => {
  const order = [];
  const provider = fakeProvider(async ({ segs }) => {
    order.push(segs[0].text);
    await sleep(15);
    return writeSegs(segs);
  });
  const rig = makeRig({ provider, settings: testSettings({ profile: testProfile({ concurrency: 1, maxItems: 1 }), cache: { enabled: false } }) });
  const first = run(rig, { reqId: 'a', items: items('blocker'), priority: 1 });
  while (order.length < 1) await sleep(1); // the blocker now holds the only slot
  const late = run(rig, { reqId: 'b', items: items('prefetch'), priority: 2 });
  const urgent = run(rig, { reqId: 'c', items: items('visible'), priority: 0 });
  await Promise.all([first, late, urgent]);
  assert.deepEqual(order, ['blocker', 'visible', 'prefetch']);
});

test('translateText escapes the input and strips markup from the output', async () => {
  const provider = fakeProvider(({ segs }) => writeSegs(segs, (t) => `<g0>【译】${t}</g0> <b>x</b>`));
  const rig = makeRig({ provider });
  const out = await rig.translator.translateText({ text: 'a < b && c', to: 'zh-CN' });
  assert.equal(provider.calls[0].segs[0].text, 'a &lt; b &amp;&amp; c');
  assert.equal(out, '【译】a < b && c x');
});

test('translateText surfaces errors with their codes', async () => {
  const provider = fakeProvider(() => {
    throw err(ERR.CONFIG, 'no key');
  });
  const rig = makeRig({ provider });
  await assert.rejects(rig.translator.translateText({ text: 'hi', to: 'en' }), (e) => e.code === ERR.CONFIG && e.message === 'no key');
});

test('settings are read per request: switching the active profile takes effect immediately', async () => {
  let s = testSettings();
  const provider = fakeProvider();
  const rig = makeRig({ provider, settings: s });
  const mock = { id: 'mock', kind: 'mock', model: 'mock', fallbackModels: [], maxItems: 5, maxChars: 500, concurrency: 1, timeoutMs: 100 };
  rig.settings = null;
  const translator = (await import('../../extension/background/translator.js')).createTranslator({
    provider,
    cache: null,
    queue: rig.queue,
    getSettings: async () => s,
  });
  await translator.translate({ reqId: 1, items: items('x'), to: 'en' }, {});
  assert.equal(provider.calls[0].profile.id, 't');
  s = mergeSettings(s, { provider: { active: 'mock', profiles: [mock] } });
  await translator.translate({ reqId: 2, items: items('y'), to: 'en' }, {});
  assert.equal(provider.calls[1].profile.id, 'mock');
});

test('source language and prompt title invalidate translation cache',async()=>{
 const rig=makeRig();
 await run(rig,{items:items('Hello'),from:'en',context:{title:'First'}});
 await run(rig,{items:items('Hello'),from:'fr',context:{title:'First'}});
 await run(rig,{items:items('Hello'),from:'fr',context:{title:'Second'}});
 assert.equal(rig.provider.calls.length,3);
});

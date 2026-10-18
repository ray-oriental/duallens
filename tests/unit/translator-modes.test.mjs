// Double-engine translation (SPEC §8.1): machine-translation drafts, LLM refinement, and every fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache } from '../../extension/background/cache.js';
import { createQueue } from '../../extension/background/queue.js';
import { createTranslator, planFor } from '../../extension/background/translator.js';
import { createMT, MT_PLACEHOLDER } from '../../extension/background/mt.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../../extension/shared/settings.js';
import { ERR, FAST_QUEUE, err, fakeProvider, run, sleep, testProfile, testSettings, writeSegs } from './helpers.mjs';
import { refinementEligible } from '../../extension/shared/refinement.js';

test('automatic refinement counts six words or twelve CJK letters and excludes UI metadata',()=>{
  assert.equal(refinementEligible({text:'These five words stay machine translated'}),true);
  assert.equal(refinementEligible({text:'Just five words in here'}),false);
  assert.equal(refinementEligible({text:'<g0>These six words should receive language refinement</g0>',refine:false}),false);
  assert.equal(refinementEligible({text:'あ'.repeat(11)}),false);
  assert.equal(refinementEligible({text:'あ'.repeat(12)}),true);
});

test('page hybrid sends only eligible prose to LLM; UI and short units end at MT without drafts',async()=>{
  const r=rig();
  const list=[{id:'body',text:'A full paragraph deserves a careful language refinement.'},
    {id:'ui',text:'A long navigation label is still an interactive control.',refine:false},{id:'short',text:'Read more'},
    ...Array.from({length:20},(_,i)=>({id:'nav'+i,text:'This long navigation label must stay machine translated.',refine:false}))];
  const out=await log(r,{purpose:'page',draft:true,items:list});
  const llmTexts=r.provider.calls.flatMap(c=>c.segs.map(s=>s.text));
  assert.deepEqual(llmTexts,[list[0].text]);
  for(const id of list.filter(it=>it.id!=='body').map(it=>it.id)) {
    const events=out.filter(x=>x.id===id);
    assert.equal(events.length,1);assert.equal(events[0].stage,'final');assert.equal(events[0].engine,'mock');
  }
});

test('page refinement never publishes a streamed prefix from an unparseable thinking reply',async()=>{
  const models=[];
  const provider=async({model,onDelta})=>{
    models.push(model);
    if(model==='m1') {onDelta?.('{"t":["未验证的片段"]');return '好的，我正在思考如何翻译。';}
    return '{"t":["完整验证的备用译文"]}';
  };
  const r=rig({provider});const out=await log(r,{purpose:'page',draft:true,items:[{id:'prose',text:'This public paragraph contains enough words for refinement.'}]});
  assert.deepEqual(models,['m1','m2']);
  assert.ok(out.every(x=>x.text!=='未验证的片段'));
  assert.equal(out.at(-1).text,'完整验证的备用译文');
});

const offline = () => { throw new Error('the network must not be used'); };
const LLM = (t) => `【译】${t}`;
const MT = (t) => `${MT_PLACEHOLDER}${t}`;
const items = (...texts) => texts.map((text, i) => ({ id: `i${i + 1}`, text }));

// A mock-engine MT that records every request and can be slowed down or made to fail.
function spyMT({ delayMs = 0, fail = false } = {}) {
  const inner = createMT({ fetchImpl: offline });
  const calls = [];
  return {
    calls,
    test: inner.test,
    async translate(args) {
      calls.push(args.items.map(i => i.text));
      if (delayMs) await sleep(delayMs);
      if (fail) return args.onResults(args.items.map(it => ({ id: it.id, error: { code: ERR.NETWORK, message: 'mt down' } })));
      return inner.translate({ ...args, chain: ['mock'] });
    },
  };
}

function rig({ mode = 'mt+llm', llm = true, mt = spyMT(), provider, settings, autoDelayMs = 40, cache = createMemoryCache(), over = {} } = {}) {
  const prov = provider || fakeProvider(({ segs }) => writeSegs(segs, LLM));
  const s = settings || (llm
    ? testSettings({ translation: { mode, mt: { engine: 'mock' } }, ...over })
    : mergeSettings(DEFAULT_SETTINGS, { translation: { mode, mt: { engine: 'mock' } }, ...over }));
  const queue = createQueue({ ...FAST_QUEUE });
  const translator = createTranslator({ provider: prov, cache, queue, getSettings: async () => s, mt, autoDelayMs });
  return { translator, provider: prov, mt, cache, settings: s, queue };
}

// Every partial in arrival order: [{ id, stage, text|error }].
async function log(r, req) {
  const out = [];
  await r.translator.translate({ reqId: 'r', to: 'zh-CN', from: 'auto', priority: 0, context: {}, ...req }, { onPartial: (l) => out.push(...l.map(x => ({ ...x }))) });
  return out;
}
const stagesOf = (events, id) => events.filter(e => e.id === id).map(e => e.stage ?? (e.error ? 'error' : 'plain'));

test('planFor: which stages a request runs', () => {
  const s = (mode) => ({ translation: { mode } });
  assert.deepEqual(planFor(s('mt+llm'), {}, true), { mode: 'mt+llm', llmFallback: false });
  assert.deepEqual(planFor(s('mt+llm'), { purpose: 'page' }, true), { mode: 'mt+llm', llmFallback: false });
  assert.deepEqual(planFor(s('mt+llm'), {}, false), { mode: 'mt', llmFallback: false }, 'no LLM configured -> machine translation');
  assert.deepEqual(planFor(s('mt+llm'), { purpose: 'selection' }, true), { mode: 'mt', llmFallback: true });
  assert.deepEqual(planFor(s('auto'), { purpose: 'input' }, true), { mode: 'mt', llmFallback: true });
  assert.deepEqual(planFor(s('mt+llm'), { purpose: 'hover' }, true), { mode: 'mt', llmFallback: true });
  assert.deepEqual(planFor(s('mt'), {}, true), { mode: 'mt', llmFallback: false }, 'an explicit mt never wakes the LLM');
  assert.deepEqual(planFor(s('llm'), { purpose: 'selection' }, true), { mode: 'llm', llmFallback: false });
  assert.deepEqual(planFor(s('llm'), {}, false), { mode: 'llm', llmFallback: false }, 'llm-only without an LLM keeps its config error');
  assert.deepEqual(planFor(s('mt+llm'), { purpose: 'selection', mode: 'llm' }, true), { mode: 'llm', llmFallback: false }, 'the request wins');
  assert.deepEqual(planFor(s('mt'), { mode: 'bogus' }, true), { mode: 'mt', llmFallback: false });
  assert.deepEqual(planFor({}, {}, true), { mode: 'mt+llm', llmFallback: false }, 'missing settings default');
});

test('mode llm is the unchanged LLM pipeline: no stage, no machine translation', async () => {
  const r = rig({ mode: 'llm' });
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.deepEqual(events, [{ id: 'i1', text: LLM('Hello') }]);
  assert.equal(r.mt.calls.length, 0);
});

test('a fresh install (no LLM at all) translates with machine translation right away', async () => {
  const r = rig({ llm: false });
  const events = await log(r, { items: items('Hello', 'World'), draft: true });
  assert.deepEqual(events.map(e => [e.id, e.stage, e.text]).sort(), [['i1', 'final', MT('Hello')], ['i2', 'final', MT('World')]]);
  assert.equal(r.provider.calls.length, 0);
  assert.ok(events.every(e => e.engine === 'mock'));
});

test('mode mt: finals only, blanks passed through, duplicate texts translated once, cached per engine', async () => {
  const r = rig({ mode: 'mt' });
  const events = await log(r, { items: items('Same', 'Same', '   ', 'Other') });
  assert.equal(events.length, 4);
  assert.deepEqual(events.find(e => e.id === 'i3'), { id: 'i3', text: '   ', stage: 'final' });
  assert.equal(events.find(e => e.id === 'i2').text, MT('Same'));
  assert.deepEqual(r.mt.calls.flat().sort(), ['Other', 'Same']);
  assert.equal(r.provider.calls.length, 0, 'the LLM is never consulted');
  const again = await log(r, { items: items('Same') });
  assert.equal(again[0].text, MT('Same'));
  assert.equal(r.mt.calls.length, 1, 'second run is answered by the machine-translation cache');
});

test('mode mt: every engine failing is an error per item, without waking a configured LLM', async () => {
  const r = rig({ mode: 'mt', mt: spyMT({ fail: true }) });
  const events = await log(r, { items: items('Hello') });
  assert.equal(events[0].error.code, ERR.NETWORK);
  assert.equal(r.provider.calls.length, 0);
});

test('mt+llm with drafts: the machine draft comes first, the LLM text replaces it', async () => {
  const provider = fakeProvider(async ({ segs }) => { await sleep(60); return writeSegs(segs, LLM); });
  const r = rig({ provider });
  const events = await log(r, { items: items('Hello', 'World <g0>link</g0>'), draft: true });
  assert.deepEqual(stagesOf(events, 'i1'), ['draft', 'final']);
  assert.deepEqual(stagesOf(events, 'i2'), ['draft', 'final']);
  assert.equal(events.find(e => e.id === 'i1' && e.stage === 'draft').text, MT('Hello'));
  assert.equal(events.find(e => e.id === 'i2' && e.stage === 'draft').text, MT('World <g0>link</g0>'), 'placeholders survive the draft');
  assert.equal(events.find(e => e.id === 'i1' && e.stage === 'final').text, LLM('Hello'));
  assert.ok(events.findIndex(e => e.stage === 'draft') < events.findIndex(e => e.stage === 'final'));
});

test('mt+llm without draft support: the LLM answers once and machine translation is never asked', async () => {
  const r = rig();
  const events = await log(r, { items: items('Hello') });
  assert.deepEqual(events, [{ id: 'i1', text: LLM('Hello'), stage: 'final' }]);
  assert.equal(r.mt.calls.length, 0, 'page text is not sent to a machine-translation service unless a draft is wanted or needed');
});

test('LLM failure after a draft keeps the draft quietly: a final marked refined:false, no error', async () => {
  const provider = fakeProvider(async () => { await sleep(40); throw err(ERR.PROVIDER, 'model down', { status: 400 }); });
  const r = rig({ provider });
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.deepEqual(stagesOf(events, 'i1'), ['draft', 'final']);
  const final = events.find(e => e.stage === 'final');
  assert.deepEqual([final.text, final.refined, final.error], [MT('Hello'), false, undefined]);
});

test('LLM failure without drafts falls back to machine translation instead of an error', async () => {
  const provider = fakeProvider(() => { throw err(ERR.PROVIDER, 'model down', { status: 400 }); });
  const r = rig({ provider });
  const events = await log(r, { items: items('Hello', 'World') });
  assert.equal(events.length, 2);
  for (const e of events) assert.deepEqual([e.stage, e.refined, e.engine, e.text.startsWith(MT_PLACEHOLDER)], ['final', false, 'mock', true]);
});

test('both stages failing reports the LLM error once', async () => {
  const provider = fakeProvider(() => { throw err(ERR.PROVIDER, 'model down', { status: 400 }); });
  const r = rig({ provider, mt: spyMT({ fail: true }) });
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.equal(events.length, 1);
  assert.equal(events[0].error.code, ERR.PROVIDER);
});

test('an LLM cache hit is final at once and its text is never sent to machine translation', async () => {
  const cache = createMemoryCache();
  const warm = rig({ mode: 'llm', cache });
  await log(warm, { items: items('Cached') });
  const r = rig({ cache, provider: fakeProvider(async ({ segs }) => { await sleep(20); return writeSegs(segs, LLM); }) });
  const events = await log(r, { items: items('Cached', 'Fresh'), draft: true });
  assert.deepEqual(stagesOf(events, 'i1'), ['final']);
  assert.deepEqual(stagesOf(events, 'i2'), ['draft', 'final']);
  assert.deepEqual(r.mt.calls.flat(), ['Fresh']);
});

test('a draft that arrives after the LLM final is dropped', async () => {
  const r = rig({ mt: spyMT({ delayMs: 120 }) });
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.deepEqual(stagesOf(events, 'i1'), ['final']);
  assert.equal(events[0].text, LLM('Hello'));
});

test('purposes selection/hover/input use machine translation and hand over to the LLM only if it fails', async () => {
  const r = rig();
  const events = await log(r, { items: items('Hello'), purpose: 'selection' });
  assert.deepEqual(events.map(e => [e.stage, e.text, e.engine]), [['final', MT('Hello'), 'mock']]);
  assert.equal(r.provider.calls.length, 0);
  const down = rig({ mt: spyMT({ fail: true }) });
  const rescued = await log(down, { items: items('Hello'), purpose: 'input' });
  assert.deepEqual(rescued.map(e => [e.stage, e.text]), [['final', LLM('Hello')]]);
  const refine = rig();
  const explicit = await log(refine, { items: items('Hello'), purpose: 'selection', mode: 'llm' });
  assert.deepEqual(explicit, [{ id: 'i1', text: LLM('Hello') }]);
});

test('translateTextEx reports which stage answered', async () => {
  const r = rig();
  const quick = await r.translator.translateTextEx({ text: 'a < b', to: 'zh-CN', purpose: 'selection' });
  assert.deepEqual(quick, { text: MT('a < b'), by: 'mt', engine: 'mock' });
  const refined = await r.translator.translateTextEx({ text: 'a < b', to: 'zh-CN', purpose: 'selection', mode: 'llm' });
  assert.deepEqual(refined, { text: LLM('a < b'), by: 'llm', engine: undefined });
  assert.equal(await r.translator.translateText({ text: 'x', to: 'zh-CN', purpose: 'selection' }), MT('x'));
});

test('auto mode: LLM first; the draft only appears when the LLM is slow', async () => {
  const fast = rig({ mode: 'auto', provider: fakeProvider(({ segs }) => writeSegs(segs, LLM)), autoDelayMs: 80 });
  const quick = await log(fast, { items: items('Hello'), draft: true });
  assert.deepEqual(quick.map(e => e.stage), ['final']);
  assert.equal(fast.mt.calls.length, 0, 'no machine translation at all when the LLM is quick');
  const slow = rig({ mode: 'auto', provider: fakeProvider(async ({ segs }) => { await sleep(200); return writeSegs(segs, LLM); }), autoDelayMs: 40 });
  const late = await log(slow, { items: items('Hello'), draft: true });
  assert.deepEqual(late.map(e => e.stage), ['draft', 'final']);
});

test('aborting stops every report and resolves quietly', async () => {
  const ctrl = new AbortController();
  const provider = fakeProvider(async ({ segs }) => { await sleep(100); return writeSegs(segs, LLM); });
  const r = rig({ provider });
  const seen = [];
  const done = r.translator.translate({ reqId: 'r', to: 'zh-CN', priority: 0, draft: true, items: items('Hello') },
    { signal: ctrl.signal, onPartial: (l) => seen.push(...l) });
  setTimeout(() => ctrl.abort(), 60);
  await done;
  await sleep(150);
  assert.deepEqual(seen.map(e => e.stage), ['draft'], 'the draft arrived before the abort; the LLM final never does');
});

test('machine-translation cache keys include the engine and language pair', async () => {
  const cache = createMemoryCache();
  const first = rig({ mode: 'mt', cache });
  await log(first, { items: items('Hello') });
  const otherTarget = await log(first, { items: items('Hello'), to: 'ja' });
  assert.equal(otherTarget[0].text, MT('Hello'));
  assert.equal(first.mt.calls.length, 2, 'ja is a different cache row');
  assert.equal(await cache.count(), 2);
  const second = rig({ mode: 'mt', cache, settings: testSettings({ translation: { mode: 'mt', mt: { engine: 'microsoft', fallback: false } } }),
    mt: { calls: [], test() {}, async translate({ items: its, onResults, chain }) { this.calls.push(chain); onResults(its.map(i => ({ id: i.id, text: 'MS ' + i.text, engine: 'microsoft' }))); } } });
  const other = await log(second, { items: items('Hello') });
  assert.equal(other[0].text, 'MS Hello', 'a cached mock result is not served for the microsoft engine');
});

test('streamed LLM items still replace drafts one by one', async () => {
  const provider = async ({ messages, onDelta }) => {
    const user = messages.find(m => m.role === 'user').content;
    const list = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1)).t;
    const content = JSON.stringify({ t: list.map(LLM) });
    await sleep(30);
    onDelta?.(content);
    return content;
  };
  const r = rig({ provider });
  const events = await log(r, { items: items('One', 'Two'), draft: true });
  for (const id of ['i1', 'i2']) assert.deepEqual(stagesOf(events, id), ['draft', 'final']);
});

test('refine budget: a slow LLM is cancelled and the draft becomes the result', async () => {
  let aborted = false;
  const provider = fakeProvider(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(err(ERR.CANCELLED, 'cancelled')); });
  }));
  const r = rig({ provider, over: { translation: { mode: 'mt+llm', refineTimeoutMs: 80, mt: { engine: 'mock' } } } });
  const started = Date.now();
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.deepEqual(stagesOf(events, 'i1'), ['draft', 'final']);
  assert.deepEqual([events[1].text, events[1].refined], [MT('Hello'), false]);
  assert.ok(Date.now() - started < 1500);
  assert.equal(aborted, true, 'the stalled LLM request was cancelled, not left running');
});

test('refine budget without drafts: machine translation answers what the LLM did not', async () => {
  const provider = fakeProvider(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(err(ERR.CANCELLED, 'cancelled')));
  }));
  const r = rig({ provider, over: { translation: { mode: 'mt+llm', refineTimeoutMs: 80, mt: { engine: 'mock' } } } });
  const events = await log(r, { items: items('Hello') });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].stage, events[0].text, events[0].refined], ['final', MT('Hello'), false]);
  assert.equal(r.mt.calls.length, 1, 'machine translation was only asked once the budget ran out');
});

test('refine budget with no machine translation either: one timeout error', async () => {
  const provider = fakeProvider(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(err(ERR.CANCELLED, 'cancelled')));
  }));
  const r = rig({ provider, mt: spyMT({ fail: true }), over: { translation: { mode: 'mt+llm', refineTimeoutMs: 60, mt: { engine: 'mock' } } } });
  const events = await log(r, { items: items('Hello'), draft: true });
  assert.equal(events.length, 1);
  assert.equal(events[0].error.code, ERR.NETWORK);
});

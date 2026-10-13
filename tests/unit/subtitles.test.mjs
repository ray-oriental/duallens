import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseJSON3, resegmentASR, ASR_CONFIG, cueIndexAt } from '../../extension/content/subtitles/json3.js';
import { originalTrackURL, subtitleOptions } from '../../extension/content/subtitles/track.js';
import { installTimedtextObserver } from '../../extension/content/subtitles/observer-runtime.js';
import { groupPriority, SubtitleScheduler } from '../../extension/content/subtitles/scheduler.js';
import { makeRig, testSettings, testProfile, ERR, err } from './helpers.mjs';
import { createHandlers } from '../../extension/background/handlers.js';
import { registerSidePanelCommand } from '../../extension/background/media.js';
import { createSubtitleHandlers } from '../../extension/background/subtitles.js';
import { fetchGMCrossHostTrack } from '../../extension/content/subtitles/observe.js';

const base = 'https://www.youtube.com/watch?v=fixture';
const raw = base.replace('/watch', '/api/timedtext') + '&lang=en&tlang=zh-CN&fmt=srv3';
test('timedtext hints are constrained to two exact YouTube origins/path and current video; tlang removed', () => {
  const url = new URL(originalTrackURL(raw, base));
  assert.equal(url.searchParams.get('fmt'), 'json3'); assert.equal(url.searchParams.has('tlang'), false);
  for (const value of ['https://evil.test/api/timedtext?v=fixture', 'https://www.youtube.com.evil.test/api/timedtext?v=fixture',
    'https://www.youtube.com:8443/api/timedtext?v=fixture', 'http://www.youtube.com/api/timedtext?v=fixture',
    'https://x@y.youtube.com/api/timedtext', raw.replace('fixture', 'other'), base, 'x'.repeat(9000)]) assert.equal(originalTrackURL(value, base), null);
  assert.ok(originalTrackURL(raw.replaceAll('www.', 'm.'), base.replace('www.', 'm.')));
  assert.equal(new URL(originalTrackURL(raw, base.replace('www.', 'm.'))).hostname, 'www.youtube.com');
  assert.equal(originalTrackURL(raw, 'https://example.test/'), null);
  assert.equal(originalTrackURL(raw, 'https://www.youtube.com/shorts/other'), null);
  assert.deepEqual(subtitleOptions({ subtitles: { enabled: 'true', fontSize: 900, position: 'evil', mode: 'evil' } }),
    { enabled: false, fontSize: 48, position: 'bottom', mode: 'bilingual' });
});

test('json3 joins fragments, skips metadata and environmental sound, retains timing and plain text', () => {
  const cues = parseJSON3({ events: [
    { tStartMs: 500, dDurationMs: 1000, segs: [{ utf8: 'Hello ' }, { utf8: '<world>.' }] },
    { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '[Music] ♪' }] },
    { tStartMs: 1500, segs: [{ utf8: 'Speech (applause) continues.' }] }, { tStartMs: 1900, wpWinPosId: 1 },
    { tStartMs: -1, segs: [{ utf8: 'invalid' }] },
  ] });
  assert.deepEqual(cues.map(c => [c.start, c.end, c.text]), [[500, 1500, 'Hello <world>.'], [1500, 3500, 'Speech continues.']]);
  assert.throws(() => parseJSON3({ events: new Array(30001) })); assert.throws(() => parseJSON3({}));
  assert.equal(cueIndexAt(cues, 1700), 1); assert.equal(cueIndexAt(cues, 0), 0);
});

test('ASR split limits 1000ms/17 words; merge limits 1500ms/19 words; punctuation terminates', () => {
  assert.deepEqual(ASR_CONFIG, { splitGapMs: 1000, mergeGapMs: 1500, splitWords: 17, mergeWords: 19 });
  const tokens = Array.from({ length: 40 }, (_, i) => ({ start: i * 100, end: i * 100 + 80, text: 'word' }));
  assert.deepEqual(resegmentASR(tokens).map(c => c.text.split(' ').length), [17, 17, 6]);
  const pair = [{ start: 0, end: 100, text: 'first' }, { start: 1100, end: 1200, text: 'second' }];
  assert.equal(resegmentASR(pair, { ...ASR_CONFIG, mergeGapMs: 1000 }).length, 2);
  assert.equal(resegmentASR(pair).length, 1);
  assert.equal(resegmentASR([{ ...pair[0], text: 'first.' }, pair[1]]).length, 2);
  assert.equal(resegmentASR([pair[0], { ...pair[1], start: 1600, end: 1700 }]).length, 2);
  assert.equal(resegmentASR(tokens.slice(0, 19)).length, 1);
  assert.equal(resegmentASR(tokens.slice(0, 20)).length, 2);
});

test('json3 ASR uses segment offsets, splits dense events, deduplicates rolling replay', () => {
  const event = { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello ', tOffsetMs: 0 }, { utf8: 'world.', tOffsetMs: 500 }] };
  const cues = parseJSON3({ events: [event, structuredClone(event),
    { tStartMs: 3000, dDurationMs: 2200, segs: [{ utf8: Array(22).fill('next').join(' ') }] }] }, { asr: true });
  assert.equal(cues[0].text, 'hello world.'); assert.equal(cues[0].end, 1000);
  assert.deepEqual(cues.slice(1).map(c => c.text.split(' ').length), [17, 5]);
});

const cues = () => Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, start: i * 1000, end: i * 1000 + 1000, text: 'source <text> ' + i, translation: null }));
test('groups have five cues, prioritize current position then forward/near; empty and final groups work', () => {
  const groups = groupPriority(cues(), 17300);
  assert.deepEqual(groups.map(g => g.index), [3, 4, 2, 5, 1, 0]);
  assert.equal(groups[0].priority, 0); assert.equal(groups[3].priority, 2);
  assert.ok(groups.every(g => g.cues.length === 5)); assert.deepEqual(groupPriority([], 0), []);
  assert.deepEqual(groupPriority(cues().slice(0, 7), 99000).map(g => g.cues.length), [2, 5]);
});

test('seek cancels in-flight batch, ignores late replies, retains translated cues and cancels restore', async () => {
  const requests = [];
  const service = { translateBatch(req, cb) { let resolve; const handle = { done: new Promise(r => { resolve = r; }), cancelled: false,
    cancel() { this.cancelled = true; resolve(); } }; requests.push({ req, cb, handle, resolve }); return handle; } };
  const source = cues(), scheduler = new SubtitleScheduler({ service, cues: source, request: { to: 'zh-CN' } });
  scheduler.seek(17300); assert.equal(requests[0].req.items[0].id, 's15');
  assert.ok(requests[0].req.items[0].text.includes('&lt;'));
  scheduler.seek(1200); assert.equal(requests[0].handle.cancelled, true); assert.equal(requests[1].req.items[0].id, 's0');
  requests[0].cb([{ id: 's15', text: 'stale' }]); assert.equal(source[15].translation, null);
  requests[1].cb([{ id: 's0', text: 'safe &lt;text&gt;' }]); assert.equal(source[0].translation, 'safe <text>');
  requests[1].resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(requests[2].req.items[0].id, 's5'); scheduler.stop(); assert.equal(requests[2].handle.cancelled, true);
  requests[2].cb([{ id: 's5', text: 'late' }]); assert.equal(source[5].translation, null);
});

test('failed cues do not endlessly retry the same group', async () => {
  const seen = [];
  const scheduler = new SubtitleScheduler({ service: { translateBatch(req, cb) { seen.push(req); cb(req.items.map(i => ({ id: i.id, error: { code: 'test' } }))); return { done: Promise.resolve(), cancel() {} }; } },
    cues: cues().slice(0, 6), request: {} });
  scheduler.seek(0); await new Promise(r => setTimeout(r, 0));
  assert.equal(seen.length, 2); assert.equal(scheduler.failed.size, 6); scheduler.stop();
});

test('subtitle scheduler supports the public cancel-only batch handle without requiring done', async () => {
  const calls = [], source = cues().slice(0, 6);
  const scheduler = new SubtitleScheduler({ service: { translateBatch(req, callback) {
    calls.push(req); callback(req.items.map(item => ({ id: item.id, text: '译文' }))); return { cancel() {} };
  } }, cues: source, request: {} });
  scheduler.seek(0); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 2); assert.ok(source.every(cue => cue.translation === '译文')); scheduler.stop();
});

test('MAIN observer passes fetch/XHR through, notifies only YouTube timedtext; identical userscript implementation', async () => {
  const source = await fs.readFile('extension/content/subtitles/observer.js', 'utf8');
  assert.equal(source.slice(source.indexOf('\n(') + 2).trim(), installTimedtextObserver.toString() + ')();');
  const listeners = {}, messages = [], calls = [], xhrCalls = [];
  const sentinel = { promise: true }; const loc = { hostname: 'www.youtube.com', origin: 'https://www.youtube.com', href: base };
  const XHR = function() {}; XHR.prototype.open = function(...args) { xhrCalls.push(args); return 42; };
  const win = { fetch(input, options) { calls.push([this, input, options]); return sentinel; }, postMessage: (...args) => messages.push(args), addEventListener: (name, cb) => { listeners[name] = cb; } };
  const context = { location: loc, window: win, XMLHttpRequest: XHR, URL, Symbol, Reflect };
  vm.runInNewContext(source, context);
  assert.equal(win.fetch(raw, { method: 'GET' }), sentinel); assert.equal(messages.length, 1); assert.equal(calls[0][0], win);
  const xhr = new XHR(); assert.equal(xhr.open('GET', raw, true), 42); assert.equal(xhrCalls[0][1], raw);
  win.fetch('https://evil.test/api/timedtext'); assert.equal(messages.length, 2);
  listeners.message({ source: win, origin: loc.origin, data: { channel: 'duallens-timedtext-ready' } }); assert.equal(messages.length, 3);
  const other = { ...context, window: { ...win }, location: { hostname: 'example.test' } }; const original = other.window.fetch;
  vm.runInNewContext(source, other); assert.equal(other.window.fetch, original);
});

test('text service selection is scoped to the request, retains fallback and selected cache identity', async () => {
  const settings = testSettings({ profile: testProfile({ id: 'a' }) });
  settings.provider.profiles.push(testProfile({ id: 'b', model: 'b-model' }));
  const calls = [];
  const rig = makeRig({ settings, provider: async ({ profile, model, messages }) => {
    calls.push([profile.id, model]); if (model === 'fails') throw err(ERR.NETWORK);
    const user = messages.at(-1).content; const texts = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1)).t;
    return JSON.stringify({ t: texts.map(t => '译:' + t) });
  } });
  const snapshot = structuredClone(settings);
  assert.equal(await rig.translator.translateText({ text: 'hello', to: 'zh-CN', profileId: 'b', model: 'chosen' }), '译:hello');
  await rig.translator.translateText({ text: 'hello', to: 'zh-CN', profileId: 'b', model: 'chosen' }); assert.equal(calls.length, 1);
  await rig.translator.translateText({ text: 'new', to: 'zh-CN', profileId: 'b', model: 'fails' }); assert.deepEqual(calls.slice(1), [['b', 'fails'], ['a', 'm1']]);
  assert.deepEqual(settings, snapshot);
  const handlers = createHandlers({ translator: rig.translator, getSettings: async () => settings });
  assert.equal((await handlers['translate-text']({ text: 'hello', profileId: 'unknown', model: 'x' })).ok, false);
  assert.equal((await handlers['translate-text']({ text: 'hello', model: 'x' })).ok, false);
});

test('Alt+S command listener opens the real sidePanel API synchronously with the command tab', async () => {
  let listener; const calls = [];
  const api = { commands: { onCommand: { addListener(cb) { listener = cb; }, removeListener(cb) { assert.equal(listener, cb); } } },
    sidePanel: { open(value) { calls.push(value); return Promise.resolve(); } },
    windows: { getCurrent: async () => ({ id: 17 }) } };
  const off = registerSidePanelCommand(api);
  listener('toggle-page', { id: 8 }); assert.equal(calls.length, 0);
  listener('open-sidepanel', { id: 8 }); assert.deepEqual(calls, [{ tabId: 8 }]);
  listener('open-sidepanel'); await Promise.resolve(); assert.deepEqual(calls[1], { windowId: 17 }); off();
});

test('cross-host worker transport gates sender/video/URL, omits cookies, bounds body and supports cancellation', async () => {
  const calls = [], sender = { tab: { id: 7 }, frameId: 0, documentId: 'document', url: base.replace('www.', 'm.') };
  const handlers = createSubtitleHandlers({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 2) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    return new Response(JSON.stringify({ events: [] }), { status: 200 });
  } });
  assert.deepEqual(await handlers['subtitle-track']({ id: 'r1', url: raw }, sender), { ok: true, data: { events: [] } });
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(new URL(calls[0].url).searchParams.has('tlang'), false);
  for (const bad of [{ ...sender, frameId: 1 }, { ...sender, url: 'https://evil.test/' }, { ...sender, tab: undefined }]) {
    assert.equal((await handlers['subtitle-track']({ id: 'x', url: raw }, bad)).ok, false);
  }
  assert.equal((await handlers['subtitle-track']({ id: 'x', url: raw.replace('fixture', 'other') }, sender)).ok, false);
  assert.equal((await handlers['subtitle-track']({ id: 'x', url: 'https://127.0.0.1/api/timedtext' }, sender)).ok, false);
  assert.equal(calls.length, 1);
  const pending = handlers['subtitle-track']({ id: 'r2', url: raw }, sender);
  await handlers['subtitle-track-cancel']({ id: 'r2' }, { ...sender, documentId: 'wrong-document' });
  assert.equal(calls[1].options.signal.aborted, false);
  await handlers['subtitle-track-cancel']({ id: 'r2' }, sender);
  assert.equal((await pending).ok, false);
  const huge = createSubtitleHandlers({ fetchImpl: async () => new Response('too large', { headers: { 'content-length': String(5 * 1024 * 1024) } }) });
  assert.equal((await huge['subtitle-track']({ id: 'huge', url: raw }, sender)).ok, false);
  const spa = createSubtitleHandlers({ fetchImpl: async () => new Response('{"events":[]}') });
  assert.equal((await spa['subtitle-track']({ id: 'spa', url: raw.replace('fixture', 'second') },
    { ...sender, tab: { id: 7, url: base.replace('fixture', 'second') } })).ok, true);
  assert.equal((await spa['subtitle-track']({ id: 'stale', url: raw },
    { ...sender, tab: { id: 7, url: base.replace('fixture', 'second') } })).ok, false);
});

test('cross-host userscript track uses injected anonymous GM HTTP, validates URL and JSON byte budget', async () => {
  const requests = [], http = async req => { requests.push(req); return { status: 200, text: '{"events":[]}' }; };
  assert.deepEqual(await fetchGMCrossHostTrack(raw, {}, http, base.replace('www.', 'm.')), { events: [] });
  assert.equal(requests[0].method, 'GET'); assert.deepEqual(requests[0].headers, {});
  assert.equal(requests[0].timeoutMs, 20000);
  await assert.rejects(fetchGMCrossHostTrack('https://evil.test/api/timedtext', {}, http, base));
  await assert.rejects(fetchGMCrossHostTrack(raw, {}, async () => ({ status: 200, text: 'a'.repeat(4194305) }), base));
  assert.equal(requests.length, 1);
});

// Shared test fixtures. Not a test file (name does not match *.test.mjs).

import { DEFAULT_SETTINGS, mergeSettings } from '../../extension/shared/settings.js';
import { createMemoryCache } from '../../extension/background/cache.js';
import { createQueue } from '../../extension/background/queue.js';
import { createTranslator } from '../../extension/background/translator.js';
import { DLError } from '../../extension/shared/errors.js';
import { ERR } from '../../extension/shared/protocol.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function err(code, message = code, extra = {}) {
  return new DLError(code, message, extra);
}

export const FAST_QUEUE = {
  cooldownMs: 25,
  baseBackoffMs: 10,
  maxBackoffMs: 200,
  errorBackoffMs: 1,
  maxErrorBackoffMs: 4,
  primaryRetryMs: 10000,
};

export function testProfile(over = {}) {
  return {
    id: 't',
    kind: 'openai',
    name: 'test',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'm1',
    fallbackModels: ['m2'],
    maxItems: 3,
    maxChars: 200,
    concurrency: 2,
    timeoutMs: 1000,
    ...over,
  };
}

export function testSettings({ profile = testProfile(), ...over } = {}) {
  // Legacy LLM-pipeline tests pin mode 'llm'; the double-engine tests choose their own mode.
  return mergeSettings(DEFAULT_SETTINGS, { translation: { mode: 'llm' }, provider: { active: profile.id, profiles: [profile] }, ...over });
}

// Parses the numbered segments out of the user message the way a model would see them.
export function readSegs(messages) {
  const user = messages.find((m) => m.role === 'user').content;
  if(user.includes('<input>')) return JSON.parse(user.slice(user.indexOf('{'),user.lastIndexOf('}')+1)).t.map((text,i)=>({no:i+1,text}));
  return [...user.matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)].map((m) => ({ no: Number(m[1]), text: m[2] }));
}

export function writeSegs(segs, fn = (t) => `【译】${t}`) {
  return segs.map((s) => `<seg id="${s.no}">${fn(s.text, s.no)}</seg>`).join('\n');
}

// A fake provider. `behavior({ call, model, segs, messages, signal })` returns content or throws.
export function fakeProvider(behavior = ({ segs }) => writeSegs(segs)) {
  const calls = [];
  const provider = async ({ profile, model, messages, signal }) => {
    const segs = readSegs(messages);
    const call = { n: calls.length + 1, model, segs, messages, profile };
    calls.push(call);
    return behavior({ ...call, signal });
  };
  provider.calls = calls;
  return provider;
}

export function makeRig({ provider = fakeProvider(), profile, settings, cache, queueOptions } = {}) {
  const s = settings || testSettings({ profile: profile || testProfile() });
  const cacheObj = cache === undefined ? createMemoryCache() : cache;
  const queue = createQueue({ ...FAST_QUEUE, ...queueOptions });
  const translator = createTranslator({ provider, cache: cacheObj, queue, getSettings: async () => s });
  return { provider, cache: cacheObj, queue, translator, settings: s };
}

// Runs translate() and collects every partial; resolves with { results: Map(id -> result), batches }.
export async function run(rig, req, opts = {}) {
  const batches = [];
  await rig.translator.translate(
    { reqId: 'r1', to: 'zh-CN', from: 'auto', priority: 0, context: { title: 'Page' }, ...req },
    { onPartial: (r) => batches.push(r), ...opts },
  );
  const results = new Map();
  for (const b of batches) for (const r of b) results.set(r.id, r);
  return { results, batches, total: batches.reduce((n, b) => n + b.length, 0) };
}

export { ERR };

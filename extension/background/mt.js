import { readResponseText, redirectError } from '../platform/http.js';
import { t as l10n } from '../shared/i18n.js';
// Machine translation (MT): the fast first stage of the double-engine pipeline (SPEC §8.1).
//
// Engines
//   microsoft      free, UNOFFICIAL: the endpoint Edge's own page translation uses
//                  (edge.microsoft.com/translate/translatetext). No account, no key, reachable from
//                  mainland China. If it ever demands a token we fall back to the short-lived token
//                  flow (edge.microsoft.com/translate/auth + api-edge.cognitive.microsofttranslator.com).
//   google         free, UNOFFICIAL: a batch form endpoint
//                  (clients5.google.com/translate_a/t?client=gtx). Needs a route to Google.
//   microsoft-api  official Azure Translator (user key + optional region).
//   deepl          official DeepL API (user key; free keys end in ":fx").
//   mock           offline deterministic prefix for tests and demos.
// The two free endpoints are not documented or guaranteed by their owners and can change or
// disappear at any time; callers treat every MT failure as "no draft", never as a page error.
//
// Placeholders (SPEC §6): items arrive in the serialized-markup form the LLM sees, with <gN>..</gN>,
// <xN/> and &amp; &lt; &gt;. Items that carry markers go to the engine as HTML so it keeps and
// reorders the tags; the result is only trusted if every marker survived exactly once, otherwise the
// draft degrades to marker-free plain text (`plain: true`) and the LLM stage restores the formatting.
// Marker-free items go as plain text.
//
// Keys come from the injected getSecret(id) at request time and never appear in errors or logs.

import { ERR } from '../shared/protocol.js';
import { DLError, cancelledError, isCancelled, toErrorInfo, parseRetryAfter, classify } from '../shared/errors.js';
import { escapeText, unescapeText, stripMarkup, parseMarkup } from '../shared/markup.js';
import { splitLongText, joinTranslations } from '../shared/batch.js';

export const MT_ENGINES = Object.freeze([
  Object.freeze({ id: 'microsoft', get name() { return l10n('mk'); }, free: true, keyed: false }),
  Object.freeze({ id: 'google', get name() { return l10n('ml'); }, free: true, keyed: false }),
  Object.freeze({ id: 'microsoft-api', get name() { return l10n('mm'); }, free: false, keyed: true, secretId: 'mt-microsoft-api' }),
  Object.freeze({ id: 'deepl', get name() { return l10n('mn'); }, free: false, keyed: true, secretId: 'mt-deepl' }),
  Object.freeze({ id: 'mock', get name() { return l10n('mo'); }, free: false, keyed: false }),
]);
export const MT_SECRET_IDS = Object.freeze(MT_ENGINES.filter(e => e.keyed).map(e => e.secretId));
export const MT_PLACEHOLDER = '【机翻】';

export const MT_LIMITS = Object.freeze({
  firstItems: 10, firstChars: 3000, // first request is small so the viewport fills quickly
  maxItems: 30, maxChars: 8000, concurrency: 3, timeoutMs: 8000,
});

const FREE_ORDER = ['microsoft', 'google'];
const MS_FREE_URL = 'https://edge.microsoft.com/translate/translatetext';
const MS_AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const MS_TOKEN_API = 'https://api-edge.cognitive.microsofttranslator.com/translate';
const MS_OFFICIAL_API = 'https://api.cognitive.microsofttranslator.com/translate';
const GOOGLE_URL = 'https://clients5.google.com/translate_a/t';

// ---- pure helpers ---------------------------------------------------------------------------

export function isMtEngine(id) {
  return MT_ENGINES.some(e => e.id === id);
}

// Ordered engines to try for a settings.translation.mt block. A keyed engine without a key fails
// with a config error at run time and the next engine takes over.
export function mtChain(mt = {}) {
  const primary = isMtEngine(mt.engine) ? mt.engine : 'microsoft';
  if (!FREE_ORDER.includes(primary)) return [primary];
  const chain = [primary];
  if (mt.fallback !== false) for (const id of FREE_ORDER) if (!chain.includes(id)) chain.push(id);
  return chain;
}

const MS_CODES = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };
export const msLang = (code) => (!code || code === 'auto' ? '' : MS_CODES[code] || code);
export const googleLang = (code) => (!code || code === 'auto' ? 'auto' : code);
export function deeplTarget(code) {
  if (code === 'zh-CN') return 'ZH-HANS';
  if (code === 'zh-TW') return 'ZH-HANT';
  if (code === 'en') return 'EN-US';
  if (code === 'pt') return 'PT-BR';
  return String(code).toUpperCase();
}
export const deeplSource = (code) => (!code || code === 'auto' ? '' : String(code).split('-')[0].toUpperCase());

const MARKER = /<\/?g\d+>|<x\d+\s*\/>/;
export const hasMarkers = (text) => MARKER.test(String(text));

// Engines sometimes turn <x1/> into <x1></x1>.
function normalizeMarkers(text) {
  return String(text).replace(/<x(\d+)\s*>\s*<\/x\1\s*>/g, '<x$1/>').replace(/<x(\d+)\s*\/\s*>/g, '<x$1/>');
}

function markerSignature(text) {
  const grab = (re) => [...String(text).matchAll(re)].map(m => Number(m[1])).sort((a, b) => a - b).join(',');
  return [grab(/<g(\d+)>/g), grab(/<\/g(\d+)>/g), grab(/<x(\d+)\/>/g)].join('|');
}

// True when `out` carries exactly the markers of `src`, well nested.
export function sameMarkers(src, out) {
  return markerSignature(src) === markerSignature(out) && parseMarkup(out).ok;
}

// Raw engine output -> { text, plain? } in the serialized-markup form.
export function finishItem(src, out, html) {
  if (!html) return { text: escapeText(out) };
  const norm = normalizeMarkers(out);
  if (sameMarkers(src, norm)) return { text: norm };
  return { text: escapeText(stripMarkup(norm)), plain: true };
}

export function chunkItems(items, { firstItems = MT_LIMITS.firstItems, firstChars = MT_LIMITS.firstChars,
  maxItems = MT_LIMITS.maxItems, maxChars = MT_LIMITS.maxChars } = {}) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  for (const it of items) {
    const len = String(it.text).length;
    const itemCap = chunks.length ? maxItems : firstItems;
    const charCap = chunks.length ? maxChars : firstChars;
    if (cur.length && (cur.length >= itemCap || chars + len > charCap)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function statusError(status, retryAfter, keyed) {
  if (status === 429) {
    return new DLError(ERR.RATE_LIMITED, l10n('mq'), { status, retryAfterMs: parseRetryAfter(retryAfter) });
  }
  if ((status === 401 || status === 403) && keyed) return new DLError(ERR.CONFIG, l10n('mr'), { status });
  if (status >= 500 || status === 401 || status === 403 || status === 404) {
    return new DLError(ERR.PROVIDER, l10n('ms', [status]), { status });
  }
  return new DLError(ERR.PROVIDER, l10n('mt', [status]), { status });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new DLError(ERR.PARSE, l10n('mu')); }
}

function expectCount(list, n) {
  if (!Array.isArray(list) || list.length !== n) throw new DLError(ERR.PARSE, l10n('mv'));
  return list;
}

// ---- engine adapters: (job) -> Promise<string[]> aligned with job.items -------------------------

function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

function microsoftList(body, n) {
  const list = expectCount(parseJson(body), n);
  return list.map(entry => entry?.translations?.[0]?.text);
}

export function createMT({ fetchImpl, confirmEngine = async () => {}, getSecret = async () => '', now = () => Date.now(), timeoutMs = MT_LIMITS.timeoutMs,
  limits: runtimeLimits = MT_LIMITS } = {}) {
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);
  const cooldowns = new Map();
  const fails = new Map();
  let token = null;
  let active = 0;
  const waiting = [];
  const capacity = Math.max(1, Math.min(3, runtimeLimits.concurrency || 3));
  // One bound across concurrent page/hover requests, including token requests. Cancelled waiters
  // never start HTTP or consume a slot. Runtime mobile caps do not change saved settings.
  function slot(signal,priority=1) {
    return new Promise((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', abort);
        active++;
        resolve(() => { active--; waiting.shift()?.(); });
      };
      start.priority=priority;
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(cancelledError());
      };
      if (signal?.aborted) return abort();
      if (active < capacity) start();
      else { waiting.push(start);waiting.sort((a,b)=>a.priority-b.priority); signal?.addEventListener('abort', abort, { once: true }); }
    });
  }

  async function http(job, { url, method = 'POST', headers = {}, body }) {
    const release = await slot(job.signal,job.priority);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (job.signal) {
      if (job.signal.aborted) ctrl.abort();
      else job.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      await confirmEngine(job.engine);
      if(job.signal?.aborted)throw cancelledError();
      const res = await doFetch(url, { method, headers, body, signal: ctrl.signal, credentials: 'omit', cache: 'no-store', redirect:'error' });
      const text = await readResponseText(res,{url});
      return { status: res.status, text, retryAfter: res.headers?.get?.('retry-after') ?? null };
    } catch (e) {
      if(e?.code===ERR.CONFIRMATION_REQUIRED)throw e;
      if (job.signal?.aborted) throw cancelledError();
      if (e instanceof DLError && ['redirect','size'].includes(e.category)) throw e;
      if (timedOut) throw new DLError(ERR.NETWORK, l10n('errTimeout'), {category:'timeout'});
      const category = classify(e).category;
      if (category === 'redirect') throw redirectError();
      throw new DLError(ERR.NETWORK, l10n('errNetwork'), {category:['gm','timeout'].includes(category) ? category : 'network'});
    } finally {
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', onAbort);
      release();
    }
  }

  const textsOf = (job) => job.items.map(it => (job.html ? it.text : unescapeText(it.text)));

  async function msToken(job) {
    if (token && token.exp - 60000 > now()) return token.value;
    const res = await http(job, { url: MS_AUTH_URL, method: 'GET' });
    const value = res.text.trim();
    if (res.status !== 200 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) throw statusError(res.status === 200 ? 502 : res.status, null, false);
    let exp = now() + 8 * 60000;
    try {
      const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (Number.isFinite(payload.exp)) exp = payload.exp * 1000;
    } catch { /* keep the default lifetime */ }
    token = { value, exp };
    return value;
  }

  const adapters = {
    async microsoft(job) {
      const params = { from: msLang(job.from), to: msLang(job.to), ...(job.html ? { textType: 'html' } : {}) };
      const res = await http(job, { url: `${MS_FREE_URL}?${qs(params)}`, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(textsOf(job)) });
      if (res.status === 200) return microsoftList(res.text, job.items.length);
      if (res.status !== 401 && res.status !== 403) throw statusError(res.status, res.retryAfter, false);
      // The tokenless endpoint now wants a token: try the short-lived token flow.
      const bearer = await msToken(job);
      const viaToken = await http(job, {
        url: `${MS_TOKEN_API}?${qs({ 'api-version': '3.0', ...params })}`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(textsOf(job).map(Text => ({ Text }))),
      });
      if (viaToken.status === 401) token = null;
      if (viaToken.status !== 200) throw statusError(viaToken.status, viaToken.retryAfter, false);
      return microsoftList(viaToken.text, job.items.length);
    },

    async 'microsoft-api'(job) {
      const key = String(await getSecret('mt-microsoft-api') || '').trim();
      if (!key) throw new DLError(ERR.CONFIG, l10n('my'));
      const headers = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
      if (job.region) headers['Ocp-Apim-Subscription-Region'] = job.region;
      const params = { 'api-version': '3.0', from: msLang(job.from), to: msLang(job.to), ...(job.html ? { textType: 'html' } : {}) };
      const res = await http(job, { url: `${MS_OFFICIAL_API}?${qs(params)}`, headers, body: JSON.stringify(textsOf(job).map(Text => ({ Text }))) });
      if (res.status !== 200) throw statusError(res.status, res.retryAfter, true);
      return microsoftList(res.text, job.items.length);
    },

    async google(job) {
      const body = [
        qs({ client: 'gtx', sl: googleLang(job.from), tl: googleLang(job.to), ...(job.html ? { format: 'html' } : {}) }),
        ...textsOf(job).map(t => 'q=' + encodeURIComponent(t)),
      ].join('&');
      const res = await http(job, { url: GOOGLE_URL, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
      if (res.status !== 200) throw statusError(res.status, res.retryAfter, false);
      // sl=auto answers [[text, lang], …]; an explicit sl answers [text, …].
      return expectCount(parseJson(res.text), job.items.length).map(e => (typeof e === 'string' ? e : Array.isArray(e) ? e[0] : undefined));
    },

    async deepl(job) {
      const key = String(await getSecret('mt-deepl') || '').trim();
      if (!key) throw new DLError(ERR.CONFIG, l10n('mz'));
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const payload = { text: textsOf(job), target_lang: deeplTarget(job.to) };
      const source = deeplSource(job.from);
      if (source) payload.source_lang = source;
      if (job.html) payload.tag_handling = 'xml';
      const res = await http(job, { url: `${host}/v2/translate`, headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${key}` }, body: JSON.stringify(payload) });
      if (res.status === 456) throw new DLError(ERR.CONFIG, l10n('m10'), { status: 456,category:'quota',group:'common' });
      if (res.status !== 200) throw statusError(res.status, res.retryAfter, true);
      return expectCount(parseJson(res.text)?.translations, job.items.length).map(e => e?.text);
    },

    async mock(job) {
      await new Promise(resolve => setTimeout(resolve, 8));
      return job.items.map(it => MT_PLACEHOLDER + (job.html ? it.text : unescapeText(it.text)));
    },
  };

  const ready = (engine) => (cooldowns.get(engine) || 0) <= now();
  function failed(engine, error) {
    if(error?.code===ERR.PARSE)return; // one malformed batch must not poison unrelated work
    const n = (fails.get(engine) || 0) + 1;
    fails.set(engine, n);
    let wait = Math.min(300000, 15000 * 2 ** (n - 1));
    if (error?.code === ERR.RATE_LIMITED) wait = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : Math.max(wait, 60000);
    if (error?.code === ERR.CONFIG) wait = 300000;
    cooldowns.set(engine, now() + wait);
  }
  const succeeded = (engine) => { fails.delete(engine); cooldowns.delete(engine); };

  async function runChunk(job, chain) {
    let lastError = null;
    let pending = job.items;
    const results = new Map();
    for (const engine of chain) {
      if (job.signal?.aborted) throw cancelledError();
      if (!adapters[engine] || !ready(engine)) continue;
      try {
        const raw = await adapters[engine]({ ...job, items: pending, engine });
        if (job.signal?.aborted) throw cancelledError();
        const missing = [];
        pending.forEach((it, i) => {
          const out = raw[i];
          if (typeof out !== 'string' || !out.trim()) missing.push(it);
          else results.set(it.id, { id: it.id, engine, ...finishItem(it.text, out, job.html), ...(lastError && FREE_ORDER.includes(engine) ? {notice:toErrorInfo(new DLError(ERR.FALLBACK, l10n('errFallback')))} : {}) });
        });
        pending = missing;
        if (!pending.length) { succeeded(engine); return job.items.map(it => results.get(it.id)); }
        lastError = new DLError(ERR.PARSE, l10n('m11'));
        failed(engine, lastError);
      } catch (e) {
        if (isCancelled(e)||e?.code===ERR.CONFIRMATION_REQUIRED) throw e;
        lastError = e;
        failed(engine, e);
      }
    }
    if(chain.some(id=>['deepl','microsoft-api'].includes(id))&&lastError)lastError.noFallback=true;
    const error = lastError ? {...toErrorInfo(lastError),group:'common'} : { code: ERR.NETWORK, get message(){return l10n('m13');} };
    return job.items.map(it => results.get(it.id) || { id: it.id, error });
  }

  // items: [{ id, text }] in serialized-markup form. onResults(list) is called once per finished
  // request with [{ id, text, plain?, engine } | { id, error }]. Resolves when every item reported.
  async function translate({ items, to, from = 'auto', chain = ['microsoft', 'google'], region = '', signal,priority, onResults = () => {}, limits = runtimeLimits }) {
    if (signal?.aborted) throw cancelledError();
    if(['deepl','microsoft-api'].includes(chain[0]))chain=[chain[0]];
    // An exceptionally large inline group cannot be split with its markup intact. Send bounded
    // plain pieces instead; the LLM can restore its formatting. Never exceed vendor request limits.
    const long = new Map();
    items = items.flatMap(it => {
      if (it.text.length <= limits.maxChars) return [it];
      const pieces = splitLongText(escapeText(stripMarkup(it.text)), limits.maxChars);
      const group = { item: it, parts: new Array(pieces.length), left: pieces.length };
      return pieces.map((text, index) => {
        const piece = { id: {}, text };
        long.set(piece.id, { group, index });
        return piece;
      });
    });
    const deliver = list => {
      const out = [];
      for (const result of list) {
        const part = long.get(result.id);
        if (!part) { out.push(result); continue; }
        const { group, index } = part;
        if (group.done) continue;
        if (result.error) { group.done = true; out.push({ id: group.item.id, error: result.error }); continue; }
        group.parts[index] = result;
        if (--group.left) continue;
        group.done = true;
        out.push({ id: group.item.id, text: joinTranslations(group.parts.map(r => r.text)),
          engine: group.parts.map(r => r.engine).join('+'), ...(hasMarkers(group.item.text) ? { plain: true } : {}) });
        // A uniform engine keeps the ordinary cache identity; a mixed-engine result is not reused
        // as if a single engine produced it.
        if (group.parts.every(r => r.engine === result.engine)) out[out.length - 1].engine = result.engine;
      }
      if (out.length && !signal?.aborted) onResults(out);
    };
    const marked = items.filter(it => hasMarkers(it.text));
    const plain = items.filter(it => !hasMarkers(it.text));
    const jobs = [
      ...chunkItems(marked, limits).map(chunk => ({ html: true, items: chunk })),
      ...chunkItems(plain, limits).map(chunk => ({ html: false, items: chunk })),
    ];
    const order = new Map(items.map((it, index) => [it, index]));
    jobs.sort((a, b) => order.get(a.items[0]) - order.get(b.items[0]));
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (!failure && next < jobs.length) {
        const job = jobs[next++];
        try {
          const list = await runChunk({ ...job, to, from, region, signal,priority }, chain);
          deliver(list);
        } catch (e) { failure = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, jobs.length) }, worker));
    if (failure) throw failure;
  }

  // Settings-page probe: one engine, no fallback, ignores cooldown.
  async function test({ engine, to = 'zh-CN', from = 'en', region = '', signal } = {}) {
    if (!isMtEngine(engine)) throw new DLError(ERR.CONFIG, l10n('m14'));
    cooldowns.delete(engine);
    const started = now();
    let result;
    await translate({ items: [{ id: 1, text: 'Hello, world.' }], to, from, chain: [engine], region, signal, onResults: list => { result = list[0]; } });
    cooldowns.delete(engine);
    if (!result || result.error) throw new DLError(result?.error?.code || ERR.PROVIDER, result?.error?.message || l10n('m15'), result?.error);
    return { engine, latencyMs: Math.max(0, now() - started), sample: stripMarkup(result.text).slice(0, 200) };
  }

  return { translate, test, resetCooldowns: () => { cooldowns.clear(); fails.clear(); token = null; } };
}

import { t as l10n } from '../shared/i18n.js';
// Injected providers resolve local secrets per request; keys never enter logs or errors.

import { ERR } from '../shared/protocol.js';
import { DLError, cancelledError } from '../shared/errors.js';
import { getDefaultSettingsStore } from '../shared/settings.js';
import { createSSEParser } from '../shared/stream.js';
import { profileFromPreset } from '../shared/presets.js';

const TEMPERATURE = 0.2;
const MODEL_TIMEOUT = 15000;

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const when = Date.parse(s);
  return Number.isNaN(when) ? undefined : Math.max(0, when - nowMs);
}

// Loopback, RFC1918, shared address space, link-local, .local and bare hostnames: places where plain http is acceptable.
export function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  if (!h.includes('.') && !h.includes(':')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

// Returns a human-readable problem string, or null when the profile can be used.
export function profileProblem(profile) {
  if (!profile || typeof profile !== 'object') return l10n('m19');
  if (profile.kind === 'mock') return null;
  if (profile.kind !== 'openai') return l10n('m1a', [profile.kind]);
  let url;
  try {
    url = new URL(String(profile.baseUrl || ''));
  } catch {
    return l10n('m1b');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return l10n('m1c');
  if (url.username || url.password || url.search || url.hash) return l10n('m1d');
  if (!profile.model) return l10n('m1e');
  if (profile.kind === 'openai') {
    const key = String(profile.apiKey || '');
    if (/[^\x20-\x7e]/.test(key)) return l10n('m1f');
    if (key && url.protocol === 'http:' && !isLocalHost(url.hostname)) return l10n('m1g');
  }
  return null;
}

export function normalizeBaseUrl(value, { completeRoot = false } = {}) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  // Only a literal HTTP(S) authority: validation still rejects malformed hosts.
  return completeRoot && /^https?:\/\/[^/?#@\\\s]+$/i.test(base) ? base + '/v1' : base;
}

function endpoint(profile, path) {
  return normalizeBaseUrl(profile.baseUrl) + path;
}

const isHtml = res => /text\/html/i.test(res.type) || /^\s*</.test(res.text);

function headersFor(profile) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (profile.kind === 'openai' && profile.apiKey) h.Authorization = `Bearer ${String(profile.apiKey).trim()}`;
  if (isOpenRouter(profile)) h['X-Title'] = 'DualLens';
  return h;
}

function scrub(text, profile) {
  let s = String(text ?? '');
  const key = String(profile?.apiKey || '').trim();
  if (key) s = s.split(key).join('***');
  return s;
}

function serverMessage(bodyText, profile) {
  let msg = '';
  try {
    const j = JSON.parse(bodyText);
    const e = j?.error ?? j;
    msg = typeof e === 'string' ? e : (e && (e.message || e.detail || e.msg)) || '';
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {
    msg = String(bodyText ?? '');
  }
  return scrub(msg.replace(/\s+/g, ' ').trim(), profile).slice(0, 300);
}

function hostOf(profile) {
  try {
    return new URL(profile.baseUrl).host;
  } catch {
    return l10n('m1h');
  }
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cancelledError());
    const onAbort = () => {
      clearTimeout(t);
      reject(cancelledError());
    };
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function assistantText(json) {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const content = choice?.message ? choice.message.content : choice?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '').join('');
  }
  return null;
}

export function isOpenRouter(profile) {
  try { return new URL(profile.baseUrl).origin === 'https://openrouter.ai'; } catch { return false; }
}

export function freeOpenRouterModels(list) {
  const zero = value => (typeof value === 'string' && value.trim() !== '' || typeof value === 'number') && Number(value) === 0;
  const seen = new Set();
  return list.filter(m => m && typeof m.id === 'string' && m.id && !seen.has(m.id) &&
    zero(m.pricing?.prompt) && zero(m.pricing?.completion) && seen.add(m.id)).map(m => ({
      id: m.id, label: String(m.name || m.id), context_length: Number(m.context_length) || 0,
      supported_parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.filter(p => typeof p === 'string') : [],
      jsonMode: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('response_format'),
      free: true,
    })).sort((a, b) => Number(b.jsonMode) - Number(a.jsonMode) || b.context_length - a.context_length || a.id.localeCompare(b.id));
}

export function createProviders({ fetchImpl, getSecret = async id => {
  return globalThis.chrome?.storage?.local ? getDefaultSettingsStore().getSecret(id) : '';
}, random = Math.random, sleep = abortableSleep } = {}) {
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  const noJson = new Set();
  const noStream = new Set();
  async function withSecret(profile) {
    // apiKey is accepted only as a transient legacy adapter input, never stored here.
    if (profile?.kind !== 'openai') return profile;
    return { ...profile, apiKey: await getSecret(profile.id) || profile.apiKey || '' };
  }

  async function request(profile, { url, method, body, timeoutMs, idleMs = timeoutMs, signal, onDelta, beforeSend }) {
    const ctrl = new AbortController();
    let timedOut = false;
    let timer;
    let limit = timeoutMs;
    const reset = ms => { clearTimeout(timer); limit = ms; timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms); };
    reset(timeoutMs);
    let content = '', streamed = false, done = false, finished = false, carry = '';
    // Headers are a Headers object from fetch, but a plain object from wrapped transports (settings page, GM).
    const mime = h => String((typeof h?.get === 'function' ? h.get('content-type') : h?.['content-type'] ?? h?.['Content-Type']) || '');
    const key = String(profile.apiKey || '').trim();
    const emitDelta = delta => {
      const text = scrub(carry + delta, profile);
      let hold = 0;
      // Retain only a possible key prefix, so redaction also works when the
      // upstream splits a credential across SSE events.
      for (let n = Math.min(key.length - 1, text.length); n > 0; n--) {
        if (key.startsWith(text.slice(-n))) { hold = n; break; }
      }
      carry = hold ? text.slice(-hold) : '';
      const ready = hold ? text.slice(0, -hold) : text;
      if (ready) onDelta?.(ready);
    };
    const parser = createSSEParser(data => {
      if (data === '[DONE]') { done = true; if (carry) onDelta?.(carry); carry = ''; return; }
      if (done) return;
      let event;
      try { event = JSON.parse(data); } catch { throw new DLError(ERR.PARSE, l10n('m1i')); }
      if (event.error) throw new DLError(ERR.PROVIDER, l10n('m1j'), { status: 502 });
      const delta = event.choices?.[0]?.delta;
      if (delta?.content || delta?.reasoning_content) reset(idleMs);
      if (typeof delta?.content === 'string') {
        content += delta.content;
        if (content.length > 4 * 1024 * 1024) throw new DLError(ERR.PARSE, l10n('m1k'));
        emitDelta(delta.content);
      }
      // Some OpenAI-compatible servers end with finish_reason and never send [DONE].
      if (event.choices?.[0]?.finish_reason) finished = true;
    });
    const progress = (text, status, headers) => {
      if (status >= 200 && status < 300 && /text\/event-stream/i.test(mime(headers))) {
        streamed = true; parser.push(text);
      }
    };
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      await beforeSend?.();
      if (signal?.aborted) throw cancelledError();
      const res = await doFetch(url, {
        method,
        headers: { ...headersFor(profile), ...(onDelta ? { Accept: 'text/event-stream, application/json' } : {}) },
        body,
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
        timeoutMs, onText: progress,
      });
      let text;
      if (onDelta && res.body?.getReader && /text\/event-stream/i.test(mime(res.headers))) {
        streamed = true;
        const reader = res.body.getReader(), decoder = new TextDecoder();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            parser.push(decoder.decode(part.value, { stream: true }));
            if (done) { await reader.cancel(); break; }
          }
          parser.push(decoder.decode());
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        text = '';
      } else text = await res.text();
      // A transport that buffers the whole body (no reader, no progress callback) still receives the SSE
      // stream we asked for: parse it here instead of mistaking it for a malformed JSON reply.
      if (!streamed && res.status >= 200 && res.status < 300 && (/text\/event-stream/i.test(mime(res.headers)) || /^\s*data:/.test(text))) {
        streamed = true; parser.push(text);
      }
      if (streamed) {
        parser.end();
        if (finished && !done && carry) { onDelta?.(carry); carry = ''; }
        if (!done && !finished) throw new DLError(ERR.PROVIDER, l10n('m1l'), { status: 502 });
        text = JSON.stringify({ choices: [{ message: { content } }] });
      }
      return { status: res.status, type: mime(res.headers), retryAfter: res.headers?.get?.('retry-after'), text };
    } catch (e) {
      if (signal && signal.aborted) throw cancelledError();
      if (e instanceof DLError) throw e;
      if (timedOut) throw new DLError(ERR.NETWORK, l10n('m1m', [Math.round(limit / 1000)]));
      throw new DLError(ERR.NETWORK, l10n('m1n', [hostOf(profile)]));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  function httpError(profile, res, json) {
    const detail = serverMessage(res.text, profile);
    const suffix = detail ? l10n('errorDetail', [detail]) : '';
    const extra = { status: res.status, serverCode: json?.error?.code, retryAfterMs: parseRetryAfter(res.retryAfter) };
    if (res.status === 429) {
      return new DLError(ERR.RATE_LIMITED, l10n('m1o', [suffix]), extra);
    }
    if ((res.status === 401 || res.status === 403)) {
      return new DLError(ERR.CONFIG, l10n('endpointAuth', [res.status]), extra);
    }
    if (res.status === 404) return new DLError(ERR.PROVIDER, l10n('endpointNotFound', [res.status]), extra);
    if (isHtml(res) || json === undefined) return badJSON(profile, res, extra, ERR.PROVIDER);
    return new DLError(ERR.PROVIDER, l10n('m1q', [res.status, suffix]), extra);
  }

  function badJSON(profile, res, extra = { status: res.status }, code = ERR.PARSE) {
    return new DLError(code, isHtml(res) ? l10n('endpointHtml') : l10n('endpointParse',
      [res.status, scrub(res.text, profile).replace(/\s+/g, ' ').trim().slice(0, 80)]), extra);
  }

  function readJSON(profile, res) {
    let json;
    try { json = JSON.parse(res.text); } catch { /* Report the bounded, scrubbed body below. */ }
    if (res.status < 200 || res.status >= 300) throw httpError(profile, res, json);
    if (isHtml(res) || json === undefined) throw badJSON(profile, res);
    return json;
  }

  // Root addresses that only answered under /v1: later calls go there directly instead of probing the root again.
  const rootFixed = new Set();
  async function sendAPI(profile, send) {
    const root = normalizeBaseUrl(profile.baseUrl), baseUrl = normalizeBaseUrl(root, { completeRoot: true });
    let res = rootFixed.has(root) ? null : await send(profile);
    if (!res || baseUrl !== root && ![401, 403].includes(res.status) && (res.status === 404 || isHtml(res))) {
      profile = { ...profile, baseUrl }; res = await send(profile);
      if (res.status > 199 && res.status < 300 && !isHtml(res)) rootFixed.add(root);
      return { profile, res, baseUrl };
    }
    return { profile, res };
  }

  async function mockChat({ model, messages, signal }) {
    await sleep(30 + Math.floor(random() * 91), signal);
    if (model === 'mock-slow') await sleep(2000, signal);
    if (model === 'mock-error') throw new DLError(ERR.PROVIDER, l10n('m1r'));
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const text = user ? String(user.content) : '';
    if (text.includes('<input>')) {
      try { const data=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
        return JSON.stringify({t:data.t.map(t=>'【译】'+t)}); } catch { throw new DLError(ERR.PARSE,l10n('m1t')); }
    }
    if (!/<seg\s+id=/.test(text)) return `【译】${text}`;
    return text.replace(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g, '<seg id="$1">【译】$2</seg>');
  }

  async function chat({ profile, model, messages, signal, onDelta, beforeSend, onBaseUrl }) {
    if (signal && signal.aborted) throw cancelledError();
    if (profile?.kind === 'mock') return mockChat({ model: model || profile.model, messages, signal });
    profile = await withSecret(profile);
    profile = { ...profile, model: model || profile.model };
    const problem = profileProblem(profile);
    if (problem) throw new DLError(ERR.CONFIG, problem);
    if (profile.requiresKey && !profile.apiKey) throw new DLError(ERR.CONFIG, l10n('m1w'));
    const payload={ model: profile.model, messages, temperature:TEMPERATURE, stream:true,
      max_tokens:Math.min(4096, Math.max(256, messages.filter(m=>m.role==='user').reduce((n,m)=>n+String(m.content).length,0)*2+256)) };
    const slot=profile.id+'|'+profile.baseUrl+'|'+profile.model;
    if (noStream.has(slot)) payload.stream = false;
    if(profile.jsonMode!==false&&!noJson.has(slot)) payload.response_format={type:'json_object'};
    const send=(target = profile)=>request(target, {
      url: endpoint(target, '/chat/completions'),
      method: 'POST',
      body: JSON.stringify(payload),
        timeoutMs: profile.timeoutMs > 0 ? profile.timeoutMs : 60000,
      signal, beforeSend, onDelta: onDelta || (() => {}),
    });
    const reply = await sendAPI(profile, send);
    profile = reply.profile;
    let res = reply.res;
    if(res.status===400&&payload.response_format&&!/stream/i.test(serverMessage(res.text, profile))) {
      delete payload.response_format; noJson.add(slot); res=await send();
    }
    if (payload.stream && [400, 422, 501].includes(res.status)) {
      payload.stream = false;
      res = await send();
      if (res.status === 400 && payload.response_format) {
        delete payload.response_format; noJson.add(slot); res = await send();
      }
      if (res.status >= 200 && res.status < 300) noStream.add(slot);
    }
    const json = readJSON(profile, res);
    const content = assistantText(json);
    if (content == null) throw new DLError(ERR.PARSE, l10n('m1y'));
    if (reply.baseUrl) onBaseUrl?.(reply.baseUrl);
    return scrub(content, profile);
  }

  async function listModels(profile, { signal, freeOnly = true, onBaseUrl } = {}) {
    if (typeof profile === 'string') profile = profileFromPreset(profile);
    if (profile?.kind === 'mock') {
      return ['mock', 'mock-error', 'mock-slow'].map((id) => ({ id, label: id }));
    }
    // OpenRouter's public catalog must not receive a user's Authorization header.
    profile = isOpenRouter(profile) ? { ...profile, apiKey: '' } : await withSecret(profile);
    const problem = profileProblem({ ...profile, model: profile?.model || 'x' });
    if (problem) throw new DLError(ERR.CONFIG, problem);
    const reply = await sendAPI(profile, target => request(target, {
      url: endpoint(target, '/models'),
      method: 'GET',
      timeoutMs: Math.min(profile.timeoutMs > 0 ? profile.timeoutMs : MODEL_TIMEOUT, MODEL_TIMEOUT),
      signal,
    }));
    profile = reply.profile;
    const json = readJSON(profile, reply.res);
    const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : json?.models;
    if (!Array.isArray(list)) throw new DLError(ERR.PARSE, l10n('m1z'));
    if (reply.baseUrl) onBaseUrl?.(reply.baseUrl);
    if (isOpenRouter(profile) && freeOnly) return freeOpenRouterModels(list);
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const id = typeof m === 'string' ? m : m && (m.id || m.name || m.model);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id: String(id), label: String(m?.name || id) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  return { chat, listModels };
}

export const providers = createProviders();

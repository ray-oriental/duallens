// Model providers. `chat` is the function the translator/queue call:
//   chat({ profile, model, messages, signal }) -> Promise<string>   (assistant text)
// kinds: 'gateway' (local OpenAI-compatible gateway, never sends a key), 'openai' (user endpoint,
// Bearer key), 'mock' (no network; deterministic fake for tests and demos).
// The apiKey is read from the profile only to build the Authorization header; it is never logged
// and is scrubbed from any error text.

import { ERR } from '../shared/protocol.js';
import { DLError, cancelledError } from '../shared/errors.js';

const TEMPERATURE = 0.2;
const MODELS_TIMEOUT_MS = 15000;

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const when = Date.parse(s);
  return Number.isNaN(when) ? undefined : Math.max(0, when - nowMs);
}

// Loopback, RFC1918, link-local, .local and bare hostnames: places where plain http is acceptable.
export function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  if (!h.includes('.') && !h.includes(':')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

// Returns a human-readable problem string, or null when the profile can be used.
export function profileProblem(profile) {
  if (!profile || typeof profile !== 'object') return '没有可用的模型配置';
  if (profile.kind === 'mock') return null;
  if (profile.kind !== 'gateway' && profile.kind !== 'openai') return `未知的接口类型：${profile.kind}`;
  let url;
  try {
    url = new URL(String(profile.baseUrl || ''));
  } catch {
    return '接口地址为空或格式不对';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '接口地址必须以 http:// 或 https:// 开头';
  if (!profile.model) return '尚未选择模型';
  if (profile.kind === 'openai') {
    const key = String(profile.apiKey || '');
    if (/[^\x20-\x7e]/.test(key)) return 'API key 含有非法字符';
    if (key && url.protocol === 'http:' && !isLocalHost(url.hostname)) return '不会通过明文 http 向远程主机发送 API key，请改用 https';
  }
  return null;
}

function endpoint(profile, path) {
  return String(profile.baseUrl).replace(/\/+$/, '') + path;
}

function headersFor(profile) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (profile.kind === 'openai' && profile.apiKey) h.Authorization = `Bearer ${String(profile.apiKey).trim()}`;
  return h;
}

function scrub(text, profile) {
  let s = String(text ?? '');
  const key = profile && profile.apiKey ? String(profile.apiKey).trim() : '';
  if (key.length >= 6) s = s.split(key).join('***');
  return s;
}

function serverMessage(bodyText, profile) {
  let msg = '';
  try {
    const j = JSON.parse(bodyText);
    const e = j && (j.error ?? j);
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
    return '接口地址';
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
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : choice && choice.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : '')).join('');
  }
  return null;
}

export function createProviders({ fetchImpl, random = Math.random, sleep = abortableSleep } = {}) {
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  const noJson = new Set();

  async function request(profile, { url, method, body, timeoutMs, signal }) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await doFetch(url, {
        method,
        headers: headersFor(profile),
        body,
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      const text = await res.text();
      return { status: res.status, retryAfter: res.headers && res.headers.get ? res.headers.get('retry-after') : null, text };
    } catch (e) {
      if (signal && signal.aborted) throw cancelledError();
      if (timedOut) throw new DLError(ERR.NETWORK, `请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      const hint = profile.kind === 'gateway' ? '，请确认本机网关已启动' : '';
      throw new DLError(ERR.NETWORK, `无法连接 ${hostOf(profile)}${hint}`);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  function httpError(profile, res) {
    const detail = serverMessage(res.text, profile);
    const suffix = detail ? `：${detail}` : '';
    const extra = { status: res.status };
    if (res.status === 429) {
      return new DLError(ERR.RATE_LIMITED, `被限流（429）${suffix}`, {
        ...extra,
        retryAfterMs: parseRetryAfter(res.retryAfter),
      });
    }
    if ((res.status === 401 || res.status === 403) && profile.kind !== 'gateway') {
      return new DLError(ERR.CONFIG, `认证失败（${res.status}），请检查 API key${suffix}`, extra);
    }
    return new DLError(ERR.PROVIDER, `接口返回 ${res.status}${suffix}`, extra);
  }

  async function mockChat({ model, messages, signal }) {
    await sleep(30 + Math.floor(random() * 91), signal);
    if (model === 'mock-slow') await sleep(2000, signal);
    if (model === 'mock-error') throw new DLError(ERR.PROVIDER, '演示后端按要求返回错误');
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const text = user ? String(user.content) : '';
    if (text.includes('<input>')) {
      try { const data=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
        return JSON.stringify({t:data.t.map(t=>'【译】'+t)}); } catch { throw new DLError(ERR.PARSE,'演示输入格式错误'); }
    }
    if (!/<seg\s+id=/.test(text)) return `【译】${text}`;
    return text.replace(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g, '<seg id="$1">【译】$2</seg>');
  }

  async function chat({ profile, model, messages, signal }) {
    if (signal && signal.aborted) throw cancelledError();
    if (profile && profile.kind === 'mock') return mockChat({ model: model || profile.model, messages, signal });
    const problem = profileProblem(profile);
    if (problem) throw new DLError(ERR.CONFIG, problem);
    const payload={ model: model || profile.model, messages, temperature:TEMPERATURE, stream:false,
      max_tokens:Math.min(4096, Math.max(256, messages.filter(m=>m.role==='user').reduce((n,m)=>n+String(m.content).length,0)*2+256)) };
    const jsonKey=profile.baseUrl+'|'+(model||profile.model);
    if(profile.jsonMode!==false&&!noJson.has(jsonKey)) payload.response_format={type:'json_object'};
    const send=()=>request(profile, {
      url: endpoint(profile, '/chat/completions'),
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: profile.timeoutMs > 0 ? profile.timeoutMs : 60000,
      signal,
    });
    let res=await send();
    if(res.status===400&&payload.response_format) {
      delete payload.response_format; noJson.add(jsonKey); res=await send();
    }
    if (res.status < 200 || res.status >= 300) throw httpError(profile, res);
    let json;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new DLError(ERR.PARSE, '接口返回的不是 JSON');
    }
    const content = assistantText(json);
    if (content == null) throw new DLError(ERR.PARSE, '接口返回里没有译文内容');
    return content;
  }

  async function listModels(profile, { signal } = {}) {
    if (profile && profile.kind === 'mock') {
      return ['mock', 'mock-error', 'mock-slow'].map((id) => ({ id, label: id }));
    }
    const problem = profileProblem({ ...profile, model: profile && (profile.model || 'x') });
    if (problem) throw new DLError(ERR.CONFIG, problem);
    const res = await request(profile, {
      url: endpoint(profile, '/models'),
      method: 'GET',
      timeoutMs: Math.min(profile.timeoutMs > 0 ? profile.timeoutMs : MODELS_TIMEOUT_MS, MODELS_TIMEOUT_MS),
      signal,
    });
    if (res.status < 200 || res.status >= 300) throw httpError(profile, res);
    let json;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new DLError(ERR.PARSE, '接口返回的不是 JSON');
    }
    const list = Array.isArray(json) ? json : Array.isArray(json && json.data) ? json.data : json && json.models;
    if (!Array.isArray(list)) throw new DLError(ERR.PARSE, '接口返回里没有模型列表');
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const id = typeof m === 'string' ? m : m && (m.id || m.name || m.model);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id: String(id), label: String((m && m.name) || id) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  return { chat, listModels };
}

export const providers = createProviders();

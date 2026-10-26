// Error type shared by providers, queue and translator. `code` is one of protocol.js ERR.

import { ERR } from './protocol.js';
import { t } from './i18n.js';

// Protocol names provide defaults; HTTP/provider hints take precedence.
const CODE_KIND = Object.fromEntries(Object.entries(ERR).map(([key,value]) => [value,key.split('_')[0].toLowerCase()]));

export class DLError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DLError';
    this.code = code;
    if (code === ERR.CONFIRMATION_REQUIRED && extra.destination) this.destination = extra.destination;
    for (const key of ['status','retryAfterMs','serverCode','category','service']) if (extra[key] != null) this[key] = extra[key];
    if (extra.group === 'common') this.group = 'common';
    if (extra.noFallback === true) this.noFallback = true;
  }
}

export function cancelledError() {
  return new DLError(ERR.CANCELLED, t('cancelled'));
}

export function isCancelled(e) {
  return !!e && e.code === ERR.CANCELLED;
}

// Normalises anything thrown into the { code, message } shape carried on the wire.
export function toErrorInfo(e) {
  const info = classify(e);
  // Local validation messages are authored copy; server/transport errors always use the catalogue.
  if (e instanceof DLError && !e.status && !e.category && ![ERR.NETWORK,ERR.TIMEOUT].includes(e.code)) info.message = scrub(e.message);
  if (e?.code === ERR.CONFIRMATION_REQUIRED && e.destination) info.destination = e.destination;
  return info;
}

// Never display server prose, URLs, JSON, stack traces or arbitrary machine codes.
// Exact request secrets are removed before inspecting an upstream response.
export function scrub(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) if (secret) text = text.split(String(secret)).join('***');
  return text.replace(/(?:Bearer|DeepL-Auth-Key)\s+[^\s,"'<>]+/gi, '***')
    .replace(/\bsk-[\w-]+/g, '***')
    .replace(/((?:api[_-]?key|access[_-]?token|token|authorization|secret|password)["']?\s*[:=]\s*["']?)[^\s,"'&<>]+/gi, '$1***')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***');
}

export function parseRetryAfter(value, nowMs = Date.now()) {
  const s = String(value ?? '').trim();
  if (!s || /^[+-]/.test(s)) return undefined;
  const ms = /^\d+(\.\d+)?$/.test(s) ? Number(s) * 1000 : Date.parse(s) - nowMs;
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : undefined;
}

const SERVICES = ['OpenAI','DeepSeek','OpenRouter','Ollama','LM Studio','Microsoft','Google','DeepL'];
export function serviceName(profile) {
  try {
    const host = new URL(profile.baseUrl).hostname;
    return ({'api.openai.com':'OpenAI','api.deepseek.com':'DeepSeek','openrouter.ai':'OpenRouter'})[host] ||
      (profile.preset === 'ollama' ? 'Ollama' : profile.preset === 'lmstudio' ? 'LM Studio' : '');
  } catch { return ''; }
}

const COPY = {
  offline:()=>t('errOffline'),
  network:()=>t('errNetwork'),
  timeout:()=>t('errTimeout'),
  rate:()=>t('errRate'),
  server:()=>t('errServer'),
  auth:()=>t('errAuth'),
  address:()=>t('errAddress'),
  parse:()=>t('errParse'),
  html:()=>t('errHtml'),
  model:()=>t('errModel'),
  quota:()=>t('errQuota'),
  refused:()=>t('errRefused'),
  config:()=>t('errConfig'),
  confirmation:()=>t('errConfirmation'),
  permission:()=>t('errPermission'),
  restricted:()=>t('errRestricted'),
  injection:()=>t('errInjection'),
  storage:()=>t('errStorage'),
  partial:n=>t('errPartial', [n]),
  fallback:()=>t('errFallback'),
  cancelled:()=>t('errCancelled'),
  unknown:()=>t('errUnknown'),
  gm:()=>t('errGm'),
  redirect:()=>t('errRedirect'),
  size:()=>t('errResponseSize'),
  image:()=>t('errImage'),
};

export function classify(error, { online = globalThis.navigator?.onLine, count = error?.count } = {}) {
  const e = error || {}, st = Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : undefined;
  const code = Object.hasOwn(CODE_KIND,e.code) ? e.code : ERR.PROVIDER;
  const raw = String(e.serverCode || '').toLowerCase();
  let kind = code === ERR.PARTIAL ? 'partial' : Object.hasOwn(COPY,e.category) ? e.category : '';
  if (!kind && (code === ERR.REDIRECT || st >= 300 && st < 400 || /redirect/i.test([e.cause?.code,e.cause?.message,e.message].join(' ')))) kind = 'redirect';
  if (!kind && code === ERR.RESPONSE_SIZE) kind = 'size';
  if (!kind && e.message === 'Network request failed') kind = 'gm';
  if (!kind && e.message === 'Network request timed out') kind = 'timeout';
  if (!kind && /quota.*exceed|QUOTA_BYTES|MAX_WRITE_OPERATIONS|storage.*full/i.test(String(e.message || ''))) kind = 'storage';
  if (!kind) {
    if (/insufficient[_ ](?:quota|balance|credits)|quota_exceeded|credit|balance|billing|402/.test(raw) || st === 402 || st === 456) kind = 'quota';
    else if (/content[_ ](?:filter|policy)|safety|moderation/.test(raw)) kind = 'refused';
    else if (/model.*(?:not[_ ]found|not[_ ]exist|does not exist|not available|unavailable|invalid)|invalid[_ ]model|no_available_model|no endpoints found|unknown_model/.test(raw)) kind = 'model';
    else if (st === 401 || st === 403) kind = 'auth';
    else if (st === 429 || code === ERR.RATE_LIMITED) kind = 'rate';
    else if (st === 404) kind = 'address';
    else if (st >= 500) kind = 'server';
    else kind = Object.hasOwn(COPY,CODE_KIND[code]) ? CODE_KIND[code] :
      (e.name === 'QuotaExceededError' ? 'storage' : e.name === 'TimeoutError' ? 'timeout' : e.name === 'TypeError' ? 'network' : 'unknown');
  }
  if (online === false && ['network','gm'].includes(kind)) kind = 'offline';
  const waitMs = Number.isFinite(e.retryAfterMs) && e.retryAfterMs >= 0 ? Math.min(e.retryAfterMs, Number.MAX_SAFE_INTEGER) : undefined;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  let msg = COPY[kind](n);
  if (kind === 'image' && st) msg = `HTTP ${st} · ${msg}`;
  if (waitMs != null && (kind === 'rate' || kind === 'partial' && st === 429)) {
    const wait = t('errRateWait', [Math.max(1, Math.ceil(waitMs / 1000))]);
    msg = kind === 'rate' ? wait : msg+' '+wait;
  }
  if (e.noFallback === true) msg += t('m12');
  const retryable = ['network','offline','gm','timeout','rate','server'].includes(kind);
  const action = ['auth','address','model','quota','config','html','storage','redirect'].includes(kind) ? 'settings' :
    (retryable || ['parse','injection','partial','image'].includes(kind)) ? 'retry' : 'details';
  const group = kind === 'storage' ? 'data' : e.group === 'common' ? 'common' : 'ai';
  const name = SERVICES.includes(e.service) ? e.service : '';
  const detail = [name, st ? `HTTP ${st}` : ''].filter(Boolean).join(' · ') || t('errNoDetail');
  return { code, category:kind, message:msg, action, group, detail, retryable, status:st, service:name||undefined,
    noFallback:e.noFallback===true||undefined, retryAfterMs:waitMs, count:kind==='partial'?n:undefined };
}

export function partialFailure(units) {
  const count = [...units].filter(u => u.state === 'error' && !u.dead && !u.autoRetry).length;
  return classify({code:ERR.PARTIAL, count});
}

export function autoRetryDelay(error, attempts = 0) {
  const info = classify(error);
  if (!info.retryable || attempts >= 2) return null;
  return info.category === 'rate' ? Math.min(120000, info.retryAfterMs ?? 60000) : 16000;
}


let revision = 0;
// A shared inert renderer; callers own layout and cancel stale retry callbacks.
export function renderError(node, error, { retry, openSettings, partial = false, buttonClass = 'dl-text-button', milliseconds = true } = {}) {
  const info = classify(error), doc = node.ownerDocument;
  node.dataset.errorRevision = String(++revision);
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  const text = doc.createElement('span');
  const now = new Date();
  text.textContent = `${now.toTimeString().slice(0, 8)}${milliseconds ? '.'+String(now.getMilliseconds()).padStart(3,'0') : ''} · ${info.message}`;
  node.replaceChildren(text);
  const button = (label, fn) => {
    const b = doc.createElement('button'); b.type = 'button'; b.className = buttonClass;
    b.textContent = label; b.onclick = fn; node.append(doc.createTextNode(' '), b); return b;
  };
  if ((info.action === 'settings' || partial) && openSettings) button(t('errSettings'), () => openSettings(info.group));
  if ((info.action === 'retry' || partial) && retry) button(partial ? t('errRetryPartial') : t('errRetry'), retry);
  const detail = doc.createElement('small'); detail.hidden = true; detail.textContent = info.detail;
  const toggle = button(t('errDetails'), () => { detail.hidden = !detail.hidden; toggle.setAttribute('aria-expanded', String(!detail.hidden)); });
  toggle.setAttribute('aria-expanded', 'false');
  node.append(doc.createTextNode(' '), detail);
  node.getAnimations?.().forEach(a => a.cancel());
  if (!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    node.animate?.([{opacity:0},{opacity:1}], {duration:120});
  return info;
}

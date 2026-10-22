import { t as l10n } from '../shared/i18n.js';
// Global priority queue; concurrency is per profile, cooldown is per (profile, model).
import { ERR } from '../shared/protocol.js';
import { cancelledError, isCancelled } from '../shared/errors.js';

export function createQueue(options = {}) {
  const cfg = { baseBackoffMs: 2000, maxBackoffMs: 60000, cooldownMs: 60000,
    maxAttempts: 4, now: () => Date.now(), ...options };
  const states = new Map(), live = new Set();
  let seq = 0, timer = null;
  function state(profile) {
    if (!states.has(profile.id)) states.set(profile.id, { profile, running: 0, cooldowns: new Map(), rates: new Map(), missing: new Map() });
    const s = states.get(profile.id); s.profile = profile; return s;
  }
  function candidates(profile, chain) {
    const list = chain?.length ? chain : [profile.model, ...(profile.fallbackModels || [])].map(model => ({ profile, model }));
    const seen = new Set();
    return list.filter(c => {
      const key = JSON.stringify([c.profile?.id, c.model]);
      if (!c.profile || !c.model || seen.has(key)) return false;
      seen.add(key); state(c.profile); return true;
    });
  }
  const ready = c => (state(c.profile).cooldowns.get(c.model) || 0) <= cfg.now();
  const capacity = c => state(c.profile).running < Math.max(1, Math.floor(c.profile.concurrency) || 1);
  function currentCandidate(profile, chain) {
    const list = candidates(profile, chain);
    return list.find(ready) || list.sort((a, b) =>
      (state(a.profile).cooldowns.get(a.model) || 0) - (state(b.profile).cooldowns.get(b.model) || 0))[0];
  }
  const currentModel = profile => currentCandidate(profile)?.model;
  function settle(job, ok, value) {
    if (job.settled) return;
    job.settled = true; live.delete(job); job.unlink?.();
    if (ok) job.resolve(value); else job.reject(value);
  }
  function cancelJob(job) {
    if (job.settled) return;
    job.ctrl.abort(); settle(job, false, cancelledError()); pump();
  }
  function pump() {
    if (timer) { clearTimeout(timer); timer = null; }
    const pending = [...live].filter(j => !j.running && !j.settled).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    let earliest = Infinity;
    for (const job of pending) {
      const eligible=job.chain.filter(c=>!job.skipped.has(JSON.stringify([c.profile.id,c.model])));
      if(!eligible.length) {settle(job,false,job.contentError);continue;}
      const missing = eligible.map(c => state(c.profile).missing.get(c.model));
      if (missing.every(m => m && m.until > cfg.now())) {
        settle(job, false, missing[0].error); continue;
      }
      const candidate = eligible.find(ready);
      if (!candidate) {
        for (const c of eligible) if (capacity(c)) earliest = Math.min(earliest, state(c.profile).cooldowns.get(c.model) || 0);
        continue;
      }
      if (!capacity(candidate)) continue;
      const { profile, model } = candidate, s = state(profile);
      job.running = true; job.attempts++; s.running++;
      Promise.resolve().then(() => {
        if (job.ctrl.signal.aborted) throw cancelledError();
        return job.run({ profile, model, signal: job.ctrl.signal, attempt: job.attempts });
      }).then(value => { s.rates.delete(model); settle(job, true, value); }, error => {
        if (job.settled) return;
        if (isCancelled(error)) return settle(job, false, cancelledError());
        if (error?.code === ERR.CONFIG || error?.code === ERR.CONFIRMATION_REQUIRED) return settle(job, false, error);
        if(error?.serverCode==='untranslated_items'||error?.code===ERR.PARSE) {
          job.skipped.add(JSON.stringify([profile.id,model]));job.contentError=error;return;
        }
        const missingModel = error?.status === 404 && ['model_not_found', 'unknown_model'].includes(error.serverCode);
        if (Number.isInteger(error?.status) && ![429, 502, 503, 504].includes(error.status) && !missingModel) return settle(job, false, error);
        let wait = missingModel ? 30 * 60 * 1000 : cfg.cooldownMs;
        if (error?.code === ERR.RATE_LIMITED) {
          const streak = (s.rates.get(model) || 0) + 1; s.rates.set(model, streak);
          wait = Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs)
            : Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** (streak - 1));
        }
        s.cooldowns.set(model, Math.max(s.cooldowns.get(model) || 0, cfg.now() + wait));
        if (missingModel) s.missing.set(model, { until: cfg.now() + wait, error });
        if (job.attempts >= Math.max(cfg.maxAttempts, job.chain.length)) settle(job, false, error);
      }).finally(() => { job.running = false; s.running--; pump(); });
    }
    if (Number.isFinite(earliest)) timer = setTimeout(pump, Math.max(1, earliest - cfg.now()));
  }
  function enqueue({ profile, chain, priority = 1, reqId = null, signal = null, run }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(cancelledError());
      const list = candidates(profile, chain);
      if (!list.length) return reject(new Error(l10n('m19')));
      const job = { seq: ++seq, chain: list, priority, reqId, run, resolve, reject,
        attempts: 0, skipped:new Set(), ctrl: new AbortController(), settled: false, running: false };
      if (signal) {
        const abort = () => cancelJob(job); signal.addEventListener('abort', abort, { once: true });
        job.unlink = () => signal.removeEventListener('abort', abort);
      }
      live.add(job); pump();
    });
  }
  function cancel(reqId) { for (const j of [...live]) if (j.reqId === reqId) cancelJob(j); }
  function stats() {
    const out = {};
    for (const [id, s] of states) {
      const cooling = [...s.cooldowns.values()].filter(t => t > cfg.now());
      out[id] = { running: s.running, pending: [...live].filter(j => !j.running && j.chain.some(c => c.profile.id === id)).length,
        model: currentModel(s.profile), pausedForMs: ready({ profile: s.profile, model: currentModel(s.profile) }) ? 0
          : Math.max(0, Math.min(...cooling) - cfg.now()) };
    }
    return out;
  }
  return { enqueue, cancel, currentModel, currentCandidate, stats };
}

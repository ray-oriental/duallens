// Batched translation with bounded JSON retries and validated cache.
// Injected dependencies keep tests offline.

import { createTranslationStream } from '../shared/stream.js';
import { ERR, PRIORITY } from '../shared/protocol.js';
import { activeProfile, providerChain, getDefaultSettingsStore } from '../shared/settings.js';
import { buildMessages, parseSegments } from '../shared/prompt.js';
import { makeBatches, splitLongText, joinTranslations } from '../shared/batch.js';
import { escapeText, stripMarkup } from '../shared/markup.js';
import { sha256Hex } from '../shared/hash.js';
import { DLError, cancelledError, isCancelled, toErrorInfo } from '../shared/errors.js';
import { profileProblem } from './providers.js';
import { makeKeyer } from './cache.js';
import { createMT, mtChain, hasMarkers } from './mt.js';
import { refinementEligible } from '../shared/refinement.js';

const DAY_MS = 86400000;
const DEFAULT_TTL_DAYS = 30;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const MODES = Object.freeze(['mt', 'llm', 'mt+llm', 'auto']);
// Short interactive purposes default to machine translation; the page and documents get drafts + refinement.
const QUICK_PURPOSES = new Set(['selection', 'input', 'hover']);
export const AUTO_DRAFT_DELAY_MS = 2500;
export const REFINE_TIMEOUT_MS = 90000; // how long the LLM may take before the machine translation becomes the result

// -> { mode, llmFallback }: what a request runs, given the configured mode and LLM availability.
export function planFor(settings, req, llmUsable) {
  const explicit = MODES.includes(req.mode) ? req.mode : null;
  let mode = explicit || (MODES.includes(settings.translation?.mode) ? settings.translation.mode : 'mt+llm');
  let derived = false;
  if (mode !== 'llm' && !llmUsable) { mode = 'mt'; derived = true; }
  else if (!explicit && QUICK_PURPOSES.has(req.purpose) && (mode === 'mt+llm' || mode === 'auto')) { mode = 'mt'; derived = true; }
  return { mode, llmFallback: derived && llmUsable };
}

export function createTranslator({ provider, cache, queue, getSettings, getSecret = async id =>
  globalThis.chrome?.storage?.local ? getDefaultSettingsStore().getSecret(id) : '', sha = sha256Hex, retryBatchMax = 8,
  mt = createMT({ getSecret }), autoDelayMs = AUTO_DRAFT_DELAY_MS }) {
  // Shared by every mode: settings with the per-request provider choice applied, and the usable LLM chain.
  async function prepare(req) {
    let settings = await getSettings();
    if (req.profileId !== undefined || req.model !== undefined) {
      const selected = settings.provider.profiles.find(p => p.id === req.profileId);
      const model = req.model || selected?.model;
      if (!selected || typeof model !== 'string' || !model.trim() || model.length > 256) {
        throw new DLError(ERR.CONFIG, '服务或模型选择无效');
      }
      // Per-request choice, never overwrite the page's provider or persisted chain.
      // providerChain retains the explicit-only subscription safeguards.
      const rest = providerChain(settings).map(c => ({ profileId: c.profile.id, model: c.model }));
      settings = { ...settings, provider: { ...settings.provider, active: selected.id,
        chain: [{ profileId: selected.id, model }, ...rest] } };
    }
    const configured = providerChain(settings);
    const usable = await Promise.all(configured.map(async c => {
      const apiKey = c.profile.kind === 'openai' ? await getSecret(c.profile.id) || c.profile.apiKey || '' : '';
      return !profileProblem({ ...c.profile, model: c.model, apiKey }) && (!c.profile.requiresKey || !!apiKey);
    }));
    const chain = configured.filter((c, i) => usable[i]);
    const profile = chain[0]?.profile || activeProfile(settings);
    const items = (Array.isArray(req.items) ? req.items : []).filter((it) => it && it.id !== undefined);
    const to = req.to || settings.targetLang;
    const from = req.from || settings.sourceLang || 'auto';
    return { settings, chain, profile, items, to, from };
  }

  // The LLM stage (SPEC §7-8). onPartial(results) gets [{ id, text } | { id, error: { code, message } }], each id once.
  // onCacheChecked(Set<text>) fires once the cache has been consulted, with the source texts it answered.
  async function runLLM(req, ctx, { onPartial = () => {}, signal, onCacheChecked } = {}) {
    let announced = false;
    const cacheChecked = (hits = new Set()) => {
      if (announced) return;
      announced = true;
      try { onCacheChecked?.(hits); } catch { /* the hook must not break translation */ }
    };
    try {
      await runLLMStages(req, ctx, { onPartial, signal, cacheChecked });
    } finally { cacheChecked(); }
  }

  async function runLLMStages(req, { settings, chain, profile, items, to, from }, { onPartial, signal, cacheChecked }) {
    const omitted=(value,source,kind)=>{
      if(kind==='mock')return false;
      const original=stripMarkup(source),plain=stripMarkup(value);
      const hira=(plain.match(/[ぁ-ゟ]/g)||[]).length;
      return plain===original && (/[A-Za-z]/.test(original) || to!=='ja' && (/[ぁ-ゟ]/.test(original) || from==='ja' && /[ァ-ヿ]/.test(original))) ||
        /^zh/.test(to) && /[ぁ-ゟ]/.test(original) && hira>=4 && hira/((plain.match(/\p{L}/gu)||[]).length||1)>.2;
    };
    const priority = Number.isFinite(req.priority) ? req.priority : PRIORITY.NEAR;
    const reqId = req.reqId ?? null;
    const preset = settings.prompt.preset;
    const custom = preset === 'custom' ? settings.prompt.custom : '';
    const glossary = settings.glossary;

    const emitted = new Set();
    const emit = (results) => {
      const fresh = results.filter((r) => !emitted.has(r.id) && emitted.add(r.id));
      if (!fresh.length || (signal && signal.aborted)) return;
      try {
        onPartial(fresh);
      } catch {
        /* a failing consumer must not break translation */
      }
    };

    const problem = chain.length ? null : profileProblem(profile) || '没有可用的模型配置';
    if (problem) {
      cacheChecked();
      emit(items.map((it) => ({ id: it.id, error: { code: ERR.CONFIG, message: problem } })));
      return;
    }

    // Blank text has nothing to translate; identical texts are translated once and fanned out.
    const groups = new Map();
    for (const it of items) {
      if (typeof it.text !== 'string' || !it.text.trim()) {
        emit([{ id: it.id, text: typeof it.text === 'string' ? it.text : '' }]);
        continue;
      }
      let g = groups.get(it.text);
      if (!g) {
        g = { text: it.text, ids: [], state: 'open', pieces: [], out: [], left: 0, models: [], key: null };
        groups.set(it.text, g);
      }
      g.ids.push(it.id);
    }
    let pending = [...groups.values()];

    const cacheOn = !!cache && settings.cache && settings.cache.enabled !== false;
    const ttlDays = settings.cache && settings.cache.ttlDays != null ? settings.cache.ttlDays : DEFAULT_TTL_DAYS;
    const cacheOpts = { maxEntries: settings.cache && settings.cache.maxEntries, ttlMs: ttlDays > 0 ? ttlDays * DAY_MS : 0 };
    const keyers = new Map();
    const keyerFor = (model, usedProfile = profile) => {
      const id = JSON.stringify([usedProfile.id, model]);
      if (!keyers.has(id)) keyers.set(id, makeKeyer({ profileId: usedProfile.id, model, to, from, context:req.context||{}, preset, custom, glossary }, sha));
      return keyers.get(id);
    };

    if (cacheOn && pending.length) {
      try {
        const candidate = queue.currentCandidate(profile, chain);
        const keyOf = await keyerFor(candidate.model, candidate.profile);
        const keys = await Promise.all(pending.map((g) => keyOf(g.text)));
        const hits = await cache.getMany(keys, { ttlMs: cacheOpts.ttlMs });
        const hitResults = [];
        pending.forEach((g, i) => {
          const t = hits.get(keys[i]);
          if (t === undefined) return;
          g.state = 'done';
          for (const id of g.ids) hitResults.push({ id, text: t });
        });
        emit(hitResults);
      } catch {
        /* cache trouble is treated as a miss */
      }
      pending = pending.filter((g) => g.state === 'open');
    }
    cacheChecked(new Set([...groups.values()].filter((g) => g.state === 'done').map((g) => g.text)));
    if (!pending.length) return;

    const units = [];
    let uid = 0;
    for (const g of pending) {
      const budget = Math.min(...chain.map(c => c.profile.maxChars || 4000));
      g.pieces = splitLongText(g.text, priority === PRIORITY.VISIBLE && !units.length ? Math.min(2000, budget) : budget);
      g.out = new Array(g.pieces.length);
      g.left = g.pieces.length;
      g.pieces.forEach((text, idx) => units.push({ uid: ++uid, g, idx, text }));
    }

    const writes = [];
    async function flushWrites() {
      if (!cacheOn || !writes.length) return;
      const batch = writes.splice(0, writes.length);
      try {
        await cache.putMany(await Promise.all(batch), cacheOpts);
      } catch {
        /* a full or unavailable cache must not fail the translation */
      }
    }

    function failUnits(list, error) {
      for (const u of list) {
        const g = u.g;
        if (g.state !== 'open') continue;
        g.state = 'error';
        emit(g.ids.map((id) => ({ id, error })));
      }
    }

    function completeUnit(u, text, model, usedProfile = profile) {
      const g = u.g;
      if (g.state !== 'open' || u.completed) return;
      u.completed = true; u.rendered = text;
      g.out[u.idx] = text;
      g.models.push({ model, profile: usedProfile });
      if (--g.left > 0) return;
      g.state = 'done';
      const full = g.pieces.length === 1 ? text : joinTranslations(g.out);
      emit(g.ids.map((id) => ({ id, text: full })));
    }

    function cacheCompleted(g) {
      if (g.cached || g.state !== 'done' || !g.validated || g.validated.size !== g.pieces.length) return;
      g.cached = true;
      const full = g.pieces.length === 1 ? g.out[0] : joinTranslations(g.out);
      if (cacheOn && g.models.every((m) => m.model === g.models[0].model && m.profile.id === g.models[0].profile.id)) {
        const m = g.models[0];
        writes.push(keyerFor(m.model, m.profile).then(async (keyOf) => ({ k: await keyOf(g.text), t: full })));
      }
    }

    async function runBatch(batch, isRetry, budget={left:retryBatchMax}) {
      async function retryLost(lost) {
        if(batch.length>1 && budget.left>0) {
          const retries=[];
          for(const sub of chunk(lost,isRetry?1:Math.max(1,Math.ceil(lost.length/2)))) {
            if(budget.left-- >0) retries.push(runBatch(sub,true,budget));
            else failUnits(sub,{code:ERR.PARSE,message:'模型没有返回这一段的译文'});
          }
          await Promise.all(retries);
        } else failUnits(lost,{code:ERR.PROVIDER,message:'模型未返回可靠译文'});
      }
      const { messages, idMap } = buildMessages({
        items: batch.map((u) => ({ id: u.uid, text: u.text })),
        to,
        from,
        context: req.context,
        preset,
        custom,
        glossary,
      });
      let out;
      try {
        out = await queue.enqueue({
          profile,
          chain,
          priority,
          reqId,
          signal,
          run: async ({ profile: selected, model, signal: s }) => {
            const stream = createTranslationStream(batch.length, (index, text) => {
              const u = batch[index];
              if (req.streamItems === false) return;
              if (s.aborted || /^(zh|ja|ko|ar|ru|th)/.test(to) && omitted(text,u.text,selected.kind)) return;
              completeUnit(u, text, model, selected);
            });
            const content=await provider({profile:selected,model,messages,signal:s,onDelta: delta => stream.push(delta)});
            const parsed=parseSegments(content,idMap);
            if(parsed.invalidJSON) throw new DLError(ERR.PARSE,'模型返回了非 JSON 内容（可能是思考型模型）',{serverCode:'invalid_translation'});
            if (/^(zh|ja|ko|ar|ru|th)/.test(to)) {
              const unchanged=batch.filter(u=>omitted(parsed.results.get(u.uid),u.text,selected.kind));
              if(unchanged.length) {
                // Preserve neighbors only after whole-batch JSON validation.
                if(!parsed.missing.length) for(const u of batch) {
                  if(unchanged.includes(u)) continue;
                  const text=parsed.results.get(u.uid);
                  completeUnit(u,text,model,selected);
                  if(u.rendered===text) {(u.g.validated ||= new Set()).add(u.idx);cacheCompleted(u.g);}
                }
                throw new DLError(ERR.PROVIDER,'模型漏翻，尝试备用模型',{status:502,serverCode:'untranslated_items'});
              }
            }
            return {content,model,profile:selected};
          },
        });
      } catch (e) {
        if(e?.serverCode==='untranslated_items' && batch.length>1)return retryLost(batch.filter(u=>!u.completed));
        if (!isCancelled(e)) failUnits(batch, toErrorInfo(e));
        return;
      }
      const byUid = new Map(batch.map((u) => [u.uid, u]));
      const { results, missing } = parseSegments(out.content, idMap);
      for (const [id, text] of results) {
        const u = byUid.get(id);
        completeUnit(u, text, out.model, out.profile);
        // Only fully validated, matching results may be persisted. A failed stream
        // can display a prefix, but must never poison the cache on retry/fallback.
        if (u.rendered === text) { (u.g.validated ||= new Set()).add(u.idx); cacheCompleted(u.g); }
      }
      if (!missing.length) return;

      const lost = missing.map((id) => byUid.get(id));
      if (batch.length>1 && budget.left>0) {
        await retryLost(lost);
        return;
      }
      failUnits(lost, { code: ERR.PARSE, message: '模型没有返回这一段的译文' });
    }

    const batches = makeBatches(
      units.map((u) => ({ id: u.uid, text: u.text, unit: u })),
      { maxItems: Math.min(...chain.map(c => c.profile.maxItems || 20)), maxChars: Math.min(...chain.map(c => c.profile.maxChars || 4000)) },
    );
    if (priority === PRIORITY.VISIBLE && batches.length) {
      const first = batches.shift();
      const small = makeBatches(first, { maxItems: from==='ja' && /^zh/.test(to)?2:6, maxChars: 2000 });
      const head = small[0];
      batches.unshift(head, ...makeBatches(first.slice(head.length), { maxItems: Math.min(...chain.map(c => c.profile.maxItems || 20)), maxChars: Math.min(...chain.map(c => c.profile.maxChars || 4000)) }));
    }
    await Promise.all(
      batches.map(async (b) => {
        const list = b.map((x) => x.unit);
        try {
          await runBatch(list, false);
        } catch (e) {
          failUnits(list, toErrorInfo(e));
        }
        await flushWrites();
      }),
    );
    if (!(signal && signal.aborted)) {
      for (const g of pending) {
        if (g.state === 'open') failUnits(units.filter((u) => u.g === g), { code: ERR.PARSE, message: '译文不完整' });
      }
    }
    await flushWrites();
  }

  // ---- machine-translation stage ---------------------------------------------------------------

  function abortableSleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  // Answers each source text from the MT cache (under any engine of the chain) or from the engines.
  // onEach([{ text, result: { text, engine, plain } } | { text, error }]) fires as answers arrive.
  async function runMT(texts, { settings, to, from, signal, onEach }) {
    const mtSettings = settings.translation?.mt || {};
    const chainIds = mtChain(mtSettings);
    const cacheOn = !!cache && settings.cache && settings.cache.enabled !== false;
    const ttlDays = settings.cache && settings.cache.ttlDays != null ? settings.cache.ttlDays : DEFAULT_TTL_DAYS;
    const cacheOpts = { maxEntries: settings.cache && settings.cache.maxEntries, ttlMs: ttlDays > 0 ? ttlDays * DAY_MS : 0 };
    const keyOf = (engine, text) => sha(['mt', engine, from, to, text].join('\u001f'));
    const answered = new Set();
    if (cacheOn && texts.length) {
      try {
        const probes = await Promise.all(texts.flatMap(text => chainIds.map(async engine => ({ text, engine, key: await keyOf(engine, text) }))));
        const hits = await cache.getMany(probes.map(p => p.key), { ttlMs: cacheOpts.ttlMs });
        const found = [];
        for (const text of texts) {
          const hit = probes.find(p => p.text === text && hits.get(p.key) !== undefined);
          if (!hit) continue;
          const cached = hits.get(hit.key);
          answered.add(text);
          found.push({ text, result: { text: cached, engine: hit.engine, ...(hasMarkers(text) && !hasMarkers(cached) ? { plain: true } : {}) } });
        }
        if (found.length) onEach(found);
      } catch { /* cache trouble is treated as a miss */ }
    }
    const misses = texts.filter(t => !answered.has(t));
    if (!misses.length) return;
    const writes = [];
    await mt.translate({
      items: misses.map((text, id) => ({ id, text })), to, from, chain: chainIds, region: mtSettings.region || '', signal,
      onResults: (list) => {
        onEach(list.map(r => r.error ? { text: misses[r.id], error: r.error }
          : { text: misses[r.id], result: { text: r.text, engine: r.engine, ...(r.plain ? { plain: true } : {}) } }));
        if (!cacheOn) return;
        const ok = list.filter(r => !r.error);
        if (ok.length) {
          writes.push(Promise.all(ok.map(async r => ({ k: await keyOf(r.engine, misses[r.id]), t: r.text })))
            .then(entries => cache.putMany(entries, cacheOpts)).catch(() => {}));
        }
      },
    });
    await Promise.all(writes);
  }

  function deliverTo(onPartial, signal) {
    return (list) => {
      if (!list.length || (signal && signal.aborted)) return;
      try { onPartial(list); } catch { /* a failing consumer must not break translation */ }
    };
  }

  const finalMt = (id, d, extra = {}) => ({ id, text: d.text, stage: 'final', engine: d.engine, ...(d.plain ? { plain: true } : {}), ...extra });

  // Mode 'mt': machine translation only. If every engine failed and the mode was only implied by the
  // purpose (selection/hover/input) or by the absence of an LLM, a usable LLM chain takes over.
  async function translateMTOnly(req, ctx, plan, { onPartial, signal }) {
    const { settings, items, to, from } = ctx;
    const deliver = deliverTo(onPartial, signal);
    const byText = new Map();
    const blanks = [];
    for (const it of items) {
      if (typeof it.text !== 'string' || !it.text.trim()) blanks.push({ id: it.id, text: typeof it.text === 'string' ? it.text : '', stage: 'final' });
      else if (byText.has(it.text)) byText.get(it.text).push(it.id);
      else byText.set(it.text, [it.id]);
    }
    deliver(blanks);
    const failed = [];
    try {
      await runMT([...byText.keys()], { settings, to, from, signal, onEach: (entries) => {
        const out = [];
        for (const e of entries) for (const id of byText.get(e.text)) {
          if (e.error) failed.push({ id, error: e.error });
          else out.push(finalMt(id, e.result));
        }
        deliver(out);
      } });
    } catch (e) {
      if (!(isCancelled(e) || signal?.aborted)) throw e;
      return;
    }
    if (signal?.aborted || !failed.length) return;
    if (plan.llmFallback) {
      const ids = new Set(failed.map(f => f.id));
      await runLLM(req, { ...ctx, items: items.filter(it => ids.has(it.id)) },
        { signal, onPartial: (rs) => deliver(rs.map(r => (r.error ? r : { ...r, stage: 'final' }))) });
    } else deliver(failed.map(f => ({ id: f.id, error: f.error })));
  }

  // Modes 'mt+llm' and 'auto'. The LLM always runs; MT supplies drafts when the caller asked for them
  // (req.draft) and stands in for any item the LLM could not translate.
  async function translateDouble(req, ctx, plan, { onPartial, signal }) {
    const { settings, items, to, from } = ctx;
    const deliver = deliverTo(onPartial, signal);
    const finals = new Set();
    const drafts = new Map(); // id -> MT result
    const lost = new Map(); // id -> LLM error, waiting for MT to stand in
    const mtAsked = new Set();
    const mtFailed = new Set();
    const mtJobs = new Set();
    const textOf = new Map();
    const idsByText = new Map();
    for (const it of items) {
      if (typeof it.text !== 'string' || !it.text.trim()) continue;
      textOf.set(it.id, it.text);
      if (idsByText.has(it.text)) idsByText.get(it.text).push(it.id);
      else idsByText.set(it.text, [it.id]);
    }
    const wantDraft = req.draft === true;
    const mtCtrl = new AbortController();
    const llmCtrl = new AbortController(); // lets the refinement budget cut the LLM stage short
    const relay = () => { mtCtrl.abort(); llmCtrl.abort(); };
    if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
    const sleeping = new AbortController();
    const budgetMs = Number.isFinite(settings.translation?.refineTimeoutMs) ? settings.translation.refineTimeoutMs : REFINE_TIMEOUT_MS;

    function onMtAnswer(entries) {
      const out = [];
      for (const e of entries) for (const id of idsByText.get(e.text) || []) {
        if (finals.has(id)) continue;
        if (e.error) {
          mtFailed.add(id);
          if (lost.has(id)) { out.push({ id, error: lost.get(id) }); lost.delete(id); finals.add(id); }
          continue;
        }
        drafts.set(id, e.result);
        if (lost.has(id)) {
          lost.delete(id); finals.add(id);
          out.push(finalMt(id, e.result, { refined: false }));
        } else if (wantDraft) {
          out.push({ id, text: e.result.text, stage: 'draft', engine: e.result.engine, ...(e.result.plain ? { plain: true } : {}) });
        }
      }
      deliver(out);
    }

    function requestMT(ids) {
      const texts = new Set();
      for (const id of ids) {
        if (mtAsked.has(id) || !textOf.has(id)) continue;
        mtAsked.add(id);
        texts.add(textOf.get(id));
      }
      if (!texts.size) return;
      const job = runMT([...texts], { settings, to, from, signal: mtCtrl.signal, onEach: onMtAnswer })
        .catch((e) => {
          if (isCancelled(e) || mtCtrl.signal.aborted) return;
          onMtAnswer([...texts].map(text => ({ text, error: toErrorInfo(e) })));
        })
        .finally(() => mtJobs.delete(job));
      mtJobs.add(job);
    }

    function onLLM(results) {
      const out = [];
      for (const r of results) {
        if (finals.has(r.id)) continue;
        if (!r.error) { finals.add(r.id); out.push({ ...r, stage: 'final' }); continue; }
        if (drafts.has(r.id)) { finals.add(r.id); out.push(finalMt(r.id, drafts.get(r.id), { refined: false })); }
        else if (mtFailed.has(r.id)) { finals.add(r.id); out.push({ id: r.id, error: r.error }); }
        else { lost.set(r.id, r.error); requestMT([r.id]); }
      }
      deliver(out);
    }

    let announce;
    const cacheChecked = new Promise((resolve) => { announce = resolve; });
    const proactive = wantDraft ? (async () => {
      const hits = await cacheChecked;
      if (plan.mode === 'auto') await abortableSleep(autoDelayMs, sleeping.signal);
      if (sleeping.signal.aborted || mtCtrl.signal.aborted) return;
      requestMT(items.filter(it => textOf.has(it.id) && !finals.has(it.id) && !hits.has(textOf.get(it.id))).map(it => it.id));
    })() : Promise.resolve();

    // The LLM gets a bounded time. When it runs out, drafts become the result and the LLM work is cancelled;
    // callers that never asked for drafts get machine translation for whatever is still missing.
    const budget = setTimeout(() => {
      if (signal?.aborted) return;
      llmCtrl.abort();
      const out = [];
      const stalled = new Error('大模型响应超时');
      for (const id of textOf.keys()) {
        if (finals.has(id)) continue;
        if (drafts.has(id)) { finals.add(id); out.push(finalMt(id, drafts.get(id), { refined: false })); }
        else if (mtFailed.has(id)) { finals.add(id); out.push({ id, error: { code: ERR.NETWORK, message: stalled.message } }); }
        else if (!lost.has(id)) lost.set(id, { code: ERR.NETWORK, message: stalled.message });
      }
      deliver(out);
      requestMT([...lost.keys()]);
    }, budgetMs);

    try {
      await runLLM({...req,streamItems:req.purpose==='page'||req.purpose==='pdf'?false:req.streamItems}, ctx, { onPartial: onLLM, signal: llmCtrl.signal, onCacheChecked: announce });
      clearTimeout(budget);
      sleeping.abort();
      await proactive;
      // Anything the LLM could not do is waiting on MT; drafts nobody will use are dropped.
      if (!lost.size) mtCtrl.abort();
      while (mtJobs.size) await Promise.all([...mtJobs]);
    } finally {
      clearTimeout(budget);
      announce(new Set());
      sleeping.abort();
      mtCtrl.abort();
      llmCtrl.abort();
      signal?.removeEventListener('abort', relay);
    }
  }

  // The public entry point: one request, any mode. Results are reported through onPartial as
  // [{ id, text, stage?, engine?, plain?, refined? } | { id, error }]. Only requests with
  // `draft: true` ever receive stage 'draft'; everything else sees one terminal result per id.
  async function translate(req, { onPartial = () => {}, signal } = {}) {
    const ctx = await prepare(req);
    const plan = planFor(ctx.settings, req, ctx.chain.length > 0);
    if (plan.mode === 'llm') return runLLM(req, ctx, { onPartial, signal });
    if (plan.mode === 'mt') return translateMTOnly(req, ctx, plan, { onPartial, signal });
    if(req.purpose==='page'||req.purpose==='pdf') {
      const prose=ctx.items.filter(refinementEligible),quick=ctx.items.filter(it=>!refinementEligible(it));
      return Promise.all([
        quick.length&&translateMTOnly(req,{...ctx,items:quick},{...plan,llmFallback:false},{onPartial,signal}),
        prose.length&&translateDouble(req,{...ctx,items:prose},plan,{onPartial,signal}),
      ]);
    }
    return translateDouble(req, ctx, plan, { onPartial, signal });
  }

  // Plain-text translation for selection / input box / hover / side panel.
  // `mode` ('mt' | 'llm' | …) overrides the configured mode for this request only.
  async function translateTextEx({ text, to, from, profileId, model, purpose, mode }, { signal } = {}) {
    let result = null;
    await translate(
      { reqId: null, to, from, profileId, model, purpose: purpose || 'text', mode, streamItems: false, priority: PRIORITY.VISIBLE, context: {}, items: [{ id: 't', text: escapeText(text) }] },
      { onPartial: (r) => (result = r[0]), signal },
    );
    if (signal && signal.aborted) throw cancelledError();
    if (!result) throw new DLError(ERR.PROVIDER, '没有得到译文');
    if (result.error) throw new DLError(result.error.code, result.error.message);
    return { text: stripMarkup(result.text), by: result.engine ? 'mt' : 'llm', engine: result.engine };
  }

  // Returns the translated string.
  async function translateText(req, opts) {
    return (await translateTextEx(req, opts)).text;
  }

  return { translate, translateText, translateTextEx, mt };
}

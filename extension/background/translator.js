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

const DAY_MS = 86400000;
const DEFAULT_TTL_DAYS = 30;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createTranslator({ provider, cache, queue, getSettings, getSecret = async id =>
  globalThis.chrome?.storage?.local ? getDefaultSettingsStore().getSecret(id) : '', sha = sha256Hex, retryBatchMax = 8 }) {
  // req: { reqId, items: [{ id, text }], to, from, priority, context }
  // onPartial(results) gets [{ id, text } | { id, error: { code, message } }], each id at most once.
  // Resolves when everything has been reported; if `signal` aborts it resolves quietly and stops reporting.
  async function translate(req, { onPartial = () => {}, signal } = {}) {
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

  // Plain-text translation for selection / input box / hover. Returns the translated string.
  async function translateText({ text, to, from, profileId, model }, { signal } = {}) {
    let result = null;
    await translate(
      { reqId: null, to, from, profileId, model, streamItems: false, priority: PRIORITY.VISIBLE, context: {}, items: [{ id: 't', text: escapeText(text) }] },
      { onPartial: (r) => (result = r[0]), signal },
    );
    if (signal && signal.aborted) throw cancelledError();
    if (!result) throw new DLError(ERR.PROVIDER, '没有得到译文');
    if (result.error) throw new DLError(result.error.code, result.error.message);
    return stripMarkup(result.text);
  }

  return { translate, translateText };
}

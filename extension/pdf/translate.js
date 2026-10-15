// Translation state for PDF text blocks, independent of rendering and zoom.
//
// Requests go through platform.translator().translateBatch(req, onPartial). With `draft: true`
// the service may answer an id twice: a quick machine-translation draft (stage 'draft') and the
// model's final text (stage 'final', or no stage). The final answer always replaces the draft;
// a draft that arrives after the final one is ignored. Results are parsed with the shared
// placeholder parser: math islands travel as <xN/> atoms and model output never becomes markup.

import { parseMarkup, stripMarkup } from '../shared/markup.js';
import { looksLikeTarget } from '../shared/lang.js';
import { PRIORITY, ERR } from '../shared/protocol.js';

export const MAX_BATCH_ITEMS = 40;
const LETTERS = /\p{L}{2,}|[぀-ヿ㐀-鿿가-힯]/u;
const normalize = value => String(value).replace(/\s+/g, ' ').trim().toLowerCase();

// Standalone URLs, numbered URL footnotes and brace-grouped author mailboxes are
// identifiers, not prose. Leave their original pixels and do not send them at all.
export function identifierOnly(plain) {
  const text = String(plain).trim().replace(/^\d{1,3}[.)]?\s*(?=https?:\/\/|www\.)/i, '');
  if (/^(?:https?:\/\/\S+|www\.\S+)(?:\s+(?:\d{1,3}[.)]?\s+)?(?:https?:\/\/\S+|www\.\S+))*$/i.test(text)) return true;
  const mailbox = text.startsWith('{') ? text.replace(/\s+/g, '') : text;
  return /^(?:\{[\p{L}\p{N}_.+,\-]+\}|[\p{L}\p{N}_.+\-]+)@[\p{L}\p{N}.\-]+\.[a-z]{2,}$/iu.test(mailbox);
}

// Models sometimes damage atom markers ("<x0/" , "< x0 />", "<X0>"). Repair only the atom
// syntax; everything else still goes through the strict shared parser.
export function repairAtoms(text) {
  return String(text ?? '')
    .replace(/<\s*x\s*(\d{1,3})\s*\/?\s*>/gi, '<x$1/>')
    .replace(/<x(\d{1,3})\/(?!>)/gi, '<x$1/>')
    .replace(/<\/x\d{1,3}\s*>/gi, '');
}

// -> { nodes: [{ t:'text', v } | { t:'x', n }], complete: boolean, plain }
export function renderResult(text, atoms = 0) {
  const parsed = parseMarkup(repairAtoms(text), { maxG: 0, maxX: atoms });
  if (parsed.ok) {
    const nodes = parsed.nodes.filter(node => node.t === 'text' || node.t === 'x');
    const seen = new Set(nodes.filter(node => node.t === 'x').map(node => node.n));
    const plain = nodes.filter(node => node.t === 'text').map(node => node.v).join('');
    return { nodes, complete: seen.size === atoms, plain };
  }
  const plain = stripMarkup(repairAtoms(text)).replace(/<\/?[gx]\d*\s*\/?/gi, '');
  return { nodes: plain ? [{ t: 'text', v: plain }] : [], complete: atoms === 0, plain };
}

// Some providers return a formula's original literal (e.g. ×) instead of its
// marker. Recover only a unique, exact mathematical literal. Repeated formulas,
// bare names/numbers and missing/translated formulas remain errors, never guesses.
export function restoreLiteralAtoms(result, atoms) {
  if (result.complete) return result;
  const nodes = result.nodes.map(node => ({ ...node }));
  const seen = new Set(nodes.filter(node => node.t === 'x').map(node => node.n));
  for (let n = 0; n < atoms.length; n++) {
    if (seen.has(n)) continue;
    const literal = atoms[n].text;
    if (!literal || !/[=+−×÷∀-⋿⟀-⟯Ͱ-Ͽ_^]|\([^()]+\)/u.test(literal) ||
        atoms.filter(atom => atom.text === literal).length !== 1) continue;
    const matches = [];
    nodes.forEach((node, index) => {
      if (node.t !== 'text') return;
      let offset = 0, at;
      while ((at = node.v.indexOf(literal, offset)) !== -1) {
        matches.push({ index, at }); offset = at + literal.length;
      }
    });
    if (matches.length !== 1) continue;
    const { index, at } = matches[0], value = nodes[index].v;
    const replacement = [];
    if (at) replacement.push({ t: 'text', v: value.slice(0, at) });
    replacement.push({ t: 'x', n });
    if (at + literal.length < value.length) replacement.push({ t: 'text', v: value.slice(at + literal.length) });
    nodes.splice(index, 1, ...replacement); seen.add(n);
  }
  return { nodes, complete: seen.size === atoms.length, plain: nodes.filter(node => node.t === 'text').map(node => node.v).join('') };
}

function keepsOriginal(error, plain) {
  if (!/漏翻|untranslated/i.test(`${error?.message || ''} ${error?.serverCode || ''}`)) return false;
  // A short failed sentence or a paragraph containing a URL is still a failure.
  // Only standalone addresses and short title-cased personal names are kept quietly.
  return /^(?:https?:\/\/\S+|www\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+)$/i.test(plain.trim()) ||
    /^(?:\p{Lu}\p{Ll}+(?:[-’']\p{Lu}?\p{Ll}+)?)(?:\s+\p{Lu}\p{Ll}+(?:[-’']\p{Lu}?\p{Ll}+)?){1,3}$/u.test(plain.trim());
}

export class PdfTranslations {
  constructor({ service, getSettings, getContext = () => ({}), onUpdate = () => {} }) {
    this.service = service;
    this.getSettings = getSettings;
    this.getContext = getContext;
    this.onUpdate = onUpdate;
    this.entries = new Map();
    this.handles = new Map(); // handle -> entries of that request
    this.active = false;
    this.generation = 0;
  }

  start() { this.active = true; }

  // Cancels outstanding requests and forgets every translation (restore / settings change).
  stop() {
    this.active = false;
    this.generation++;
    for (const handle of this.handles.keys()) { try { handle.cancel(); } catch { /* already finished */ } }
    this.handles.clear();
    this.entries.clear();
  }

  // Cancels requests that have produced nothing yet and whose blocks are no longer wanted (the
  // reader moved far away). Their ids are forgotten so they are requested again when visible.
  release(keep) {
    const released = [];
    for (const [handle, chunk] of this.handles) {
      if (chunk.some(entry => keep(entry.id) || this.entries.get(entry.id) !== entry || entry.state !== 'pending')) continue;
      this.handles.delete(handle);
      try { handle.cancel(); } catch { /* already finished */ }
      for (const entry of chunk) { this.entries.delete(entry.id); released.push(entry.id); }
    }
    if (released.length) this.onUpdate(released);
    return released;
  }

  get(id) { return this.entries.get(id); }

  stats() {
    const out = { total: 0, done: 0, draft: 0, pending: 0, failed: 0, unrefined: 0 };
    for (const entry of this.entries.values()) {
      if (entry.state === 'skip') continue;
      out.total++;
      if (entry.state === 'final') { out.done++; if (entry.refined === false) out.unrefined++; }
      else if (entry.state === 'draft') out.draft++;
      else if (entry.state === 'pending') out.pending++;
      else if (entry.state === 'error') out.failed++;
    }
    return out;
  }

  // list: [{ id, source: { markup, plain, atoms } }]; already known ids are not requested again.
  request(list, priority = PRIORITY.NEAR) {
    if (!this.active) return 0;
    const settings = this.getSettings();
    const minChars = Math.max(1, Number(settings.minChars) || 2);
    const send = [];
    const skipped = [];
    for (const { id, source } of list) {
      if (this.entries.has(id)) continue;
      const entry = { id, source, state: 'pending', generation: this.generation };
      this.entries.set(id, entry);
      if (!source?.markup || source.plain.length < minChars || !LETTERS.test(source.plain) ||
          identifierOnly(source.plain) || looksLikeTarget(source.plain, settings.targetLang)) {
        entry.state = 'skip';
        skipped.push(id);
      } else send.push(entry);
    }
    if (skipped.length) this.onUpdate(skipped);
    this.#dispatch(send, priority);
    return send.length;
  }

  retry(id) {
    const entry = this.entries.get(id);
    if (!this.active || !entry || entry.state !== 'error') return false;
    entry.state = 'pending';
    delete entry.error;
    this.onUpdate([id]);
    this.#dispatch([entry], PRIORITY.VISIBLE);
    return true;
  }

  #dispatch(entries, priority) {
    if (!entries.length) return;
    const settings = this.getSettings();
    const generation = this.generation;
    for (let i = 0; i < entries.length; i += MAX_BATCH_ITEMS) {
      const chunk = entries.slice(i, i + MAX_BATCH_ITEMS);
      const req = {
        items: chunk.map(entry => ({ id: entry.id, text: entry.source.markup })),
        to: settings.targetLang, from: settings.sourceLang || 'auto', priority,
        context: this.getContext(), draft: true, purpose: 'pdf',
      };
      const attempt = Symbol('pdf-request');
      const expected = new Map(chunk.map(entry => { entry.attempt = attempt; return [entry.id, entry]; }));
      let handle, closed = false;
      const current = entry => !closed && generation === this.generation &&
        this.entries.get(entry.id) === entry && entry.attempt === attempt;
      const deliver = results => {
        this.#onResults((results || []).filter(result => {
          const entry = expected.get(result?.id);
          return entry && current(entry);
        }));
      };
      try {
        const raw = this.service.translateBatch(req, deliver);
        handle = { cancel() { closed = true; raw.cancel(); } };
        this.handles.set(handle, chunk);
        // `done` is an optional extension of the platform contract. Absence does not
        // mean that an asynchronous callback-only service has already finished.
        if (raw.done?.then) {
          const finish = () => {
            const unfinished = chunk.filter(entry => current(entry) && ['pending', 'draft'].includes(entry.state));
            deliver(unfinished.map(entry => ({ id: entry.id, error: { code: ERR.PARSE, message: '没有收到完整译文' } })));
            closed = true;
            this.handles.delete(handle);
          };
          void Promise.resolve(raw.done).then(finish, finish);
        }
      } catch (error) {
        deliver(chunk.map(entry => ({ id: entry.id, error: { code: ERR.NETWORK, message: String(error?.message || error) } })));
        closed = true;
      }
    }
  }

  #onResults(results) {
    const changed = [];
    const repair = [];
    for (const r of results || []) {
      const entry = this.entries.get(r?.id);
      if (!entry || entry.generation !== this.generation || entry.state === 'skip') continue;
      if (r.error) {
        if (entry.state === 'draft') { entry.state = 'final'; entry.refined = false; changed.push(entry.id); }
        else if (entry.state === 'pending' && keepsOriginal(r.error, entry.source.plain)) {
          // Names, addresses and identifiers that every model returns unchanged keep the original.
          Object.assign(entry, { state: 'final', same: true, nodes: [], text: entry.source.markup, complete: true });
          changed.push(entry.id);
        } else if (entry.state === 'pending') { entry.state = 'error'; entry.error = r.error; changed.push(entry.id); }
        continue;
      }
      const stage = r.stage === 'draft' ? 'draft' : 'final';
      if (stage === 'draft' && entry.state !== 'pending') continue;
      if (entry.state === 'error' && stage === 'draft') continue;
      const atoms = entry.source.atoms.length;
      if (stage === 'draft' && r.plain && atoms) continue;
      const result = restoreLiteralAtoms(renderResult(typeof r.text === 'string' ? r.text : '', atoms), entry.source.atoms);
      if (!result.complete || !result.plain.trim() && !result.nodes.some(node => node.t === 'x')) {
        if (stage === 'final') {
          if (entry.state === 'draft') { entry.state = 'final'; entry.refined = false; }
          else if (!result.complete && entry.state === 'pending' && !entry.atomRepair) {
            // One bounded single-block repair. A batched response may omit an atom;
            // never invent its position and never retry the entire neighbouring page.
            entry.atomRepair = true;
            repair.push(entry);
          }
          else if (entry.state !== 'final') {
            entry.state = 'error'; entry.error = { code: ERR.PARSE, message: !result.complete ? '译文缺少公式，保留原文' : '译文为空' };
          }
          changed.push(entry.id);
        }
        continue;
      }
      Object.assign(entry, { state: stage, text: r.text, nodes: result.nodes, complete: result.complete,
        refined: stage === 'final' ? r.refined !== false : undefined,
        same: normalize(r.text) === normalize(entry.source.markup) });
      changed.push(entry.id);
    }
    if (changed.length) this.onUpdate(changed);
    if (repair.length) this.#dispatch(repair.filter(entry => entry.state === 'pending'), PRIORITY.VISIBLE);
  }
}

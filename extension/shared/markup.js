// Inline-format placeholders, SPEC §6.
//   <gN>…</gN>  wraps a formatted/linked run (N = index into the unit's element table)
//   <xN/>       stands for an atomic node kept as-is
//   &amp; &lt; &gt;  are the only entities the page-side serializer produces.
// The parser never builds HTML: it returns a node tree and the caller creates DOM nodes itself.

export const MAX_DEPTH = 4;

const ENTITY_STRICT = { lt: '<', gt: '>', amp: '&' };
// Models sometimes escape a little more than asked; decode those to plain text too.
const ENTITY_LOOSE = { ...ENTITY_STRICT, quot: '"', apos: "'", '#39': "'", '#34': '"', nbsp: ' ' };

export function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function unescapeText(s) {
  return String(s).replace(/&(lt|gt|amp);/g, (_, n) => ENTITY_STRICT[n]);
}

// One pass over the string. Alternatives are ordered: exact markers first, then any other tag-like
// text (dropped), then comments, then a truncated marker at the very end, then entities.
function tokenize(str) {
  const re =
    /<g(\d+)>|<\/g(\d+)>|<x(\d+)\s*\/>|<\/?[A-Za-z][^<>]*>|<!--[\s\S]*?-->|<\/?[gx]\d*\s*\/?$|&(?:lt|gt|amp|quot|apos|nbsp|#39|#34);/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ k: 'text', v: str.slice(last, m.index) });
    const s = m[0];
    if (m[1] !== undefined) out.push({ k: 'open', n: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'close', n: Number(m[2]) });
    else if (m[3] !== undefined) out.push({ k: 'x', n: Number(m[3]) });
    else if (s[0] === '&') out.push({ k: 'ent', v: ENTITY_LOOSE[s.slice(1, -1)] });
    else out.push({ k: 'junk' });
    last = re.lastIndex;
    if (s.length === 0) re.lastIndex++; // cannot happen with these alternatives; guards against loops
  }
  if (last < str.length) out.push({ k: 'text', v: str.slice(last) });
  return out;
}

// Removes every marker and any other tag-like text, then unescapes. Used as the "fall back to
// plain text" path and for one-shot translations that carry no placeholders.
export function stripMarkup(str) {
  let s = '';
  for (const t of tokenize(String(str ?? ''))) {
    if (t.k === 'text' || t.k === 'ent') s += t.v;
  }
  return s;
}

// Drops empty groups (an empty link/format run would render nothing) and re-merges the text
// nodes that were left adjacent.
function prune(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'g') {
      n.children = prune(n.children);
      if (n.children.length === 0) continue;
    }
    const tail = out[out.length - 1];
    if (n.t === 'text' && tail && tail.t === 'text') tail.v += n.v;
    else out.push(n);
  }
  return out;
}

// -> { ok: true, nodes } | { ok: false, plain }
// nodes: Array<{t:'text',v} | {t:'g',n,children} | {t:'x',n}>
// Valid indexes are 0 <= N < maxG (resp. maxX). Anything structurally wrong yields ok:false.
export function parseMarkup(str, { maxG = Infinity, maxX = Infinity } = {}) {
  const input = String(str ?? '');
  const fail = () => ({ ok: false, plain: stripMarkup(input) });

  const root = [];
  const stack = [{ n: -1, children: root }];
  const seenX = new Set();
  const here = () => stack[stack.length - 1].children;
  const pushText = (v) => {
    if (!v) return;
    const arr = here();
    const tail = arr[arr.length - 1];
    if (tail && tail.t === 'text') tail.v += v;
    else arr.push({ t: 'text', v });
  };

  for (const tok of tokenize(input)) {
    switch (tok.k) {
      case 'text':
        // a half-formed marker in the middle of the text means the model garbled the structure
        if (/<\/?[gx]\d/.test(tok.v)) return fail();
        pushText(tok.v);
        break;
      case 'ent':
        pushText(tok.v);
        break;
      case 'junk':
        break;
      case 'open': {
        if (!Number.isSafeInteger(tok.n) || tok.n >= maxG) return fail();
        if (stack.length - 1 >= MAX_DEPTH) return fail();
        if (stack.some((f) => f.n === tok.n)) return fail();
        const node = { t: 'g', n: tok.n, children: [] };
        here().push(node);
        stack.push({ n: tok.n, children: node.children });
        break;
      }
      case 'close':
        if (stack.length === 1 || stack[stack.length - 1].n !== tok.n) return fail();
        stack.pop();
        break;
      case 'x':
        if (!Number.isSafeInteger(tok.n) || tok.n >= maxX) return fail();
        if (seenX.has(tok.n)) return fail();
        seenX.add(tok.n);
        here().push({ t: 'x', n: tok.n });
        break;
    }
  }
  if (stack.length !== 1) return fail();
  return { ok: true, nodes: prune(root) };
}

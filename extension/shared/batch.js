// Batching and long-text splitting, SPEC §7. Pure functions.

// Greedy, order-preserving. Size is counted on item text only. An item larger than maxChars gets
// a batch of its own (callers split long text with splitLongText first).
export function makeBatches(items, { maxItems = Infinity, maxChars = Infinity } = {}) {
  const itemCap = maxItems > 0 ? maxItems : Infinity;
  const charCap = maxChars > 0 ? maxChars : Infinity;
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const it of items) {
    const len = String(it.text ?? '').length;
    if (cur.length && (cur.length >= itemCap || chars + len > charCap)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += len;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const CJK_ENDERS = new Set('。！？；…'.split(''));
const ASCII_ENDERS = new Set('.!?;'.split(''));
const CLAUSE = new Set('，、：'.split(''));
const CLOSERS = new Set(`"'”’」』）)]】》〉`.split(''));
// Never start a chunk with these (line-break prohibition): sentence/clause punctuation, closing brackets.
const NO_BREAK_BEFORE = new Set('。！？；…，、：,”’」』）)]】》〉'.split(''));
const TAG_AT = /<\/?[A-Za-z][^<>]*>/y;
const ENT_AT = /&(?:[A-Za-z]+|#\d+);/y;

// Walks the text once and records, per cut position, whether a cut is legal (outside every tag,
// entity, surrogate pair and <gN>…</gN> group) and how good it is (sentence end > clause > space).
function analyze(s) {
  const n = s.length;
  const legal = new Uint8Array(n + 1);
  const sentence = new Uint8Array(n + 1);
  const rank = new Uint8Array(n + 1); // 2 after clause punctuation, 1 after whitespace
  let depth = 0;
  let endState = 0; // 1 after a CJK-style ender, 2 after an ASCII-style one
  let spaceSeen = false;
  let nlSeen = false;
  let prev = 'other'; // kind of the previous unit: 'space' | 'clause' | 'other'
  let i = 0;
  while (i < n) {
    let len = 1;
    let kind = 'char';
    let tagKind = '';
    const ch = s[i];
    if (ch === '<') {
      TAG_AT.lastIndex = i;
      const m = TAG_AT.exec(s);
      if (m) {
        len = m[0].length;
        kind = 'tag';
        if (/^<g\d+>$/.test(m[0])) tagKind = 'open';
        else if (/^<\/g\d+>$/.test(m[0])) tagKind = 'close';
      }
    } else if (ch === '&') {
      ENT_AT.lastIndex = i;
      const m = ENT_AT.exec(s);
      if (m) {
        len = m[0].length;
        kind = 'ent';
      }
    } else if (ch >= '\ud800' && ch <= '\udbff' && i + 1 < n) {
      len = 2;
    }

    const isSpace = kind === 'char' && /\s/.test(ch);
    const noBreak = kind === 'char' && NO_BREAK_BEFORE.has(ch);
    if (depth === 0 && !noBreak) {
      legal[i] = 1;
      if (i > 0 && !isSpace && !(kind === 'char' && CLOSERS.has(ch))) {
        rank[i] = prev === 'clause' ? 2 : prev === 'space' ? 1 : 0;
        if (nlSeen || endState === 1 || (endState === 2 && spaceSeen)) sentence[i] = 1;
      }
    }

    if (kind === 'tag' && tagKind === 'open') {
      depth++;
      endState = 0;
      spaceSeen = nlSeen = false;
      prev = 'other';
    } else if (kind === 'tag' && tagKind === 'close') {
      depth = Math.max(0, depth - 1);
      prev = 'other'; // keeps endState so "<g0>Hi.</g0> Next" still ends a sentence
    } else if (isSpace) {
      spaceSeen = true;
      if (ch === '\n') nlSeen = true;
      prev = 'space';
    } else if (kind === 'char' && CJK_ENDERS.has(ch)) {
      endState = 1;
      spaceSeen = nlSeen = false;
      prev = 'other';
    } else if (kind === 'char' && ASCII_ENDERS.has(ch)) {
      endState = 2;
      spaceSeen = nlSeen = false;
      prev = 'other';
    } else if (kind === 'char' && CLOSERS.has(ch)) {
      prev = 'other'; // closing quote/bracket stays attached to the sentence it closes
    } else {
      endState = 0;
      spaceSeen = nlSeen = false;
      prev = kind === 'char' && CLAUSE.has(ch) ? 'clause' : 'other';
    }
    i += len;
  }
  legal[n] = 1;
  return { legal, sentence, rank };
}

// Splits at sentence ends (中英文), never inside a tag or a <gN>…</gN> group. Lossless:
// chunks.join('') === text. A single unbreakable sentence/group may exceed maxChars.
export function splitLongText(text, maxChars) {
  const s = String(text ?? '');
  if (!(maxChars > 0) || s.length <= maxChars) return [s];
  const { legal, sentence, rank } = analyze(s);

  const bounds = [0];
  for (let p = 1; p < s.length; p++) if (sentence[p]) bounds.push(p);
  bounds.push(s.length);

  const chunks = [];
  let cur = '';
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = '';
  };
  for (let b = 0; b + 1 < bounds.length; b++) {
    const a = bounds[b];
    const e = bounds[b + 1];
    if (e - a > maxChars) {
      flush();
      const pieces = hardSplit(a, e, maxChars, legal, rank).map((r) => s.slice(r[0], r[1]));
      cur = pieces.pop();
      for (const piece of pieces) chunks.push(piece);
    } else if (cur.length + (e - a) > maxChars) {
      flush();
      cur = s.slice(a, e);
    } else {
      cur += s.slice(a, e);
    }
  }
  flush();
  return chunks;
}

// Cuts [a, e) into pieces of at most maxChars where the legal cut points allow it.
function hardSplit(a, e, maxChars, legal, rank) {
  const out = [];
  let pos = a;
  const floorLen = Math.floor(maxChars / 2);
  while (e - pos > maxChars) {
    const limit = pos + maxChars;
    let best = -1;
    let bestRank = -1;
    for (let p = limit; p >= pos + floorLen && p > pos; p--) {
      if (legal[p] && rank[p] > bestRank) {
        best = p;
        bestRank = rank[p];
        if (bestRank === 2) break;
      }
    }
    if (best < 0) {
      for (let p = pos + floorLen - 1; p > pos; p--) {
        if (legal[p]) {
          best = p;
          break;
        }
      }
    }
    if (best < 0) {
      // inside one oversized group: the next legal cut is past the limit
      for (let p = limit + 1; p < e; p++) {
        if (legal[p]) {
          best = p;
          break;
        }
      }
    }
    if (best < 0) break;
    out.push([pos, best]);
    pos = best;
  }
  out.push([pos, e]);
  return out;
}

const CJK_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;

// Re-assembles translated chunks. Original inter-chunk whitespace is not preserved, so add a
// space only between two non-CJK neighbours.
export function joinTranslations(parts) {
  let out = '';
  for (const raw of parts) {
    const part = String(raw ?? '');
    if (!out) {
      out = part;
      continue;
    }
    const left = out[out.length - 1];
    const right = part[0] ?? '';
    const glue = /\s/.test(left) || /\s/.test(right) || CJK_CHAR.test(left) || CJK_CHAR.test(right) ? '' : ' ';
    out += glue + part;
  }
  return out;
}

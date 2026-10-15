// PDF text-layer segmentation into positioned blocks. Pure functions, no DOM access.
//
// Input: pdf.js TextContent items in PDF user space (y grows upwards) plus the page view box.
// Output: blocks whose geometry is in unscaled page units measured from the page's top-left
// corner, so multiplying by the viewport scale gives CSS pixels. Complex layouts (rotated or RTL
// text, tables without rules, vertical writing) are isolated conservatively, never reconstructed.
//
// Block kinds:
//   text    natural language to translate (paragraph, heading, list item, caption, toc entry, cell)
//   math    display formula or mathematical line, kept as the original rendering
//   label   numbers, symbols, leader dots, figure annotations: kept as the original rendering
//   margin  running header/footer/page number: kept as the original rendering
//   other   rotated or RTL text: kept as the original rendering
// Only `text` blocks are covered by a translation. Inline formulas inside them are `math` parts
// with their page rectangles, so the renderer can reuse the original pixels instead of text.

const WORD = /\p{L}{2,}/u;
const WORDS = /\p{L}{2,}/gu;
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u;
const MATH_SYMBOL = /[=+−×÷∀-⋿⟀-⟯Ͱ-Ͽ_^]/u;
const STRONG_OP = /[=<>≤≥±×÷∀-⋿⟀-⟯←-⇿Ͱ-Ͽ^_]/u;
const FUNCTION_NAME = /^(?:sin|cos|tan|cot|sec|csc|log|ln|exp|lim|det|dim|ker|span|rank|mod|max|min|sup|inf|arg|gcd)$/i;
// A list marker or section number at the start of a block stays in the original rendering.
const LIST_LABEL = /^(?:[•◦▪●‣∙·∗*–—-]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\((?:[ivx]{1,4}|[a-zA-Z])\))\s+(?=\S)/u;
const SECTION_LABEL = /^(?:\d{1,2}(?:\.\d{1,3})+\.?|\d{1,2}\.?|[A-Z](?:\.\d{1,2})+\.?)\s+(?=\p{Lu})/u;
const LEADER = /\s*(?:(?:\.\s?){3,}|…+|(?:·\s?){3,})[\s.]*\d*\s*$/u;
const PAGE_LABEL = /^\s*(?:page\s+)?(?:\d+|[ivxlc]+)(?:\s*(?:\/|of)\s*\d+)?\s*$/i;
const NUMBERING = /^[\s\d.,:;()[\]–—…·*-]*$|^\s*\(?[ivxlcIVXLC]{1,6}[.)]?\s*$/u;
const CAPTION = /^(?:figure|fig\.|table|tab\.|algorithm|listing|图|表)\s*[\dA-Z]/iu;
const JOIN_GAP = 1.2; // horizontal gap, in font heights, that still joins spans into one line

// Rough advance widths in em; the viewer passes a canvas measurer instead.
export function estimateWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    if (ch === ' ') width += .25;
    else if (/[.,:;'!|il·]/.test(ch)) width += .28;
    else if (/[fjrt()[\]{}\-]/.test(ch)) width += .35;
    else if (/[mwMW]/.test(ch)) width += .82;
    else if (/[A-Z]/.test(ch)) width += .68;
    else if (/[⺀-鿿가-힯＀-￯]/.test(ch)) width += 1;
    else width += .5;
  }
  return width;
}

export function formulaLine(text) {
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  const prose = words.filter(word => !FUNCTION_NAME.test(word));
  const tokens = text.match(/[A-Za-z]|[Ͱ-Ͽ]|\d+|[=+−×÷∀-⋿_^]/gu) || [];
  return (!prose.length && tokens.length > 0) ||
    (prose.length <= 1 && tokens.length >= 5 && MATH_SYMBOL.test(text));
}

// Inline formulas typed in the body font: an expression needs a relation/operator symbol (or
// function application such as f(x)); plain numbers, citations and single letters stay prose.
export function inlineMath(text) {
  const ranges = [];
  // Operands are single letters (optionally indexed: x1, x_1, x_i), known function names, numbers
  // and Greek letters; any other word ends the expression.
  const token = /(?<![A-Za-z0-9_])(?:sin|cos|tan|cot|sec|csc|log|ln|exp|lim|det|dim|ker|max|min|sup|inf|arg|gcd)(?![A-Za-z])|(?<![A-Za-z0-9_])[A-Za-z](?:_?\d+|_[A-Za-z])?(?![A-Za-z0-9])|(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9])|[Ͱ-Ͽ⁰-₟]+|[=<>+−±×÷∀-⋿⟀-⟯←-⇿^_*/|]+|[()[\]{}]/gu;
  let run = null;
  const close = () => {
    if (!run) return;
    const value = text.slice(run.start, run.end);
    const words = (value.match(/[A-Za-z]{2,}/g) || []).filter(word => !FUNCTION_NAME.test(word));
    const call = /\b[A-Za-z]\([^()]{1,16}\)/.test(value);
    if ((STRONG_OP.test(value) || call) && !words.length && /[A-Za-z0-9Ͱ-Ͽ]/.test(value)) {
      ranges.push({ start: run.start, end: run.end });
    }
    run = null;
  };
  for (const match of text.matchAll(token)) {
    const end = match.index + match[0].length;
    if (run && /^[ \t]*$/.test(text.slice(run.end, match.index))) run.end = end;
    else { close(); run = { start: match.index, end }; }
  }
  close();
  // Trim brackets that only belong to surrounding prose, e.g. "(see x = 1)".
  return ranges.map(range => {
    let { start, end } = range;
    while (end > start && /[([{]/.test(text[end - 1])) end--;
    while (start < end && /[)\]}]/.test(text[start])) start++;
    return { start, end };
  }).filter(range => range.end > range.start);
}

export function mathParts(text, scripts = []) {
  const parts = [];
  let offset = 0;
  for (const range of inlineMath(text)) {
    if (range.start > offset) parts.push({ type: 'text', text: text.slice(offset, range.start) });
    parts.push(mathPart(text, range.start, range.end, scripts));
    offset = range.end;
  }
  if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) });
  return parts;
}

function mathPart(text, start, end, scripts = []) {
  const part = { type: 'math', text: text.slice(start, end) };
  const ranges = scripts.filter(range => range.start >= start && range.end <= end);
  if (ranges.length) {
    part.runs = [];
    let offset = start;
    for (const range of ranges) {
      if (range.start > offset) part.runs.push({ text: text.slice(offset, range.start) });
      part.runs.push({ text: text.slice(range.start, range.end), script: range.script });
      offset = range.end;
    }
    if (offset < end) part.runs.push({ text: text.slice(offset, end) });
  }
  return part;
}

const union = (a, b) => a ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

function fragments(items, view, styles) {
  const [x0, , , y1] = view;
  const upright = [], isolated = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) ||
        !Number.isFinite(item.width) || item.width < 0) continue;
    const size = Math.hypot(t[2], t[3]) || Math.abs(item.height) || Math.hypot(t[0], t[1]);
    if (!Number.isFinite(size) || size <= 0) continue;
    const style = styles?.[item.fontName] || {};
    const ascent = Number(style.ascent) >= .5 && Number(style.ascent) <= 1.1 ? Number(style.ascent) : .8;
    const descent = Number(style.descent) <= 0 && Number(style.descent) >= -.5 ? Number(style.descent) : -.2;
    const baseline = y1 - t[5], left = t[4] - x0;
    const frag = { text: item.str.replace(/\s+/g, ' '), font: String(item.fontName || ''), size, baseline, left,
      right: left + item.width, top: baseline - ascent * size, bottom: baseline - descent * size };
    const straight = Math.abs(t[1]) <= size * .01 && Math.abs(t[2]) <= size * .01 && t[0] > 0 && t[3] > 0;
    (straight && item.dir !== 'rtl' ? upright : isolated).push(frag);
  }
  return { upright, isolated };
}

function dominantSize(frags) {
  const sizes = new Map();
  for (const f of frags) {
    const key = Math.round(f.size * 4) / 4;
    sizes.set(key, (sizes.get(key) || 0) + f.text.trim().length);
  }
  return [...sizes].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

// Fonts used almost only for one- to three-character runs without words are math fonts
// (TeX italic variables, symbol and script fonts). The body font is the font with most text.
function fontRoles(frags) {
  const fonts = new Map();
  for (const f of frags) {
    const n = f.text.replace(/\s/g, '').length;
    let s = fonts.get(f.font);
    if (!s) fonts.set(f.font, s = { chars: 0, items: 0, short: 0 });
    s.chars += n; s.items++;
    if (n <= 3 && !WORD.test(f.text) && !CJK.test(f.text)) s.short++;
  }
  let body = '', most = -1;
  for (const [font, s] of fonts) if (s.chars > most) { most = s.chars; body = font; }
  const math = new Set();
  for (const [font, s] of fonts) if (font !== body && s.short / s.items >= .75) math.add(font);
  return { body, math };
}

function groupLines(frags) {
  frags.sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const lines = [];
  for (const f of frags) {
    let target = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 16; i--) {
      const line = lines[i];
      const h = Math.max(f.size, line.size);
      const gap = Math.max(f.left - line.right, line.left - f.right, 0);
      const same = Math.abs(f.baseline - line.baseline) <= Math.min(f.size, line.size) * .35;
      const smallText = f.size < line.size ? f.text : line.frags.map(x => x.text).join('');
      const script = smallText.trim().length <= 8 && !WORD.test(smallText) &&
        Math.min(f.size, line.size) < h * .85 && Math.abs(f.baseline - line.baseline) <= h * .8;
      if ((same || script) && gap <= h * JOIN_GAP) { target = line; break; }
    }
    if (target) {
      target.frags.push(f);
      target.left = Math.min(target.left, f.left); target.right = Math.max(target.right, f.right);
      if (f.size > target.size) { target.size = f.size; target.baseline = f.baseline; }
    } else lines.push({ frags: [f], left: f.left, right: f.right, size: f.size, baseline: f.baseline });
  }
  // A raised glyph may arrive before its baseline, whose later spans were too far away to join.
  const attached = new Set();
  for (const line of lines) {
    const label = line.frags.map(f => f.text).join('').trim();
    if (label.length > 8 || WORD.test(label)) continue;
    const target = lines.filter(other => other !== line && !attached.has(other) && line.size < other.size * .85 &&
      Math.abs(line.baseline - other.baseline) <= other.size * .8 &&
      Math.max(line.left - other.right, other.left - line.right, 0) <= other.size)
      .sort((a, b) => Math.abs(a.baseline - line.baseline) - Math.abs(b.baseline - line.baseline))[0];
    if (target) {
      target.frags.push(...line.frags); attached.add(line);
      target.left = Math.min(target.left, line.left); target.right = Math.max(target.right, line.right);
    }
  }
  return lines.filter(line => !attached.has(line));
}

function assembleLine(line, roles) {
  line.frags.sort((a, b) => a.left - b.left);
  let text = '', previous;
  const pieces = [];
  let box = null;
  for (const f of line.frags) {
    const gap = previous ? f.left - previous.right : 0;
    if (previous && gap > line.size * .12 && !/\s$/.test(text) && !/^\s|^[,.;:!?)\]}]/.test(f.text) &&
        !/[([{]$/.test(text)) text += ' ';
    const script = f.size < line.size * .85 && Math.abs(f.baseline - line.baseline) > line.size * .1
      ? (f.baseline < line.baseline ? 'sup' : 'sub') : null;
    const math = roles.math.has(f.font) && !WORD.test(f.text) && !CJK.test(f.text);
    pieces.push({ start: text.length, end: text.length + f.text.length, frag: f, script, math });
    text += f.text;
    box = union(box, f);
    previous = f;
  }
  const lead = text.length - text.trimStart().length;
  line.text = text.trim();
  for (const piece of pieces) {
    piece.start = Math.max(0, piece.start - lead);
    piece.end = Math.min(line.text.length, Math.max(piece.start, piece.end - lead));
  }
  line.pieces = pieces;
  Object.assign(line, { top: box.top, bottom: box.bottom });
  const fonts = new Map();
  for (const p of pieces) if (!p.math && !p.script) fonts.set(p.frag.font, (fonts.get(p.frag.font) || 0) + p.frag.text.length);
  line.font = [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0] || line.frags[0].font;
  line.math = pieces.every(p => p.math || p.script || !/[\p{L}\p{N}]/u.test(p.frag.text)) || formulaLine(line.text);
  line.leader = LEADER.test(line.text) && /\p{L}/u.test(line.text);
}

// Horizontal position of a character offset, interpolated inside a span by advance widths.
export function offsetX(line, offset, measure = estimateWidth) {
  for (const piece of line.pieces) {
    if (offset <= piece.start) return piece.frag.left;
    if (offset < piece.end) {
      const content = line.text.slice(piece.start, piece.end);
      const total = measure(content) || 1;
      return piece.frag.left + (piece.frag.right - piece.frag.left) * Math.min(1, measure(content.slice(0, offset - piece.start)) / total);
    }
  }
  return line.right;
}

function markRows(lines, pageWidth) {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  let row = [];
  const flush = () => {
    if (row.length > 1) {
      row.sort((a, b) => a.left - b.left);
      if (row.length >= 3) for (const line of row) if (line.right - line.left < pageWidth * .3) line.cell = true;
      const last = row.at(-1), before = row.at(-2);
      if (PAGE_LABEL.test(last.text) && last.left - before.right > before.size * 2 && WORD.test(before.text)) {
        before.toc = true; last.pageRef = true;
      }
    }
    row = [];
  };
  for (const line of sorted) {
    if (row.length && Math.abs(line.baseline - row[0].baseline) > Math.min(line.size, row[0].size) * .5) flush();
    row.push(line);
  }
  flush();
}

function canJoin(block, line, measure) {
  const last = block.lines.at(-1);
  const h = Math.max(block.size, line.size);
  if (line.math || line.cell || line.toc || line.leader || last.toc || last.leader || last.cell) return false;
  if (Math.abs(line.size - block.size) > h * .15) return false;
  const pitch = line.baseline - last.baseline;
  const maxPitch = block.pitch ? block.pitch * 1.3 + h * .1 : h * 1.75;
  if (pitch < h * .6 || pitch > maxPitch) return false;
  const overlap = Math.min(block.right, line.right) - Math.max(block.left, line.left);
  if (overlap < Math.min(block.right - block.left, line.right - line.left) * .5) return false;
  if (LIST_LABEL.test(line.text) || /^\d{1,2}(?:\.\d{1,3})+\.?\s+\p{Lu}/u.test(line.text)) return false;
  const first = block.lines[0];
  if (block.lines.length === 1) {
    const shift = line.left - first.left;
    if (shift > h * .8 && !block.list) return false; // only a list item continues with a hanging indent
    if (shift < -h * 4) return false;
  } else if (Math.abs(line.left - block.bodyLeft) > h * .8) return false;
  // The previous line stopped early although the next word would have fitted: paragraph end.
  if (!/[-‐­]$/.test(last.text)) {
    const right = Math.max(block.bodyRight, line.right);
    const word = (line.text.match(/^\S+/) || [''])[0];
    if (right - last.right > measure(word) * line.size + h * .6) return false;
  }
  return true;
}

function buildBlocks(lines, measure) {
  const ordered = [...lines].sort((a, b) => a.top - b.top || a.left - b.left);
  const blocks = [], open = [];
  for (const line of ordered) {
    let target = null, best = Infinity;
    for (const block of open) {
      if (!block.textual || !canJoin(block, line, measure)) continue;
      const distance = line.baseline - block.lines.at(-1).baseline;
      if (distance < best) { best = distance; target = block; }
    }
    if (target) {
      const last = target.lines.at(-1);
      const pitch = line.baseline - last.baseline;
      target.pitch = target.lines.length === 1 ? pitch : (target.pitch * (target.lines.length - 1) + pitch) / target.lines.length;
      target.lines.push(line);
      target.left = Math.min(target.left, line.left); target.right = Math.max(target.right, line.right);
      target.bodyLeft = target.lines.length === 2 ? line.left : Math.min(target.bodyLeft, line.left);
      target.bodyRight = Math.max(target.bodyRight, line.right);
    } else {
      const block = { lines: [line], left: line.left, right: line.right, size: line.size, pitch: 0,
        bodyLeft: line.left, bodyRight: line.right, textual: !line.math && !line.cell,
        list: LIST_LABEL.test(line.text) };
      blocks.push(block); open.push(block);
    }
    for (let i = open.length - 1; i >= 0; i--) {
      const last = open[i].lines.at(-1);
      if (line.top - last.bottom > open[i].size * 4) open.splice(i, 1);
    }
  }
  return blocks;
}

// Text for one line range, split into prose and math parts with page rectangles for math.
function lineParts(line, start, end, measure, nextLine = '') {
  const parts = [];
  const pushText = text => {
    if (!text) return;
    const tail = parts.at(-1);
    if (tail?.type === 'text') tail.text += text; else parts.push({ type: 'text', text });
  };
  let island = null;
  const flush = () => {
    if (!island) return;
    const text = line.text.slice(island.start, island.end);
    parts.push({ type: 'math', text, runs: island.runs.length > 1 || island.runs[0]?.script ? island.runs : undefined,
      rect: island.rect, baseline: line.baseline, size: line.size });
    island = null;
  };
  const addMath = (from, to, rectangle, script) => {
    const text = line.text.slice(from, to);
    if (island && /^[\s,]*$/.test(line.text.slice(island.end, from))) {
      const gap = line.text.slice(island.end, from);
      if (gap) island.runs.push({ text: gap });
      island.end = to; island.rect = union(island.rect, rectangle);
    } else { flush(); island = { start: from, end: to, rect: rect(rectangle), runs: [] }; }
    const tail = island.runs.at(-1);
    if (tail && !tail.script && !script) tail.text += text; else island.runs.push(script ? { text, script } : { text });
  };
  let cursor = start;
  for (const piece of line.pieces) {
    const from = Math.max(piece.start, start), to = Math.min(piece.end, end);
    if (to <= from) continue;
    const gap = line.text.slice(cursor, from);
    // In prose, "8× deeper" means "eight times deeper", rather than a math
    // island. Keeping only the × in an atom invites a correct translation to
    // replace it with a word and lose the marker. Real products (8×x, 8×sin(x))
    // and scripts still remain opaque.
    const remainder = line.text.slice(to);
    const following = /^\s*([A-Za-z]{2,})/.exec(remainder.trim() ? remainder : nextLine);
    const proseMultiplier = /^×$/.test(line.text.slice(from, to).trim()) && /\d\s*$/.test(line.text.slice(0, from)) &&
      following && !FUNCTION_NAME.test(following[1]);
    if (piece.math && !proseMultiplier || piece.script) {
      if (!(island && /^[\s,]*$/.test(gap))) { flush(); pushText(gap); }
      addMath(from, to, piece.frag, piece.script);
    } else {
      const content = line.text.slice(from, to);
      const ranges = inlineMath(content);
      if (island && /^[\s,]*$/.test(gap) && /^[\s,]*$/.test(content)) { cursor = to; continue; }
      flush(); pushText(gap);
      let offset = 0;
      for (const range of ranges) {
        pushText(content.slice(offset, range.start));
        const left = offsetX(line, from + range.start, measure), right = offsetX(line, from + range.end, measure);
        flush();
        island = { start: from + range.start, end: from + range.end, runs: [{ text: content.slice(range.start, range.end) }],
          rect: { left, right, top: piece.frag.top, bottom: piece.frag.bottom } };
        flush();
        offset = range.end;
      }
      pushText(content.slice(offset));
    }
    cursor = to;
  }
  flush();
  pushText(line.text.slice(cursor, end));
  return parts;
}

// A formula line as one math part whose runs keep raised/lowered glyphs (for reflow text).
function scriptRuns(line) {
  const runs = [];
  const push = run => {
    if (!run.text) return;
    const tail = runs.at(-1);
    if (tail && !tail.script && !run.script) tail.text += run.text; else runs.push(run);
  };
  let cursor = 0;
  for (const piece of line.pieces) {
    if (piece.start > cursor) push({ text: line.text.slice(cursor, piece.start) });
    const text = line.text.slice(piece.start, piece.end);
    push(piece.script ? { text, script: piece.script } : { text });
    cursor = Math.max(cursor, piece.end);
  }
  push({ text: line.text.slice(cursor) });
  return { type: 'math', text: line.text, runs: runs.some(run => run.script) ? runs : undefined };
}

function joinParts(target, parts) {
  for (const part of parts) {
    const tail = target.at(-1);
    if (part.type === 'text' && tail?.type === 'text') tail.text += part.text;
    else target.push(part.type === 'text' ? { ...part } : part);
  }
}

function describe(block, ctx) {
  const { measure, pageHeight: H, bodySize } = ctx;
  const lines = block.lines;
  const text = lines.map(line => line.text).join(' ');
  let box = null;
  for (const line of lines) box = union(box, line);
  const size = dominantSize(lines.flatMap(line => line.frags));
  let kind = 'text';
  // Running headers/footers sit in the outer bands and are not larger than body text (titles are).
  if (H && lines.length <= 2 && (box.bottom < H * .075 || box.top > H * .935) && size <= bodySize * 1.05) kind = 'margin';
  else if (H && PAGE_LABEL.test(text) && (box.top < H * .12 || box.bottom > H * .88)) kind = 'margin';
  else if (NUMBERING.test(text)) kind = 'label';
  else if (lines.every(line => line.math)) kind = 'math';
  else if (!WORD.test(text) && !CJK.test(text)) kind = 'label';
  else if (lines.every(line => line.pageRef)) kind = 'label';
  else if (lines.length === 1 && size < bodySize * .8 && (text.match(WORDS) || []).length <= 3 && !CJK.test(text)) kind = 'label';
  const fonts = new Map();
  for (const line of lines) fonts.set(line.font, (fonts.get(line.font) || 0) + line.text.length);
  const font = [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const result = { kind, text, box, size, font, pitch: block.pitch || 0,
    lines: lines.map(line => ({ left: line.left, top: line.top, right: line.right, bottom: line.bottom, baseline: line.baseline, size: line.size, text: line.text })) };
  if (kind === 'math') result.parts = lines.map(scriptRuns);
  if (kind !== 'text') return result;

  // Keep the list/section label and dot leaders in the original rendering.
  const first = lines[0], last = lines.at(-1);
  const labelMatch = first.text.match(SECTION_LABEL) || first.text.match(LIST_LABEL);
  let label = labelMatch && first.text.length > labelMatch[0].length ? labelMatch[0] : '';
  const leaderMatch = last.text.match(LEADER);
  const leader = leaderMatch && (lines.length > 1 || leaderMatch.index > label.length) ? leaderMatch : null;
  const parts = [], cover = [];
  lines.forEach((line, i) => {
    const start = i === 0 ? label.length : 0;
    const end = i === lines.length - 1 && leader ? leader.index : line.text.length;
    if (end <= start) return;
    if (parts.length) {
      const tail = parts.at(-1);
      if (tail.type === 'text' && /\p{Ll}-$/u.test(tail.text) && /^\p{Ll}/u.test(line.text.slice(start)) && !/[/]\S*-$/.test(tail.text)) tail.text = tail.text.slice(0, -1);
      else if (!(tail.type === 'text' && /[-‐]$/.test(tail.text))) joinParts(parts, [{ type: 'text', text: ' ' }]);
    }
    joinParts(parts, lineParts(line, start, end, measure, lines[i + 1]?.text || ''));
    const left = start ? offsetX(line, start, measure) : line.left;
    const right = end < line.text.length ? offsetX(line, end, measure) : line.right;
    cover.push({ left, right, top: line.top, bottom: line.bottom });
  });
  for (const part of parts) if (part.type === 'text') part.text = part.text.replace(/\s+/g, ' ');
  if (parts[0]?.type === 'text') parts[0].text = parts[0].text.trimStart();
  if (parts.at(-1)?.type === 'text') parts.at(-1).text = parts.at(-1).text.trimEnd();
  const content = parts.filter(part => part.text);
  if (!content.some(part => part.type === 'text' && (WORD.test(part.text) || CJK.test(part.text)))) {
    return { ...result, kind: 'label' };
  }
  let textBox = null;
  for (const r of cover) textBox = union(textBox, r);
  const role = lines.some(line => line.toc || line.leader) ? 'toc' : lines.every(line => line.cell) ? 'cell' :
    CAPTION.test(text) ? 'caption' : size >= bodySize * 1.12 && lines.length <= 3 ? 'heading' :
      block.list || (label && LIST_LABEL.test(first.text)) ? 'list' : 'paragraph';
  const full = Math.max(...lines.map(line => line.right));
  const justified = lines.length > 2 && lines.slice(0, -1).every(line => full - line.right < size * .6);
  return { ...result, role, label, leader: leader ? leader[0].trim() : '', parts: content, cover,
    textBox: { ...textBox, indent: Math.max(0, cover[0].left - textBox.left) }, align: justified ? 'justify' : 'start' };
}

// Columns: blocks that cross the middle of the text area split the page into bands. Inside a
// band, the left column is read before the right one.
function readingOrder(blocks) {
  const text = blocks.filter(block => block.kind === 'text' || block.kind === 'math');
  if (!text.length) return blocks.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const left = Math.min(...text.map(block => block.box.left)), right = Math.max(...text.map(block => block.box.right));
  const middle = (left + right) / 2, slack = (right - left) * .02;
  const spanning = block => block.box.left < middle - slack && block.box.right > middle + slack;
  const sorted = [...blocks].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const out = [];
  let band = [];
  const flush = () => {
    const leftColumn = band.filter(block => (block.box.left + block.box.right) / 2 < middle);
    out.push(...leftColumn, ...band.filter(block => !leftColumn.includes(block)));
    band = [];
  };
  for (const block of sorted) {
    if (spanning(block)) { flush(); out.push(block); } else band.push(block);
  }
  flush();
  return out;
}

// Free horizontal space a one-line block may grow into: its column, minus neighbours on its row.
function room(blocks) {
  const solid = blocks.filter(block => block.kind !== 'other');
  for (const block of blocks) {
    if (block.kind !== 'text' || block.lines.length !== 1 || block.role === 'toc') continue;
    const { top, bottom } = block.box;
    const column = solid.filter(other => other !== block && other.kind === 'text' &&
      other.box.left < block.box.right && other.box.right > block.box.left);
    let left = Math.min(block.textBox.left, ...column.map(other => other.box.left));
    let right = Math.max(block.textBox.right, ...column.map(other => other.box.right));
    const gap = block.size * .5;
    for (const other of solid) {
      if (other === block || other.box.bottom <= top + 1 || other.box.top >= bottom - 1) continue;
      if (other.box.left >= block.box.right - 1) right = Math.min(right, other.box.left - gap);
      else if (other.box.right <= block.box.left + 1) left = Math.max(left, other.box.right + gap);
    }
    block.textBox.room = { left: Math.min(left, block.textBox.left), right: Math.max(right, block.textBox.right) };
  }
}

function centered(blocks, textual, pageWidth, bodySize) {
  const left = Math.min(...textual.map(block => block.box.left)), right = Math.max(...textual.map(block => block.box.right));
  for (const block of textual) {
    if (block.lines.length !== 1 || block.role === 'toc') continue;
    const middle = (block.box.left + block.box.right) / 2;
    const inset = (block.box.left - left > bodySize * 2 && right - block.box.right > bodySize * 2) ||
      (block.box.left > pageWidth * .2 && block.box.right < pageWidth * .8);
    if (Math.abs(middle - pageWidth / 2) < pageWidth * .015 && inset) { block.align = 'center'; continue; }
    const container = blocks.find(other => other !== block && other.kind === 'text' && other.lines.length > 1 &&
      other.box.left <= block.box.left + 1 && other.box.right >= block.box.right - 1 &&
      Math.abs(other.box.top - block.box.top) < block.size * 40);
    if (container && block.box.left - container.box.left > block.size * 2 &&
        Math.abs(middle - (container.box.left + container.box.right) / 2) < block.size * .8) block.align = 'center';
  }
}

// -> { blocks, bodySize }. Blocks are in reading order; `id` is the stable index on this page.
export function segmentPage(items = [], { view, pageWidth = 0, pageHeight = 0, styles = {}, measure = estimateWidth } = {}) {
  const box = Array.isArray(view) && view.length === 4 && view.every(Number.isFinite) ? view : [0, 0, pageWidth, pageHeight];
  const width = box[2] - box[0], height = box[3] - box[1];
  const { upright, isolated } = fragments(Array.isArray(items) ? items : [], box, styles);
  const roles = fontRoles(upright);
  const bodySize = dominantSize(upright.filter(f => f.font === roles.body)) || dominantSize(upright);
  const lines = groupLines(upright);
  for (const line of lines) assembleLine(line, roles);
  markRows(lines, width);
  const ctx = { measure, pageHeight: height, bodySize };
  const blocks = buildBlocks(lines, measure).map(block => ({ ...describe(block, ctx), list: block.list }));
  for (const f of isolated) {
    const text = f.text.trim();
    const r = { left: f.left, top: f.top, right: f.right, bottom: f.bottom };
    blocks.push({ kind: 'other', text, box: r, size: f.size, pitch: 0, lines: [{ ...r, baseline: f.baseline, size: f.size, text }] });
  }
  const textual = blocks.filter(block => block.kind === 'text');
  if (textual.length) centered(blocks, textual, width, bodySize);
  room(blocks);
  const ordered = readingOrder(blocks);
  ordered.forEach((block, index) => { block.id = index; delete block.list; });
  return { blocks: ordered, bodySize, width, height };
}

// Placeholder source for one text block: prose is escaped, math parts become <xN/> atoms.
export function blockSource(block, escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) {
  let markup = '', plain = '';
  const atoms = [];
  for (const part of block.parts || []) {
    plain += part.text;
    if (part.type === 'math') { markup += `<x${atoms.length}/>`; atoms.push(part); } else markup += escape(part.text);
  }
  return { markup: markup.trim(), plain: plain.replace(/\s+/g, ' ').trim(), atoms };
}

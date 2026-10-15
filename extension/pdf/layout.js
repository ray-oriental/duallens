// Layout helpers for the translated PDF page. Pure functions, no DOM access.
//
// Text fitting works in "em" units: every token width is measured once at a 1 px font size,
// so finding the largest font size whose greedy line breaking fits the original block is cheap
// arithmetic (no forced layout per candidate size).

const CJK_CHAR = /[⺀-⿟　-ヿ㄀-ㄯ㆐-ㇿ㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]/u;
// Kinsoku: these never start a line, and opening brackets never end one.
const NO_START = /^[、。，．：；！？）」』】〉》〕…‥ー～”’,.;:!?)\]}%]$/u;
const NO_END = /^[（「『【〈《〔“‘([{]$/u;

// items: [{ text } | { atom: true, em }]; measure(text) -> width in em at font size 1.
// -> tokens [{ w, glue }]: glue tokens are breakable spaces that vanish at line ends.
export function tokenize(items, measure) {
  const tokens = [];
  let open = null; // an opening bracket waits for the next token
  const push = (w, text = '') => {
    const tail = tokens.at(-1);
    if (open !== null) { w += open; open = null; }
    if (text && NO_START.test(text) && tail && !tail.glue) { tail.w += w; return; }
    tokens.push({ w });
  };
  for (const item of items) {
    if (item.atom) { push(Math.max(0, Number(item.em) || 0)); continue; }
    for (const piece of String(item.text || '').match(/\s+|[^\s]/gu) || []) {
      if (/^\s+$/.test(piece)) { tokens.push({ w: measure(' '), glue: true }); continue; }
      const tail = tokens.at(-1);
      if (NO_END.test(piece)) {
        // Inside a Latin word ("f(x)") the bracket is part of the word.
        if (tail && !tail.glue && tail.latin && open === null) tail.w += measure(piece);
        else open = (open || 0) + measure(piece);
        continue;
      }
      // Latin letters and digits join the previous Latin token into one unbreakable word.
      if (!CJK_CHAR.test(piece) && tail && !tail.glue && tail.latin && open === null && !NO_START.test(piece)) {
        tail.w += measure(piece); continue;
      }
      push(measure(piece), piece);
      if (!CJK_CHAR.test(piece) && !NO_START.test(piece)) tokens.at(-1).latin = true;
    }
  }
  if (open !== null) tokens.push({ w: open });
  return tokens;
}

// Greedy line count for widths in em (already divided by the font size).
export function countLines(tokens, first, rest = first) {
  let lines = 1, x = 0, limit = Math.max(first, 1e-6), glue = 0;
  for (const token of tokens) {
    if (token.glue) { if (x > 0) glue += token.w; continue; }
    if (x > 0 && x + glue + token.w > limit) { lines++; x = 0; glue = 0; limit = Math.max(rest, 1e-6); }
    if (x === 0 && token.w > limit) {
      // overflow-wrap:anywhere splits a word longer than the line.
      const full = Math.floor(token.w / limit);
      lines += full; x = token.w - full * limit;
      if (x <= 1e-9) { lines--; x = limit; }
      limit = Math.max(rest, 1e-6);
      continue;
    }
    x += glue + token.w; glue = 0;
  }
  return lines;
}

// Largest font size (px) whose text fits the block. Height model: the first line needs `lead`
// font sizes and every further line one line pitch: (n - 1) * pitch + lead * size <= height.
// -> { size, lines, lineHeight (px), overflow, height (px needed) }
export function fitBlock(tokens, { width, height, indent = 0, maxSize, minSize, pitch = 0, lead = 1, slack = 1.08 }) {
  const pitchAt = size => pitch > 0 ? Math.max(pitch * size / maxSize, size * 1.12) : size * 1.2;
  const limit = height * slack + .5;
  const measure = size => {
    const lines = countLines(tokens, Math.max(width - indent, width * .2) / size, width / size);
    return { lines, need: (lines - 1) * pitchAt(size) + size * lead };
  };
  const result = size => {
    const { lines, need } = measure(size);
    return { size, lines, lineHeight: pitchAt(size), height: need, overflow: need > limit };
  };
  const top = Math.max(minSize, maxSize);
  if (measure(top).need <= limit) return result(top);
  if (measure(minSize).need > limit) return result(minSize);
  let low = minSize, high = top;
  for (let i = 0; i < 14 && high - low > .05; i++) {
    const middle = (low + high) / 2;
    if (measure(middle).need <= limit) low = middle; else high = middle;
  }
  return result(low);
}

const quantize = (r, g, b) => (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// image: { data: RGBA bytes, width, height } in device pixels; rects in page units.
// -> { background: [r,g,b], foreground: [r,g,b] }
export function sampleColors(image, rects, scale) {
  const samples = [];
  const counts = new Map();
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.left * scale)), x1 = Math.min(image.width, Math.ceil(r.right * scale));
    const y0 = Math.max(0, Math.floor(r.top * scale)), y1 = Math.min(image.height, Math.ceil(r.bottom * scale));
    if (x1 <= x0 || y1 <= y0) continue;
    const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 900)));
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * image.width + x) * 4;
        if (image.data[i + 3] < 8) continue;
        const color = [image.data[i], image.data[i + 1], image.data[i + 2]];
        samples.push(color);
        const key = quantize(...color);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  if (!samples.length) return { background: [255, 255, 255], foreground: [0, 0, 0] };
  const mode = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const average = list => [0, 1, 2].map(c => Math.round(list.reduce((sum, color) => sum + color[c], 0) / list.length));
  const background = average(samples.filter(color => quantize(...color) === mode));
  const ranked = samples.map(color => [distance(color, background), color]).filter(([d]) => d > 48).sort((a, b) => b[0] - a[0]);
  // The most distant tenth are glyph cores; anti-aliased edges would wash the colour out.
  let foreground = ranked.length ? average(ranked.slice(0, Math.max(1, Math.ceil(ranked.length * .1))).map(([, color]) => color)) : null;
  if (!foreground || distance(foreground, background) < 80) {
    const light = background[0] * .299 + background[1] * .587 + background[2] * .114 > 140;
    foreground = light ? [20, 20, 20] : [250, 250, 250];
  }
  return { background, foreground };
}

export const cssColor = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

// Font descriptors may reserve large blank descenders for a tiny math glyph.
// Tighten its local raster crop so those blank pixels do not enlarge the CSS line box.
// Coordinates are device pixels; keep a one-pixel antialiasing margin.
export function inkBounds(image, background, tolerance = 24) {
  let left = image.width, top = image.height, right = 0, bottom = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    if (image.data[i + 3] < 8 || distance([image.data[i], image.data[i + 1], image.data[i + 2]], background) <= tolerance) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right > left && bottom > top
    ? { left: Math.max(0, left - 1), top: Math.max(0, top - 1), right: Math.min(image.width, right + 1), bottom: Math.min(image.height, bottom + 1) }
    : null;
}

// Geometry and font size for one translated block at `scale` CSS px per page unit.
// items: tokenize() input (text runs and math atoms in em of the translated font size).
// metrics: ascent/descent of the translation font in em (canvas fontBoundingBox*), used to put
// the first translated baseline on the original first baseline.
export function planBlock(block, items, { scale, measure, maxRatio = 1, minRatio = .6, minPx = 9,
  metrics = { ascent: 1.06, descent: .26 } }) {
  const box = block.textBox;
  let left = box.left * scale;
  let width = Math.max(1, (box.right - box.left) * scale);
  const original = block.size * scale;
  const maxSize = original * maxRatio;
  const minSize = Math.min(maxSize, Math.max(original * minRatio, Math.min(original * .85, minPx)));
  const tokens = tokenize(items, measure);
  // A single line may grow into free space beside it before its font is reduced.
  if (block.lines.length === 1 && box.room) {
    const natural = tokens.reduce((sum, token) => sum + token.w, 0) * maxSize + 2;
    if (natural > width) {
      const center = (box.left + box.right) / 2;
      const span = block.align === 'center'
        ? 2 * Math.min(center - box.room.left, box.room.right - center) : box.room.right - box.left;
      const grown = Math.min(natural, Math.max(width, span * scale));
      if (block.align === 'center') left = center * scale - grown / 2;
      width = grown;
    }
  }
  const baseline = block.lines[0].baseline * scale;
  const below = Math.max(1, box.bottom * scale - baseline);
  const pitch = block.lines.length > 1 && block.pitch > 0 ? block.pitch * scale : 0;
  const indent = (box.indent || 0) * scale;
  // CJK ink reaches about .12 em below the baseline.
  const fit = fitBlock(tokens, { width, height: below, indent, maxSize, minSize, pitch, lead: .12 });
  const top = baseline - (fit.lineHeight - (metrics.ascent + metrics.descent) * fit.size) / 2 - metrics.ascent * fit.size;
  return { left, top, width, height: (box.bottom - box.top) * scale, indent, size: fit.size, lineHeight: fit.lineHeight,
    lines: fit.lines, overflow: fit.overflow, needed: fit.height, align: block.align || 'start' };
}

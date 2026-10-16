import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, countLines, fitBlock, planBlock, sampleColors, cssColor, inkBounds } from '../../extension/pdf/layout.js';

// 1 em per CJK character, .5 em per Latin character, .25 em per space.
const measure = text => [...text].reduce((sum, ch) => sum + (ch === ' ' ? .25 : /[　-鿿＀-￯]/.test(ch) ? 1 : .5), 0);
const widths = tokens => tokens.map(t => (t.glue ? '_' : '') + t.w);

test('PDF layout tokens: CJK characters break anywhere, Latin words and atoms stay whole', () => {
  assert.deepEqual(widths(tokenize([{ text: '切线 tangent' }], measure)), ['1', '1', '_0.25', '3.5']);
  // Closing punctuation never starts a line; an opening bracket never ends one.
  assert.deepEqual(widths(tokenize([{ text: '直线，（例如' }], measure)), ['1', '2', '2', '1']);
  assert.deepEqual(widths(tokenize([{ text: '点' }, { atom: true, em: .7 }, { text: '。' }], measure)), ['1', '1.7']);
  assert.deepEqual(widths(tokenize([{ text: 'f(x),' }], measure)), ['2.5']);
});

test('PDF layout greedy line count, first-line indent and overlong words', () => {
  const tokens = tokenize([{ text: '一二三四五六七八九十' }], measure);
  assert.equal(countLines(tokens, 10), 1);
  assert.equal(countLines(tokens, 4), 3);
  assert.equal(countLines(tokens, 2, 4), 3, 'narrow first line (indent)');
  assert.equal(countLines(tokenize([{ text: 'a b' }], measure), 0.6), 2, 'glue vanishes at the break');
  assert.equal(countLines(tokenize([{ text: 'x'.repeat(20) }], measure), 4), 3, 'overflow-wrap:anywhere');
  assert.equal(countLines([], 5), 1);
});

test('PDF layout keeps the original size when the translation fits and shrinks only as needed', () => {
  const short = tokenize([{ text: '切线问题' }], measure);
  assert.deepEqual(fitBlock(short, { width: 100, height: 10, maxSize: 10, minSize: 6 }), { size: 10, lines: 1, lineHeight: 12, height: 10, overflow: false });
  const long = tokenize([{ text: '一'.repeat(30) }], measure);
  const fit = fitBlock(long, { width: 100, height: 22, maxSize: 10, minSize: 5, pitch: 12 });
  assert.ok(fit.size < 10 && fit.size >= 5, String(fit.size));
  assert.ok(fit.height <= 22 * 1.08 + .5 && !fit.overflow);
  const huge = fitBlock(tokenize([{ text: '一'.repeat(300) }], measure), { width: 100, height: 22, maxSize: 10, minSize: 8, pitch: 12 });
  assert.equal(huge.size, 8);
  assert.ok(huge.overflow && huge.height > 22, 'reports the grown height when the minimum size still overflows');
});

test('PDF layout plans translated block geometry from page units', () => {
  const block = { size: 10, pitch: 12, align: 'justify', lines: [{ baseline: 108 }, { baseline: 120 }],
    textBox: { left: 50, top: 100, right: 250, bottom: 122, indent: 12 } };
  const plan = planBlock(block, [{ text: '对于圆来说这是成立的。' }], { scale: 2, measure });
  assert.equal(plan.left, 100);
  assert.equal(plan.width, 400);
  assert.equal(plan.indent, 24);
  assert.equal(plan.size, 20);
  assert.equal(plan.lineHeight, 24);
  // First translated baseline sits on the original first baseline (216 px): 216 - (24 - 26.4) / 2 - 21.2.
  assert.ok(Math.abs(plan.top - 196) < 1e-9, String(plan.top));
  assert.equal(plan.align, 'justify');
  const tight = planBlock({ ...block, lines: [{ baseline: 108 }], pitch: 0 }, [{ text: '一'.repeat(60) }], { scale: 1, measure, minPx: 9 });
  assert.ok(tight.size >= 8.5 && tight.size <= 10, 'readable minimum');
});

test('PDF layout lets a single line grow into free space before shrinking', () => {
  const line = { size: 10, pitch: 0, align: 'center', lines: [{ baseline: 108 }],
    textBox: { left: 100, top: 100, right: 140, bottom: 110, indent: 0, room: { left: 40, right: 240 } } };
  const plan = planBlock(line, [{ text: '二〇二六年秋季' }], { scale: 1, measure });
  assert.equal(plan.size, 10, 'keeps the original size');
  assert.equal(plan.lines, 1);
  assert.equal(plan.width, 72);
  assert.equal(plan.left, 120 - 36, 'stays centred');
  const start = planBlock({ ...line, align: 'start' }, [{ text: '一'.repeat(30) }], { scale: 1, measure });
  assert.equal(start.left, 100);
  assert.equal(start.width, 140, 'bounded by the free space on the right');
});

function image(width, height, background, glyph, glyphRect) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= glyphRect[0] && x < glyphRect[2] && y >= glyphRect[1] && y < glyphRect[3] && (x + y) % 3 === 0;
    const [r, g, b] = inside ? glyph : background;
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

test('PDF layout samples background and text colours from the original rendering', () => {
  const plain = sampleColors(image(40, 20, [255, 255, 255], [0, 0, 0], [5, 5, 35, 15]), [{ left: 0, top: 0, right: 20, bottom: 10 }], 2);
  assert.deepEqual(plain, { background: [255, 255, 255], foreground: [0, 0, 0] });
  const header = sampleColors(image(40, 20, [0, 100, 0], [255, 255, 255], [5, 5, 35, 15]), [{ left: 0, top: 0, right: 40, bottom: 20 }], 1);
  assert.deepEqual(header, { background: [0, 100, 0], foreground: [255, 255, 255] });
  const blue = sampleColors(image(40, 20, [255, 255, 255], [20, 20, 230], [5, 5, 35, 15]), [{ left: 0, top: 0, right: 40, bottom: 20 }], 1);
  assert.deepEqual(blue.foreground, [20, 20, 230]);
  // Blank or out-of-range regions fall back to readable defaults.
  assert.deepEqual(sampleColors(image(10, 10, [250, 250, 250], [0, 0, 0], [0, 0, 0, 0]), [{ left: 0, top: 0, right: 10, bottom: 10 }], 1).foreground, [20, 20, 20]);
  assert.deepEqual(sampleColors(image(10, 10, [30, 30, 30], [0, 0, 0], [0, 0, 0, 0]), [{ left: 0, top: 0, right: 10, bottom: 10 }], 1).foreground, [250, 250, 250]);
  assert.deepEqual(sampleColors(image(10, 10, [0, 0, 0], [0, 0, 0], [0, 0, 0, 0]), [{ left: 50, top: 50, right: 60, bottom: 60 }], 1), { background: [255, 255, 255], foreground: [0, 0, 0] });
  assert.equal(cssColor([1, 2, 3]), 'rgb(1, 2, 3)');
});

test('PDF math raster crops remove descriptor whitespace and retain glyph pixels with a margin', () => {
  const glyph = image(12, 24, [255, 255, 255], [0, 0, 0], [2, 4, 9, 12]);
  assert.deepEqual(inkBounds(glyph, [255, 255, 255]), { left: 1, top: 3, right: 10, bottom: 13 });
  const dark = image(12, 24, [10, 40, 10], [255, 255, 255], [2, 4, 9, 12]);
  assert.deepEqual(inkBounds(dark, [10, 40, 10]), { left: 1, top: 3, right: 10, bottom: 13 });
  assert.equal(inkBounds(image(5, 5, [255, 255, 255], [0, 0, 0], [0, 0, 0, 0]), [255, 255, 255]), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentPage, formulaLine, mathParts, inlineMath, blockSource, offsetX } from '../../extension/pdf/segments.js';

// Synthetic pdf.js text items (PDF user space, y up). Page is US Letter unless stated otherwise.
const H = 792, W = 612;
const item = (str, x = 72, y = 700, width = 260, height = 10, extra = {}) =>
  ({ str, transform: [height, 0, 0, height, x, y], width, height, fontName: 'body', ...extra });
const math = (str, x, y, width, height = 10) => item(str, x, y, width, height, { fontName: 'mathit' });
const page = (items, options = {}) => segmentPage(items, { pageWidth: W, pageHeight: H, ...options }).blocks;
const texts = blocks => blocks.filter(b => b.kind === 'text').map(b => b.text);
// Long body-font prose so the body font/size are unambiguous.
const filler = (y, x = 72, width = 468) => item('This is ordinary body text that fills an entire line of the column.', x, y, width);

test('PDF spans on one baseline and adjacent lines form one block in top-down page units', () => {
  const input = [item('Hello', 72, 700, 28), item('world, this first line is full.', 104, 700, 436), item('A second line follows here.', 72, 688, 120)];
  const before = structuredClone(input);
  const [block] = page(input);
  assert.equal(block.kind, 'text');
  assert.equal(block.text, 'Hello world, this first line is full. A second line follows here.');
  assert.equal(block.lines.length, 2);
  assert.deepEqual(input, before, 'input items are not mutated');
  // Default ascent .8 / descent -.2: first baseline 92 from the top.
  assert.equal(block.box.top, H - 700 - 8);
  assert.equal(block.box.bottom, H - 688 + 2);
  assert.equal(block.box.left, 72);
  assert.equal(blockSource(block).markup, 'Hello world, this first line is full. A second line follows here.');
});

test('PDF linguistic multipliers remain prose while mathematical products keep opaque atoms', () => {
  const multiplier = after => page([item('They use networks 8', 72, 700, 90), math('×', 162, 700, 6),
    item(after, 169, 700, 140)]).find(block => block.kind === 'text');
  const prose = blockSource(multiplier('deeper than earlier methods.'));
  assert.equal(prose.atoms.length, 0);
  assert.match(prose.markup, /8×\s*deeper/);
  const formula = blockSource(multiplier('sin(x) in this expression.'));
  assert.ok(formula.atoms.some(atom => atom.text.includes('×')), 'a function product is still mathematical');
  const wrapped = page([item('They use networks 8', 72, 700, 350), math('×', 422, 700, 6),
    item('deeper than earlier methods.', 72, 688, 180)]).find(block => block.kind === 'text');
  assert.equal(wrapped.lines.length, 2);
  assert.equal(blockSource(wrapped).atoms.length, 0, 'the prose word may start on the next line of the same paragraph');
});

test('PDF line pitch over 1.75 font heights starts a new block; normal leading continues', () => {
  assert.equal(page([item('One line of words.'), item('Two lines of words.', 72, 682)]).length, 2);
  assert.equal(page([item('One line of words and more words here.', 72, 700, 300), item('Two lines of words.', 72, 688, 200)]).length, 1);
});

test('PDF table-of-contents rows keep numbers, dot leaders and page numbers in the original rendering', () => {
  const rows = [
    item('2', 72, 700, 5), item('Limits and Derivatives', 87, 700, 96), item('9', 535, 700, 5),
    item('2.1', 87, 678, 12), item('The Tangent Problem', 119, 678, 86), item('. . . . . . . . . . . .', 213, 678, 300), item('9', 535, 678, 5),
    item('2.2', 87, 656, 12), item('The Limit of a Function' + ' .'.repeat(50), 119, 656, 400), item('12', 530, 656, 10),
  ];
  const blocks = page(rows);
  const text = blocks.filter(b => b.kind === 'text');
  assert.deepEqual(text.map(b => blockSource(b).markup), ['Limits and Derivatives', 'The Tangent Problem', 'The Limit of a Function']);
  assert.ok(text.every(b => b.role === 'toc' && b.lines.length === 1));
  assert.equal(text[0].label, '2 ');
  // The covered region ends where the leader starts, so the dots stay visible.
  assert.ok(text[1].textBox.right <= 214 && text[1].textBox.right >= 205, String(text[1].textBox.right));
  assert.ok(text[2].textBox.right < 300, 'estimated leader start inside a single span');
  assert.ok(text[2].leader.startsWith('.') && text[2].leader.endsWith('12'), 'a close page number belongs to the leader');
  const labels = blocks.filter(b => b.kind !== 'text').map(b => b.text).sort();
  assert.deepEqual(labels, ['2.1', '2.2', '9', '9']);
});

test('PDF first-line indentation and an early line end separate paragraphs', () => {
  const blocks = page([
    item('Deeper networks are harder to train and we show why here.', 84, 700, 456),
    item('present a framework that eases the training of deep nets now.', 72, 688, 468),
    item('of networks used before.', 72, 676, 100),
    item('The depth of representations is of central importance.', 84, 664, 456),
    item('for many visual recognition tasks in the field of vision.', 72, 652, 468),
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].lines.length, 3);
  assert.equal(blocks[0].textBox.indent, 12);
  const short = page([item('Full line of text that spans the column.', 72, 700, 468), item('Short end.', 72, 688, 50), item('Next paragraph starts here.', 72, 676, 468)]);
  assert.deepEqual(short.map(b => b.lines.length), [2, 1]);
});

test('PDF hyphenated line ends join words; a real compound hyphen stays', () => {
  const [block] = page([item('We reformulate the layers as learn-', 72, 700, 468), item('ing residual functions of low/mid/high-', 72, 688, 468), item('level features.', 72, 676, 60)]);
  assert.equal(blockSource(block).markup, 'We reformulate the layers as learning residual functions of low/mid/high-level features.');
});

test('PDF two columns read left column first, after a full-width title', () => {
  const blocks = page([
    item('A Title That Spans Both Columns', 180, 700, 252, 14),
    item('Right column first line of text.', 320, 660, 220), item('Left column first line of text.', 72, 660, 220),
    item('Right column second line text.', 320, 648, 220), item('Left column second line text.', 72, 648, 220),
  ]);
  assert.deepEqual(texts(blocks), ['A Title That Spans Both Columns', 'Left column first line of text. Left column second line text.',
    'Right column first line of text. Right column second line text.']);
  assert.ok(blocks.every((b, i) => b.id === i), 'ids follow reading order');
});

test('PDF rotated, RTL and font-size changes are isolated', () => {
  assert.equal(page([item('A Larger Heading', 72, 700, 160, 16), item('Body text in a smaller size.', 72, 680)]).length, 2);
  const rotated = page([item('Body text line.'), item('arXiv:1512.03385v1', 30, 300, 200, 20, { transform: [0, 20, -20, 0, 30, 300] })]);
  assert.deepEqual(rotated.map(b => b.kind).sort(), ['other', 'text']);
  assert.deepEqual(page([item('Body text line.'), item('RTL', 72, 682, 120, 10, { dir: 'rtl' })]).map(b => b.kind).sort(), ['other', 'text']);
});

test('PDF discards empty and malformed items safely', () => {
  assert.deepEqual(page([null, {}, item(' '), item('Bad', NaN), item('Bad', 72, 700, -1), item('Bad', 72, 700, 12, Infinity)]), []);
  assert.deepEqual(segmentPage().blocks, []);
  assert.deepEqual(segmentPage(null, { pageWidth: W, pageHeight: H }).blocks, []);
});

test('PDF punctuation spans do not get artificial spaces', () => {
  assert.equal(page([item('word', 72, 700, 30), item('.', 102.5, 700, 3)])[0].text, 'word.');
});

test('PDF display formulas stay original; math-font variables become atoms with page rectangles', () => {
  const blocks = page([
    filler(720),
    item('Consider the following equation with care.', 72, 700, 200),
    math('x', 260, 676, 6), math('+', 270, 676, 8), math('y', 282, 676, 6), math('=', 292, 676, 8), math('2', 304, 676, 5),
    item('Fix the point', 72, 652, 60), math('P', 135, 652, 7), item('on the curve and pick a point.', 145, 652, 140),
  ]);
  assert.deepEqual(blocks.map(b => b.kind), ['text', 'text', 'math', 'text']);
  const source = blockSource(blocks[3]);
  assert.equal(source.markup, 'Fix the point <x0/> on the curve and pick a point.');
  assert.equal(source.atoms[0].text, 'P');
  assert.deepEqual(source.atoms[0].rect, { left: 135, right: 142, top: H - 652 - 8, bottom: H - 652 + 2 });
  assert.equal(source.atoms[0].baseline, H - 652);
  for (const text of ['x + y = 2', '∫ f(x) dx = 0', 'α₁ + β₂ = γ', 'x y z']) assert.ok(formulaLine(text), text);
  for (const text of ['Let x be a real number.', 'We compare x and y = 2 in this example.', 'The vector space has finite dimension.']) assert.ok(!formulaLine(text), text);
});

test('PDF adjacent math spans, commas and scripts merge into one atom', () => {
  const [, block] = page([filler(720),
    item('The points', 72, 700, 50), math('Q', 125, 700, 7), item('1', 132, 698.5, 4, 7), math(', Q', 137, 700, 12), item('2', 149, 698.5, 4, 7),
    item('are not separate things at all.', 156, 700, 150)]);
  const source = blockSource(block);
  assert.equal(source.markup, 'The points <x0/> are not separate things at all.');
  assert.deepEqual(source.atoms[0].runs, [{ text: 'Q' }, { text: '1', script: 'sub' }, { text: ', Q' }, { text: '2', script: 'sub' }]);
  assert.equal(source.atoms[0].rect.left, 125);
  assert.equal(source.atoms[0].rect.right, 153);
});

test('PDF inline formulas typed in the body font are detected conservatively', () => {
  const text = 'Let x_1 + y = 2 be a constraint and f(x) be continuous.';
  assert.deepEqual(inlineMath(text).map(r => text.slice(r.start, r.end)), ['x_1 + y = 2', 'f(x)']);
  for (const prose of ['Around 1630, and in [41, 44] with 3.57% error.', 'A quiet day with a friend.', 'The low/mid/high-level features.']) {
    assert.deepEqual(inlineMath(prose), [], prose);
  }
  const parts = mathParts(text);
  assert.equal(parts.map(p => p.text).join(''), text);
  assert.deepEqual(parts.filter(p => p.type === 'math').map(p => p.text), ['x_1 + y = 2', 'f(x)']);
  const [block] = page([item('We know that a + b = c holds for all of the given numbers here.', 72, 700, 400)]);
  const source = blockSource(block);
  assert.equal(source.markup, 'We know that <x0/> holds for all of the given numbers here.');
  assert.ok(source.atoms[0].rect.left > 72 && source.atoms[0].rect.right < 472);
});

test('PDF running headers, footers and page numbers are marked margin', () => {
  const blocks = page([item('Chapter 1 Brief Introduction', 72, 760, 120, 9), filler(700), item('7', 300, 30, 6)]);
  assert.deepEqual(blocks.map(b => b.kind), ['margin', 'text', 'margin']);
  const title = page([item('A Large Title Near The Top', 72, 745, 300, 18), filler(700)]);
  assert.deepEqual(title.map(b => b.kind), ['text', 'text'], 'a large title in the top band is content');
});

test('PDF raised and lowered glyphs attach to their baseline as script runs', () => {
  const [formula] = page([math('f(x) = x', 72, 700, 48), item('2', 120, 704, 4, 7), item('We explain the equation below.', 72, 670)]);
  assert.equal(formula.text, 'f(x) = x2');
  assert.equal(formula.kind, 'math');
  const blocks = page([item('2', 191, 704, 4, 7), item('Consider the constraint', 72, 700, 108), math('x', 183, 700, 8), item('and compare values.', 198, 700, 100)]);
  assert.equal(blocks.length, 1);
  const source = blockSource(blocks[0]);
  assert.equal(source.markup, 'Consider the constraint <x0/> and compare values.');
  assert.deepEqual(source.atoms[0].runs, [{ text: 'x' }, { text: '2', script: 'sup' }]);
});

test('PDF a large operator does not turn an adjacent prose sentence into a superscript', () => {
  const blocks = page([item('∫', 200, 700, 10, 24), item('We explain the meaning of the symbol.', 72, 685, 150, 10)]);
  assert.equal(blocks.length, 2);
  assert.equal(blockSource(blocks.find(b => b.kind === 'text')).atoms.length, 0);
});

test('PDF list markers and section numbers stay original while the item text is translated', () => {
  const blocks = page([filler(720),
    item('1. Fix the point on the curve and pick a second point on the curve as well.', 84, 700, 456),
    item('this continuation line is indented under the item text.', 96, 688, 300),
    item('2. Draw the secant line through both points.', 84, 676, 220),
    item('3.1. Residual Learning', 72, 640, 110, 12),
  ]);
  const [, first, second, heading] = blocks;
  assert.equal(first.role, 'list');
  assert.equal(first.label, '1. ');
  assert.equal(first.lines.length, 2, 'hanging continuation joins its list item');
  assert.equal(blockSource(first).markup, 'Fix the point on the curve and pick a second point on the curve as well. this continuation line is indented under the item text.');
  assert.ok(first.cover[0].left > 84, 'cover starts after the marker');
  assert.equal(second.label, '2. ');
  assert.equal(heading.role, 'heading');
  assert.equal(heading.label, '3.1. ');
  assert.equal(blockSource(heading).markup, 'Residual Learning');
});

test('PDF centred title lines, small figure annotations and table rows', () => {
  const blocks = page([
    item('Lecture Notes', 260, 700, 92, 14),
    filler(660), filler(648),
    item('iter. (1e4)', 300, 500, 30, 6.5), item('56-layer', 350, 520, 22, 6.5),
    item('Model', 72, 400, 30), item('Error rate', 250, 400, 45), item('Depth', 420, 400, 26),
    item('Plain net', 72, 388, 40), item('Seven percent', 250, 388, 62), item('Thirty', 420, 388, 28),
  ]);
  assert.equal(blocks[0].align, 'center');
  assert.deepEqual(blocks[0].textBox.room, { left: 72, right: 540 }, 'a lone title may grow across its column');
  assert.deepEqual(blocks.filter(b => b.kind === 'label').map(b => b.text).sort(), ['56-layer', 'iter. (1e4)']);
  const cells = blocks.filter(b => b.role === 'cell');
  assert.equal(cells.length, 6, 'cells are never merged down a column');
  assert.ok(cells.every(b => b.lines.length === 1));
});

test('PDF measured offsets interpolate inside a span', () => {
  const [block] = page([item('Hello world', 100, 700, 110)]);
  const measure = text => text.length;
  const line = { text: 'Hello world', right: 210, pieces: [{ start: 0, end: 11, frag: { left: 100, right: 210 } }] };
  assert.equal(offsetX(line, 6, measure), 160);
  assert.equal(offsetX(line, 11, measure), 210);
  assert.equal(block.textBox.right, 210);
});

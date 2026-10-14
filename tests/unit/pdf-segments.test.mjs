import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentTextItems, formulaLine, mathParts } from '../../extension/pdf/segments.js';
const item = (str, x = 40, y = 700, width = 260, height = 12, extra = {}) =>
  ({ str, transform: [height, 0, 0, height, x, y], width, height, ...extra });
test('PDF joins split text spans and normal adjacent lines without mutating input', () => {
  const input = [item('Hello',40,700,28),item('world.',72,700,35),item('A second line follows.',40,682,67)];
  const before = structuredClone(input);
  const p = segmentTextItems(input);
  assert.equal(p.length,1); assert.equal(p[0].text,'Hello world. A second line follows.');
  assert.equal(p[0].lines.length,2); assert.deepEqual(input,before);
});
test('PDF line gap over 2.4 heights splits, boundary stays together', () => {
  assert.equal(segmentTextItems([item('One'),item('Two',40,670)]).length,2);
  assert.equal(segmentTextItems([item('One'),item('Two',40,671.2)]).length,1);
});
test('PDF left indentation over 1.2 heights starts a new paragraph', () => {
  assert.equal(segmentTextItems([item('First line'),item('Indented line',55,682)]).length,2);
});
test('PDF short right-indented line starts the next paragraph', () => {
  const p=segmentTextItems([item('Full line',40,700,350),item('A short end.',40,682,80),item('Next paragraph',40,664,350)]);
  assert.deepEqual(p.map(p=>p.lines.length),[2,1]);
});
test('PDF disjoint columns remain separate in column reading order', () => {
  const p=segmentTextItems([item('Right one',330,700,180),item('Left one',40,700,180),item('Right two',330,682,180),item('Left two',40,682,180)]);
  assert.deepEqual(p.map(p=>p.text),['Left one Left two','Right one Right two']);
});
test('PDF rotated, RTL and changes of font height remain isolated', () => {
  assert.equal(segmentTextItems([item('Title',40,700,100,24),item('Body',40,674)]).length,2);
  assert.equal(segmentTextItems([item('Body'),item('Rotated',40,682,120,12,{transform:[0,12,-12,0,40,682]})]).length,2);
  assert.equal(segmentTextItems([item('Body'),item('RTL',40,682,120,12,{dir:'rtl'})]).length,2);
});
test('PDF discards empty and malformed coordinates safely', () => {
  assert.deepEqual(segmentTextItems([null,{},item(' '),item('Bad',NaN),item('Bad',40,700,-1),item('Bad',40,700,12,Infinity)]),[]);
  assert.deepEqual(segmentTextItems(),[]);
});
test('PDF punctuation does not introduce artificial spaces', () => {
  assert.equal(segmentTextItems([item('word',40,700,30),item('.',73,700,3)] )[0].text,'word.');
});

test('PDF mathematical lines and variable fragments do not join natural-language paragraphs', () => {
  const parts=segmentTextItems([item('Consider the following equation.'),item('x + y = 2',40,682),item('The solution is unique.',40,664)]);
  assert.deepEqual(parts.map(p=>p.kind),['prose','formula','prose']);
  for(const text of ['x + y = 2','∫ f(x) dx = 0','α₁ + β₂ = γ','x y z']) assert.ok(formulaLine(text),text);
  for(const text of ['Let x be a real number.','We compare x and y = 2 in this example.','The vector space has finite dimension.']) assert.ok(!formulaLine(text),text);
});

test('PDF inline mathematical islands survive as opaque parts while natural-language sentences remain', () => {
  const text='Let x_1 + y = 2 be a constraint and f(x) be continuous.';
  const parts=mathParts(text);
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.deepEqual(parts.filter(p=>p.type==='math').map(p=>p.text),['x_1 + y = 2','f(x)']);
  assert.deepEqual(mathParts('A quiet day with a friend.'),[{type:'text',text:'A quiet day with a friend.'}]);
});

test('PDF page numbers and marginal headers/footers are marked untranslatable', () => {
  const input=[item('Lecture notes',40,775),item('A natural-language paragraph.',40,700),item('7',300,20,6)];
  assert.deepEqual(segmentTextItems(input,{pageHeight:792,pageNumber:7}).map(p=>p.kind),['margin','prose','margin']);
});

test('PDF raised and lowered variable fragments attach to the nearby baseline', () => {
  const p=segmentTextItems([item('f(x) = x',40,700,48),item('2',88,704,4,7),item('We explain the equation below.',40,670)]);
  assert.equal(p[0].text,'f(x) = x2');assert.equal(p[0].kind,'formula');
  assert.deepEqual(p[0].parts[0].runs,[{text:'f(x) = x'},{text:'2',script:'sup'}]);
  assert.equal(segmentTextItems([item('2',40,400,8)],{pageHeight:792})[0].kind,'formula');
});

test('PDF a large operator does not turn an adjacent prose sentence into a superscript', () => {
  const p=segmentTextItems([item('∫',200,700,10,24),item('We explain the meaning of the symbol.',40,685,150,10)]);
  assert.equal(p.length,2);assert.equal(p.find(part=>part.kind==='prose').scriptRanges.length,0);
});

test('PDF an early raised glyph joins a baseline assembled from later prose and math spans', () => {
  const p=segmentTextItems([item('2',180,704,4,7),item('Consider the constraint',40,700,108),item('x',172,700,8),item('and compare values.',188,700,100)]);
  assert.equal(p.length,1);assert.match(p[0].text,/x2/);
  assert.ok(p[0].parts.some(part=>part.runs?.some(run=>run.script==='sup'&&run.text==='2')));
});

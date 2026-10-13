import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentTextItems } from '../../extension/pdf/segments.js';
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatches, splitLongText, joinTranslations } from '../../extension/shared/batch.js';

const item = (id, n) => ({ id, text: 'x'.repeat(n) });
const ids = (batches) => batches.map((b) => b.map((i) => i.id));

test('makeBatches: empty input and no limits', () => {
  assert.deepEqual(makeBatches([], { maxItems: 2, maxChars: 10 }), []);
  assert.deepEqual(ids(makeBatches([item(1, 5), item(2, 5), item(3, 5)])), [[1, 2, 3]]);
});

test('makeBatches: maxItems boundary', () => {
  const b = makeBatches([item(1, 1), item(2, 1), item(3, 1), item(4, 1), item(5, 1)], { maxItems: 2, maxChars: 100 });
  assert.deepEqual(ids(b), [[1, 2], [3, 4], [5]]);
});

test('makeBatches: maxChars boundary is inclusive', () => {
  const b = makeBatches([item(1, 5), item(2, 5), item(3, 5)], { maxItems: 10, maxChars: 10 });
  assert.deepEqual(ids(b), [[1, 2], [3]]);
  const c = makeBatches([item(1, 6), item(2, 5)], { maxItems: 10, maxChars: 10 });
  assert.deepEqual(ids(c), [[1], [2]]);
});

test('makeBatches: an oversized item gets a batch of its own, order is preserved', () => {
  const b = makeBatches([item(1, 3), item(2, 50), item(3, 3), item(4, 3)], { maxItems: 10, maxChars: 10 });
  assert.deepEqual(ids(b), [[1], [2], [3, 4]]);
});

test('makeBatches: zero / invalid limits mean unlimited', () => {
  assert.deepEqual(ids(makeBatches([item(1, 5), item(2, 5)], { maxItems: 0, maxChars: 0 })), [[1, 2]]);
});

test('splitLongText: short text and invalid limits are returned whole', () => {
  assert.deepEqual(splitLongText('short.', 100), ['short.']);
  assert.deepEqual(splitLongText('anything at all', 0), ['anything at all']);
  assert.deepEqual(splitLongText('', 10), ['']);
});

test('splitLongText: English sentences, lossless, within the limit', () => {
  const text = 'First sentence is here. Second sentence follows it! Is the third one a question? Yes it is; and more.';
  const parts = splitLongText(text, 40);
  assert.equal(parts.join(''), text);
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.length <= 40, p);
  assert.ok(parts[0].endsWith('. '));
});

test('splitLongText: Chinese sentence enders need no following space', () => {
  const text = '第一句话在这里。第二句话紧跟着！第三句是问题吗？是的，没错。';
  const parts = splitLongText(text, 12);
  assert.equal(parts.join(''), text);
  assert.deepEqual(parts, ['第一句话在这里。', '第二句话紧跟着！', '第三句是问题吗？', '是的，没错。']);
});

test('splitLongText: never cuts inside a tag or a <gN>…</gN> group', () => {
  const group = '<g0>This is a linked phrase. It has two sentences inside.</g0>';
  const text = `Intro sentence. ${group} Tail sentence here. And <x1/> a marker. End.`;
  for (const max of [10, 20, 30, 45]) {
    const parts = splitLongText(text, max);
    assert.equal(parts.join(''), text, `max ${max}`);
    for (const p of parts) {
      assert.equal((p.match(/<g\d+>/g) || []).length, (p.match(/<\/g\d+>/g) || []).length, `balanced g in "${p}" (max ${max})`);
      assert.doesNotMatch(p, /^[^<]*>/, `no dangling tag end in "${p}"`);
      assert.doesNotMatch(p, /<[^>]*$/, `no dangling tag start in "${p}"`);
    }
  }
});

test('splitLongText: a sentence ending just before a closing tag still splits after the tag', () => {
  const text = 'See <g0>the docs.</g0> Then continue reading the rest of this paragraph.';
  const parts = splitLongText(text, 30);
  assert.equal(parts.join(''), text);
  assert.equal(parts[0], 'See <g0>the docs.</g0> ');
});

test('splitLongText: entities are not treated as sentence ends', () => {
  const text = 'Cats &amp; dogs are common pets &amp; friends, and they live together happily &amp; long.';
  const parts = splitLongText(text, 30);
  assert.equal(parts.join(''), text);
  for (const p of parts) assert.doesNotMatch(p, /&[a-z]*$/);
  for (const p of parts.slice(1)) assert.doesNotMatch(p, /^[a-z]*;/);
});

test('splitLongText: decimals and abbreviations without a following space do not split', () => {
  const parts = splitLongText('The value is 3.14159 and the file is a.b.c.txt. Next sentence starts here properly.', 50);
  assert.equal(parts.join(''), 'The value is 3.14159 and the file is a.b.c.txt. Next sentence starts here properly.');
  assert.ok(parts[0].includes('3.14159'));
  assert.ok(parts[0].includes('a.b.c.txt'));
});

test('splitLongText: no punctuation at all falls back to clauses, spaces, then arbitrary cuts', () => {
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
  const a = splitLongText(words, 20);
  assert.equal(a.join(''), words);
  for (const p of a) assert.ok(p.length <= 20);
  for (const p of a.slice(0, -1)) assert.ok(p.endsWith(' '), `cut at a space: "${p}"`);

  const cjk = '这是一段没有任何标点符号的很长的中文文字内容用来测试硬切分';
  const b = splitLongText(cjk, 10);
  assert.equal(b.join(''), cjk);
  for (const p of b) assert.ok(p.length <= 10);

  const clause = '先说这件事，然后说那件事，最后再说另外一件事情';
  const c = splitLongText(clause, 12);
  assert.equal(c.join(''), clause);
  assert.ok(c[0].endsWith('，'));
  for (const p of c) assert.doesNotMatch(p, /^[，。、]/, 'never starts with punctuation');
});

test('splitLongText: an oversized group stays whole instead of being cut', () => {
  const big = `<g0>${'word '.repeat(30)}</g0>`;
  const text = `Before. ${big} After.`;
  const parts = splitLongText(text, 40);
  assert.equal(parts.join(''), text);
  assert.ok(parts.some((p) => p.includes(big)));
});

test('splitLongText: surrogate pairs are not split', () => {
  const text = '😀'.repeat(30);
  const parts = splitLongText(text, 7);
  assert.equal(parts.join(''), text);
  for (const p of parts) assert.doesNotMatch(p, /^[\udc00-\udfff]|[\ud800-\udbff]$/);
});

test('joinTranslations adds a space only between two non-CJK neighbours', () => {
  assert.equal(joinTranslations(['Hello.', 'World.']), 'Hello. World.');
  assert.equal(joinTranslations(['你好。', '世界。']), '你好。世界。');
  assert.equal(joinTranslations(['你好', 'World']), '你好World');
  assert.equal(joinTranslations(['End. ', 'Next']), 'End. Next');
  assert.equal(joinTranslations(['only']), 'only');
  assert.equal(joinTranslations([]), '');
});

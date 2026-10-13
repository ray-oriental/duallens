import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, unescapeText, stripMarkup, parseMarkup } from '../../extension/shared/markup.js';

const T = (v) => ({ t: 'text', v });
const G = (n, ...children) => ({ t: 'g', n, children });
const X = (n) => ({ t: 'x', n });
const parse = (s, o = { maxG: 8, maxX: 8 }) => parseMarkup(s, o);

test('escape / unescape round trip', () => {
  const raw = 'a < b && c > d &lt; <g0>';
  assert.equal(escapeText(raw), 'a &lt; b &amp;&amp; c &gt; d &amp;lt; &lt;g0&gt;');
  assert.equal(unescapeText(escapeText(raw)), raw);
  assert.equal(unescapeText('&amp;lt;'), '&lt;'); // single pass, no double decoding
});

test('plain text parses to a single text node', () => {
  assert.deepEqual(parse('hello world'), { ok: true, nodes: [T('hello world')] });
  assert.deepEqual(parse(''), { ok: true, nodes: [] });
});

test('entities become plain text', () => {
  assert.deepEqual(parse('a &lt;b&gt; &amp; c'), { ok: true, nodes: [T('a <b> & c')] });
  assert.deepEqual(parse('say &quot;hi&quot; &#39;x&#39;'), { ok: true, nodes: [T('say "hi" \'x\'')] });
});

test('g and x markers', () => {
  const r = parse('See <g0>the docs</g0> and <x1/> now');
  assert.deepEqual(r, { ok: true, nodes: [T('See '), G(0, T('the docs')), T(' and '), X(1), T(' now')] });
  assert.deepEqual(parse('<x0 />').nodes, [X(0)]);
});

test('nesting up to depth 4 is accepted, depth 5 falls back', () => {
  const ok = parse('<g0><g1><g2><g3>deep</g3></g2></g1></g0>');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.nodes, [G(0, G(1, G(2, G(3, T('deep')))))]);
  const bad = parse('<g0><g1><g2><g3><g4>too deep</g4></g3></g2></g1></g0>');
  assert.equal(bad.ok, false);
  assert.equal(bad.plain, 'too deep');
});

test('nested g with text around it', () => {
  const r = parse('<g0>a <g1>b</g1> c</g0>');
  assert.deepEqual(r.nodes, [G(0, T('a '), G(1, T('b')), T(' c'))]);
});

test('out-of-range indexes fall back to plain text', () => {
  const r = parse('<g9>x</g9> y', { maxG: 2, maxX: 2 });
  assert.deepEqual(r, { ok: false, plain: 'x y' });
  assert.equal(parse('a <x2/>', { maxG: 2, maxX: 2 }).ok, false);
  assert.equal(parse('a <x1/>', { maxG: 2, maxX: 2 }).ok, true);
  assert.equal(parse('<g2>a</g2>', { maxG: 2, maxX: 2 }).ok, false); // N must be < max
  assert.equal(parse('<g0>a</g0>', { maxG: 0, maxX: 0 }).ok, false);
});

test('unclosed, stray close and crossed nesting fall back', () => {
  assert.deepEqual(parse('<g0>open only'), { ok: false, plain: 'open only' });
  assert.deepEqual(parse('close only</g0>'), { ok: false, plain: 'close only' });
  assert.deepEqual(parse('<g0>a<g1>b</g0>c</g1>'), { ok: false, plain: 'abc' });
  assert.equal(parse('<g0>a</g1>').ok, false);
});

test('a g nested inside itself is rejected', () => {
  assert.equal(parse('<g0>a<g0>b</g0></g0>').ok, false);
});

test('model-invented tags are dropped, text kept', () => {
  const r = parse('Hello <b>bold</b> <br/> <span class="x">w</span><!-- c -->!');
  assert.deepEqual(r, { ok: true, nodes: [T('Hello bold  w!')] });
  assert.equal(parse('<g1 class="x">a</g1>').ok, false); // malformed marker is not silently accepted
});

test('the same gN may appear several times (a link split by the model)', () => {
  const r = parse('<g0>one</g0> and <g0>two</g0>');
  assert.deepEqual(r.nodes, [G(0, T('one')), T(' and '), G(0, T('two'))]);
});

test('a repeated xN falls back to plain text', () => {
  const r = parse('a <x0/> b <x0/> c');
  assert.equal(r.ok, false); assert.equal(r.plain, 'a  b  c');
});

test('empty g runs are pruned', () => {
  assert.deepEqual(parse('a<g0></g0>b').nodes, [T('ab')]);
  assert.deepEqual(parse('<g0><x0/></g0>').nodes, [G(0, X(0))]);
});

test('truncated marker at the end of the string', () => {
  assert.deepEqual(parse('text <g1'), { ok: true, nodes: [T('text ')] });
  assert.equal(stripMarkup('text <g1'), 'text ');
  assert.equal(stripMarkup('text </g'), 'text ');
  assert.equal(parse('a <g1 b <x0/>').ok, false); // half-formed marker in the middle
});

test('stripMarkup removes markers and other tags, then unescapes', () => {
  assert.equal(stripMarkup('<g0>Hi</g0> <x1/>&lt;tag&gt; <b>bold</b> &amp; more'), 'Hi <tag> bold & more');
  assert.equal(stripMarkup(null), '');
});

test('model output that quotes literal marker text via entities stays text', () => {
  const r = parse('use &lt;g0&gt; markers');
  assert.deepEqual(r, { ok: true, nodes: [T('use <g0> markers')] });
});

test('huge indexes do not crash', () => {
  assert.equal(parse('<g99999999999999999999>a</g99999999999999999999>').ok, false);
});

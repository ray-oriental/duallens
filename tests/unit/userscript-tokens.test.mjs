import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { tokens } from '../../scripts/build_userscript.mjs';
import { tokens as legacyTokens } from './fixtures/legacy-userscript-tokens.mjs';

const literal = (body, quote = '"') => quote + body + quote;

test('string decoding matches non-strict vm literals for both quotes and all escape forms', () => {
  const bodies = [
    '', 'plain ASCII', '中文', '😀', '\u0000', '\ud800', '\udfff', '\u2028', '\u2029',
    String.raw`\n\t\r\b\f\v\0`, String.raw`\x00\x0a\x7F\xff`,
    String.raw`\u0000\u4E2D\uD83D\uDE00\uD800\uDFFF`,
    String.raw`\u{0}\u{4e2d}\u{1F600}\u{10ffff}\u{d800}\u{00000000000000041}`,
    String.raw`\\\'\"\/\q\z\$\8\9\08\09`,
    String.raw`\1\7\00\01\07\10\77\100\377\400\777\378\478`,
  ];
  for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) bodies.push('left\\' + newline + 'right');
  for (let n = 0; n < 512; n++) bodies.push('\\' + n.toString(8) + '89');
  for (let n = 0; n < 256; n++) {
    const hex = n.toString(16).padStart(2, '0');
    bodies.push('\\x' + hex, '\\u00' + hex, '\\u{' + hex + '}');
  }
  for (const quote of ['"', "'"]) {
    for (const body of [...bodies, quote === '"' ? "single ' quote" : 'double " quote']) {
      const raw = literal(body, quote);
      const result = tokens(raw, 'literal.js');
      assert.deepEqual(result, [{ kind: 'string', value: vm.runInThisContext(raw), start: 0, end: raw.length }], JSON.stringify(raw));
    }
  }
});

test('invalid escapes, raw newlines and unterminated literals fail with the source filename', () => {
  const bodies = [
    String.raw`\x`, String.raw`\x0`, String.raw`\xGG`, String.raw`\x0g`,
    String.raw`\u`, String.raw`\u0`, String.raw`\u000`, String.raw`\u00zz`,
    String.raw`\u{}`, String.raw`\u{`, String.raw`\u{123`, String.raw`\u{-1}`,
    String.raw`\u{+1}`, String.raw`\u{ 41}`, String.raw`\u{41 }`, String.raw`\u{1g}`,
    String.raw`\u{110000}`, String.raw`\u{ffffffffffffffff}`, 'left\nright', 'left\rright',
  ];
  for (const quote of ['"', "'"]) {
    for (const raw of [...bodies.map(body => literal(body, quote)), quote + 'unfinished', quote + 'unfinished\\']) {
      assert.throws(() => vm.runInThisContext(raw), { name: 'SyntaxError' }, JSON.stringify(raw));
      assert.throws(() => tokens(raw, 'invalid.js'), /^Error: invalid\.js: /, JSON.stringify(raw));
    }
  }
});

test('string decoding never invokes the vm context evaluator, including template expressions', () => {
  const original = vm.runInNewContext;
  try {
    vm.runInNewContext = () => { throw new Error('per-literal VM evaluation is forbidden'); };
    assert.equal(tokens(String.raw`"\u{1f600}"`)[0].value, '😀');
    assert.equal(tokens('`prefix ${"\\x41"} suffix`')[0].kind, 'template');
    assert.throws(() => tokens('`${"\\u{}"}`', 'template.js'), /template\.js: invalid/);
  } finally { vm.runInNewContext = original; }
});

test('all extension JavaScript token streams equal the frozen legacy lexer, including vendor files', async context => {
  const root = new URL('../../extension/', import.meta.url);
  const files = (await fs.readdir(root, { recursive: true })).filter(file => file.endsWith('.js')).sort();
  assert.ok(files.length > 0);
  assert.ok(files.some(file => /vendor[\\/]/.test(file)), 'vendor sources must not be skipped');
  let count = 0;
  for (const file of files) {
    const source = await fs.readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8');
    const expected = legacyTokens(source, file);
    assert.deepEqual(tokens(source, file), expected, file);
    count += expected.filter(token => token.kind === 'string').length;
  }
  context.diagnostic(`${files.length} JavaScript files; ${count} string tokens; full token streams match`);
});

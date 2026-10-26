import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedback } from '../../extension/ui/forms/feedback.js';
import { shortcutFor, shortcutSummary } from '../../extension/ui/shortcuts.js';
import { parseGlossary, formatGlossary } from '../../extension/ui/forms/glossary.js';
import { setUiLanguage, t } from '../../extension/shared/i18n.js';

function node(text = '') {
  const attrs = new Map(), classes = new Set();
  return { textContent: text, disabled: false, id: '',
    setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
    removeAttribute: key => attrs.delete(key),
    classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); }, contains: key => classes.has(key) } };
}
function fixture() {
  const status = node();
  return { status, feedback: createFeedback({ querySelector: () => status,
    ownerDocument: { defaultView: { matchMedia: () => ({matches: true}) } } }) };
}
for (const language of ['zh-CN', 'en']) {
  test(`UX ${language}: async identity guard, live timestamp and result`, async () => {
    setUiLanguage(language);
    const {status, feedback} = fixture(), a = node('Translate'), b = node('Copy');
    let finish, calls = 0;
    const pending = feedback.run(a, async report => { calls++; await new Promise(resolve => {finish = resolve;}); report(t('uxSettingSaved')); return 42; });
    assert.equal(a.disabled, true); assert.equal(a.getAttribute('aria-busy'), 'true');
    assert.equal(a.textContent, t('actionWorking'));
    await feedback.run(a, () => { calls++; });
    await feedback.run(b, () => { calls++; });
    assert.equal(calls, 2, 'unrelated buttons with empty IDs must work independently');
    finish(); assert.equal(await pending, 42);
    assert.equal(a.disabled, false); assert.equal(a.textContent, 'Translate');
    assert.equal(a.getAttribute('aria-busy'), undefined);
    assert.match(status.textContent, /^\d\d:\d\d:\d\d · /);
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.getAttribute('aria-atomic'), 'true');
  });
  test(`UX ${language}: failures restore button; closed/disabled controls stay inactive`, async () => {
    setUiLanguage(language);
    const {status, feedback} = fixture(), a = node('Copy');
    await feedback.run(a, () => { throw Error('fixture failure'); });
    assert.equal(a.disabled, false); assert.match(status.textContent, /fixture failure/);
    assert.equal(status.classList.contains('error'), true);
    a.disabled = true; await feedback.run(a, () => assert.fail('disabled action ran'));
    assert.equal(a.disabled, true); a.disabled = false;
    let finish;
    const pending = feedback.run(a, async report => { await new Promise(resolve => {finish = resolve;}); report('late'); });
    feedback.destroy(); finish(); await pending;
    assert.equal(status.textContent, '');
    await feedback.run(node(), () => assert.fail('destroyed action ran'));
  });
  test(`UX ${language}: bindings are actual, ordered and never invented`, () => {
    setUiLanguage(language);
    const commands = [{name: 'open-sidepanel', shortcut: 'Ctrl+Shift+S'}, {name: 'toggle-page', shortcut: ''},
      {name: 'toggle-translation-only', shortcut: 'Ctrl+Shift+W'}];
    assert.equal(shortcutFor(commands, 'toggle-page'), '');
    assert.equal(shortcutFor(commands, 'translate-input'), '');
    const summary = shortcutSummary(commands);
    assert.ok(summary.indexOf('Ctrl+Shift+W') < summary.indexOf('Ctrl+Shift+S'));
    assert.doesNotMatch(summary, /Alt\+/);
    assert.equal(shortcutSummary([]), '');
  });
  test(`UX ${language}: glossary roundtrip and reject before replacing draft`, () => {
    setUiLanguage(language);
    const parsed = parseGlossary('\uFEFFkernel → 内核\r\nAPI\t接口\r\n');
    assert.deepEqual(parseGlossary(formatGlossary(parsed)), parsed);
    assert.deepEqual(parseGlossary(''), []);
    assert.throws(() => parseGlossary('missing separator'));
    assert.throws(() => parseGlossary('a → b → c'));
    assert.throws(() => parseGlossary(Array(501).fill('a\tb').join('\n')));
    assert.equal(parseGlossary(Array(500).fill('a\tb').join('\n')).length, 500);
  });
}

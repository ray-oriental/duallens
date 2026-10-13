import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLang, sameLanguage, sameLanguageFamily, looksLikeTarget, cjkRatio } from '../../extension/shared/lang.js';

test('normalizeLang maps Chinese variants', () => {
  for (const c of ['zh', 'zh-CN', 'zh-cn', 'zh-Hans', 'zh_CN', 'zh-SG', 'zh-Hans-CN', 'cmn']) {
    assert.equal(normalizeLang(c), 'zh-CN', c);
  }
  for (const c of ['zh-TW', 'zh-tw', 'zh-Hant', 'zh-HK', 'zh-hant-tw', 'zh-MO', 'yue']) {
    assert.equal(normalizeLang(c), c === 'yue' ? 'zh-CN' : 'zh-TW', c);
  }
});

test('normalizeLang strips regions and handles odd input', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('pt_BR'), 'pt');
  assert.equal(normalizeLang('JA'), 'ja');
  assert.equal(normalizeLang('iw'), 'he');
  assert.equal(normalizeLang('auto'), 'auto');
  assert.equal(normalizeLang(''), '');
  assert.equal(normalizeLang(undefined), '');
});

test('sameLanguage compares after normalising', () => {
  assert.equal(sameLanguage('en-GB', 'en'), true);
  assert.equal(sameLanguage('zh', 'zh-Hans'), true);
  assert.equal(sameLanguage('zh-CN', 'zh-TW'), false);
  assert.equal(sameLanguage('', ''), false);
  assert.equal(sameLanguage('en', 'fr'), false);
  assert.equal(sameLanguageFamily('zh-CN', 'zh-TW'), true);
  assert.equal(sameLanguageFamily('en', 'zh'), false);
});

test('cjkRatio', () => {
  assert.equal(cjkRatio('hello'), 0);
  assert.equal(cjkRatio('你好'), 1);
  assert.equal(cjkRatio('你好 ab'), 0.5);
  assert.equal(cjkRatio('123 ...'), 0);
  assert.equal(cjkRatio(''), 0);
  assert.ok(cjkRatio('こんにちは') === 1);
});

test('looksLikeTarget: Chinese', () => {
  assert.equal(looksLikeTarget('这是一个已经是中文的段落，不需要翻译。', 'zh-CN'), true);
  assert.equal(looksLikeTarget('這是繁體中文的段落', 'zh-TW'), true);
  assert.equal(looksLikeTarget('使用 React 构建 UI', 'zh'), false); // mixed text: not sure, so false
  assert.equal(looksLikeTarget('This paragraph is English.', 'zh-CN'), false);
  assert.equal(looksLikeTarget('これは日本語の文章です。漢字もあります', 'zh-CN'), false); // kana present
  assert.equal(looksLikeTarget('', 'zh-CN'), false);
  assert.equal(looksLikeTarget('12345 - 67', 'zh-CN'), false);
});

test('looksLikeTarget: other targets', () => {
  assert.equal(looksLikeTarget('これは日本語の文章です。', 'ja'), true);
  assert.equal(looksLikeTarget('漢字漢字', 'ja'), false);
  assert.equal(looksLikeTarget('안녕하세요 여러분', 'ko'), true);
  assert.equal(looksLikeTarget('Привет, как дела у вас сегодня', 'ru'), true);
  assert.equal(looksLikeTarget('The quick brown fox is on the hill and it can run.', 'en'), true);
  assert.equal(looksLikeTarget('Le renard brun rapide saute par-dessus le chien paresseux', 'en'), false);
  assert.equal(looksLikeTarget('Home', 'en'), false); // too short to be sure
  assert.equal(looksLikeTarget('Bonjour tout le monde', 'fr'), false); // no heuristic for latin non-English
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { identifierText,linkIdentifier } from '../../extension/shared/identifiers.js';
import { uiTranslation } from '../../extension/shared/ui-glossary.js';
test('identifier links compare decoded last path segment without case or at-sign',()=>{
  for(const [text,href] of [['microsoft','/microsoft'],[' @Example ','/users/example/'],['build','/org/repo/tree/main/build'],['test file.js','/tree/test%20file.js']]) assert.ok(linkIdentifier(text,href,'https://github.com'));
  assert.equal(linkIdentifier('Read the article','/news/a-title','https://example.com'),false);
  for(const s of ['MIT license','Apache-2.0','Apache License 2.0','map()','Array()','HTML','<div>','a42c6ed','owner/repo','myFile','foo_bar','foo-bar','功能-v2','v1','.gitignore']) assert.ok(identifierText(s),s);
  for(const s of ['Search','Comments','Read this article','今日はいい天気です。']) assert.equal(identifierText(s),false,s);
});
test('common short UI glossary is local, normalized and limited to Chinese targets',()=>{
  assert.equal(uiTranslation('  GO  to file '),'转到文件');
  assert.equal(uiTranslation('More items'),'更多');
  assert.equal(uiTranslation('Sign in','zh-TW'),null);
  assert.equal(uiTranslation('Search','fr'),null);
  assert.equal(uiTranslation('microsoft'),null);
});

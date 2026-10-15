import test from 'node:test';
import assert from 'node:assert/strict';
import { identifierText,linkIdentifier } from '../../extension/shared/identifiers.js';
import { uiTranslation } from '../../extension/shared/ui-glossary.js';
import { isTranslatable } from '../../extension/content/serialize.js';
import { metadataTranslation } from '../../extension/shared/metadata.js';
test('identifier links compare decoded last path segment without case or at-sign',()=>{
  for(const [text,href] of [['microsoft','/microsoft'],[' @example ','/users/example/'],['build','/org/repo/tree/main/build'],['testFile.js','/tree/testFile.js']]) assert.ok(linkIdentifier(text,href,'https://github.com'));
  for(const word of ['News','Sport','Business','Technology','Health','Culture','Arts','Travel','Audio','Video','Live','Search','hide']) assert.equal(linkIdentifier(word,'/'+word.toLowerCase(),'https://www.bbc.com'),false,word);
  assert.equal(linkIdentifier('Read the article','/news/a-title','https://example.com'),false);
  for(const s of ['MIT license','Apache-2.0','Apache License 2.0','map()','Array()','HTML','<div>','a42c6ed','owner/repo','myFile','foo_bar','foo-bar','功能-v2','v1','.gitignore']) assert.ok(identifierText(s),s);
  for(const s of ['Search','Comments','Hello.','Read this article','今日はいい天気です。']) assert.equal(identifierText(s),false,s);
});
test('date exclusion does not swallow versioned documentation labels',()=>{
  assert.equal(isTranslatable('3.15.0 Documentation',1),true);
  for(const text of ['2026-10-16 12:34:56 UTC','12 Jun 2017 17:57:34 UTC (1,102 KB)','2026/10/16']) assert.equal(isTranslatable(text,1),false,text);
});
test('compact metadata translates whole time phrases and keeps names and counts',()=>{
  assert.equal(metadataTranslation('41 points by alice 2 hours ago | hide | 11 comments','zh-CN'),'41 分 来自 alice 2 小时前 | 隐藏 | 11 条评论');
  assert.equal(metadataTranslation('1 point by bob 1 minute ago | reply','zh-CN'),'1 分 来自 bob 1 分钟前 | 回复');
  assert.equal(metadataTranslation('41 points','fr'),null);
  assert.equal(metadataTranslation('41 points by <x0/> 2 hours ago | <g1>hide</g1>','zh-CN'),'41 分 来自 <x0/> 2 小时前 | <g1>隐藏</g1>');
});
test('common short UI glossary is local, normalized and limited to Chinese targets',()=>{
  assert.equal(uiTranslation('  GO  to file '),'转到文件');
  assert.equal(uiTranslation('More items'),'更多');
  assert.equal(uiTranslation('Sign in','zh-TW'),null);
  assert.equal(uiTranslation('Search','fr'),null);
  assert.equal(uiTranslation('microsoft'),null);
});

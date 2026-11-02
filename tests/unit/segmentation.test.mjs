import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sentenceParts,lineParts,proseParts} from '../../extension/shared/segmentation.js';
import {DEFAULT_SETTINGS,migrateSettings,createSettingsStore} from '../../extension/shared/settings.js';
import {memoryArea} from './storage-memory.mjs';

test('sentence boundaries preserve abbreviations, decimals, dialogue and original whitespace',()=> {
  const text='Mr. Bennet met Mrs. Long and Dr. Smith near St. Paul in the U.S. embassy, e.g. at 3.14 vs. 4.2, i.e. today. "Who is there?" cried his wife. He paused... then answered. Next came silence… Another voice!';
  const parts=sentenceParts(text);
  assert.deepEqual(parts.map(s=>s.trim()),[
    'Mr. Bennet met Mrs. Long and Dr. Smith near St. Paul in the U.S. embassy, e.g. at 3.14 vs. 4.2, i.e. today.',
    '"Who is there?" cried his wife.','He paused... then answered.','Next came silence…','Another voice!',
  ]);
  assert.equal(parts.join(''),text);
  assert.deepEqual(sentenceParts('one sentence. another sentence!'),['one sentence. ','another sentence!']);
  assert.deepEqual(sentenceParts('第一句。english follows.'),['第一句。','english follows.']);
});
test('CJK and closing brackets split without spaces; small Latin sentences merge forward',()=> {
  assert.deepEqual(sentenceParts('「今日は晴れ。」明日は雨！本当？是的。'),['「今日は晴れ。」','明日は雨！','本当？','是的。']);
  assert.deepEqual(sentenceParts('Oh! It was a good day. Yes.',{mergeShort:true}),['Oh! It was a good day. Yes.']);
  assert.equal(sentenceParts('This is the first. This is the second.',{mergeShort:true}).length,2);
});
test('paragraph mode preserves normal paragraphs up to 2000 characters and groups walls at sentence boundaries',()=> {
  const sentence='This is a normal sentence with several words and enough content to describe the distant neighbourhood. ';
  for(const n of [1,5,11,16,19]) assert.deepEqual(proseParts(sentence.repeat(n)),[sentence.repeat(n)]);
  const wall=sentence.repeat(28),parts=proseParts(wall);
  assert.ok(parts.length>3);assert.ok(parts.every(s=>s.length>=250&&s.length<=450));
  assert.equal(parts.join(''),wall);
  assert.deepEqual(proseParts('x'.repeat(2300)),['x'.repeat(2300)]);
});
test('forum lines, lyrics, poetry and addresses remain separate; two-line signatures stay intact',()=> {
  for(const text of ['A quiet night\nAcross the bay\nThe lights go out\nWe sail away', '123 Example Road\nExample City\nExample Country']) {
    assert.equal(lineParts(text).length,text.split('\n').length);assert.equal(lineParts(text).join(''),text);
  }
  assert.deepEqual(lineParts('Alice Example\nResearch fellow'),['Alice Example\nResearch fellow']);
  assert.deepEqual(lineParts('第一段。\n还是第一段。\n\n第二段。\n还是第二段。'),['第一段。\n还是第一段。\n\n','第二段。\n还是第二段。']);
});
test('hard wraps join to sentence endings, retaining exact original newlines',()=> {
  const text='The distant neighbourhood was filled with people who were eagerly\nwaiting for news of the new arrival and his family. Another person\nwas waiting outside the door, hoping to learn more about the visit.\n';
  const parts=lineParts(text);assert.equal(parts.length,1);assert.equal(parts.join(''),text);
  assert.ok(parts.every(p=>/[.!?]\s*$/.test(p)));
  assert.equal(lineParts('第一行没有句号\n第二行也没有\n第三行很短').length,3);
  const tail='This is another long line describing the distant neighbourhood.\n';
  const abbreviation='A visitor walked all the way across the neighbourhood to meet Mr.\nBennet, who was waiting for him in the large family drawing room.\n';
  assert.deepEqual(lineParts(abbreviation+tail),[abbreviation,tail]);
  const dialogue='"Do you really want to know who has taken the distant house?"\ncried his wife, impatiently waiting for him to answer her question.\n';
  assert.deepEqual(lineParts(dialogue+tail),[dialogue,tail]);
});
test('segmentation normalizes unknown values and uses the same core store for Chrome and GM',async()=> {
  assert.equal(DEFAULT_SETTINGS.segmentation,'paragraph');
  for(const value of [undefined,null,'line',{},1]) assert.equal(migrateSettings({segmentation:value}).segmentation,'paragraph');
  for(const gm of [false,true]) {
    const local=memoryArea(),sync=gm?local:memoryArea();
    const store=createSettingsStore({localArea:local,syncArea:sync});
    await store.save({segmentation:'sentence'});
    assert.equal(sync.data['settings.core'].segmentation,'sentence');
    assert.equal((await store.load()).segmentation,'sentence');
    await store.save({segmentation:'invalid'});assert.equal((await store.load()).segmentation,'paragraph');
  }
});
test('line heuristics fix the 48-column, 65-percent and 160-character thresholds',()=> {
  for(const size of [47,48]) {
    const text=Array(3).fill('A'.repeat(size)).join('\n');
    assert.equal(lineParts(text).length,size===47?3:1);
  }
  for(const size of [44,46]) {
    const text=['A'.repeat(70),'B'.repeat(size),'C'.repeat(70)].join('\n');
    assert.equal(lineParts(text).length,size===44?3:1);
  }
  const short='A'.repeat(77)+'.\n'+'B'.repeat(79)+'.';
  assert.equal(short.length,159);assert.equal(lineParts(short).length,1);
  assert.equal(lineParts('A'+short).length,2);
  const forum=Array(3).fill('A forum line with sufficient words to describe the distant neighbourhood.').join('\n');
  assert.equal(lineParts(forum).length,3);
});
test('hard-wrap slack preserves author rows; the long-paragraph trigger is strictly above 2000',()=> {
  const fixture=readFileSync(new URL('../fixtures/unsegmented.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const text=fixture.split('id="prewrap" style="white-space:pre-wrap">')[1].split('</div>')[0];
  const parts=lineParts(text);
  assert.equal(parts.length,3);assert.equal(parts[0].length,469);
  assert.ok(parts.every(part=>part.length<=500));assert.equal(parts.join(''),text);
  const ordinary='This sentence has several useful words. '.repeat(60).slice(0,2000);
  assert.equal(ordinary.length,2000);assert.deepEqual(proseParts(ordinary),[ordinary]);
  assert.ok(proseParts(ordinary+'X').length>1);
});
test('line-start spaces left by markup newlines after a BR do not hide sentence ends',()=> {
  const lines=['"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"\n',
    ' Mr. Bennet replied that he had not.\n',' "But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."\n',' Mr. Bennet made no answer.'];
  assert.deepEqual(lineParts(lines.join('')),lines);
});

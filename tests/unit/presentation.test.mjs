import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePresentation, translationColor, contrastRatio } from '../../extension/content/presentation.js';
import { preserveIdentities } from '../../extension/pdf/segments.js';
import { isTranslatable, isShortText } from '../../extension/content/serialize.js';

test('presentation keeps prose below its source and short controls inline', () => {
  for (const tag of ['p','li','blockquote','dd','figcaption']) assert.equal(choosePresentation({tag,textLength:8}), 'block');
  for (const tag of ['a','button','label','summary','th','h2']) assert.equal(choosePresentation({tag,textLength:30}), 'inline');
  assert.equal(choosePresentation({tag:'td',textLength:120}), 'block');
  assert.equal(choosePresentation({tag:'span',textLength:6}), 'inline');
  assert.equal(choosePresentation({tag:'span',paragraph:true,textLength:6}), 'block');
});
test('constrained presentation replaces without expanding the original container', () => {
  for (const constraint of [{whiteSpace:'nowrap'},{overflowX:'hidden'},{overflowY:'clip'},
    {textOverflow:'ellipsis'},{fixedHeight:true},{singleLineFlex:true},{iconOnly:true},{tag:'option'}]) {
    assert.equal(choosePresentation({tag:'p',textLength:100,...constraint}), 'replace');
  }
});
test('translation colours soften only while contrast remains at least 4.5 on light and dark backgrounds', () => {
  for (const [fg,bg] of [[[20,20,20],[255,255,255]],[[230,230,230],[20,20,20]],[[150,150,150],[255,255,255]],[[90,90,90],[100,100,100]]]) {
    const rgb=translationColor(fg,bg).match(/\d+/g).map(Number);
    assert.ok(contrastRatio(rgb,bg)>=4.5);
  }
});
test('visible short words and product labels translate; identifiers and dates do not', () => {
  for (const s of ['Go','I','Top 10','API_v2','Page_1','Sign in']) assert.ok(isTranslatable(s,1),s);
  for (const s of ['https://example.com','code.visualstudio.com','a@example.com','2026-10-15T12:00:00Z','Oct 15, 2026','12:30 PM','2 hours ago','1234','!?']) assert.equal(isTranslatable(s,1),false,s);
});
test('disabling short labels does not exclude a Japanese paragraph without spaces', () => {
  assert.ok(isShortText('Go'));
  assert.ok(isShortText('Sign in now'));
  assert.equal(isShortText('Read the complete article here'),false);
  assert.equal(isShortText('今日はいい天気です。私は庭を歩いて、静かな図書館へ向かいました。'),false);
});
test('PDF local byline preservation requires a nearby header affiliation', () => {
  const b = (text,top) => ({kind:'text',text,box:{top,bottom:top+12},size:10,lines:[{text}]});
  const blocks = [b('Deep Residual Learning for Image Recognition',40),b('Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',90),
    b('Microsoft Research',110),b('{kahe,v-xiangz,v-shren,jiansun}@microsoft.com',125),b('Abstract',180),
    b('Related Work',300),b('The University is discussed in this paragraph.',400)];
  preserveIdentities(blocks,792);
  assert.deepEqual(blocks.map(x=>x.kind),['text','identity','identity','identity','text','text','text']);
  const heading=[b('Related Work',80)];preserveIdentities(heading,792);assert.equal(heading[0].kind,'text');
  const prose=[b('Contact user@example.com for more information',80),b('This University provides useful courses',120)];
  preserveIdentities(prose,792);assert.ok(prose.every(x=>x.kind==='text'));
});

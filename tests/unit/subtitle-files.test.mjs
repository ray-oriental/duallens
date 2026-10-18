import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SUBTITLE_BYTES, parseSubtitles, serializeSubtitles, subtitleText } from '../../extension/content/subtitles/files.js';
import { groupPriority, SubtitleScheduler } from '../../extension/content/subtitles/scheduler.js';

test('SRT BOM/CRLF, multiline, cue styling, entities, long hours and millisecond boundaries', () => {
  const cues = parseSubtitles('\uFEFF1\r\n00:00:59,999 --> 01:00:00,001\r\n<i>First</i> &amp; &lt;literal&gt;\r\nsecond &#x4e2d; &#25991;\r\n\r\n2\r\n100:59:59,000 --> 101:00:00,000\r\nlast', 'srt');
  assert.equal(cues[0].text, 'First & <literal>\nsecond 中 文');
  assert.equal(cues[0].start, 59999); assert.equal(cues[0].end, 3600001);
  assert.equal(cues[1].start, 363599000);
  assert.equal(subtitleText('<v speaker><c.green>safe</c></v> &lt;b&gt; &amp;lt; &#0;'), 'safe <b> &lt; &#0;');
});
test('VTT headers, comments/style/region blocks, identifiers/settings and mm:ss timestamps', () => {
  const cues = parseSubtitles('WEBVTT sample\n\nNOTE comment\nignore\n\nSTYLE\n::cue {color:red}\n\nREGION\nid:top\n\na\n00:01.234 --> 00:02.345 align:start\n<v Alice><b>Hello</b>\nworld\n\nb\n01:00:00.000 --> 01:00:01.001\nLast', 'vtt');
  assert.deepEqual(cues.map(c => [c.start, c.end, c.text]), [[1234,2345,'Hello\nworld'],[3600000,3601001,'Last']]);
});
test('SRT/VTT bilingual export preserves timing and literal markup on semantic roundtrip', () => {
  const cues = [{ start: 0, end: 59999, text: 'First\n<literal> & text', translation: '第一行\n第二行 <script>' }, { start: 3600001, end: 3601002, text: 'Last', translation: '末尾' }];
  for (const format of ['srt','vtt']) {
    const exported = serializeSubtitles(cues, format), parsed = parseSubtitles(exported, format);
    assert.equal(parsed[0].text, cues[0].text + '\n' + cues[0].translation);
    assert.deepEqual(parsed.map(c => [c.start,c.end]), cues.map(c => [c.start,c.end]));
    assert.equal(serializeSubtitles(parsed, format), exported);
    assert.ok(!exported.includes('<script>'));
  }
});
test('empty, unsupported, invalid/end-before-start, minute/second overflow and >2MB rejected', () => {
  for (const timing of ['00:60:00,000 --> 01:01:00,000','00:00:60,000 --> 00:01:01,000','00:00:01,000 --> 00:00:01,000','00:00:02,000 --> 00:00:01,000','00:00:00.000 --> 00:00:01.000']) assert.throws(() => parseSubtitles('1\n'+timing+'\nText', 'srt'));
  assert.throws(() => parseSubtitles('','srt')); assert.throws(() => parseSubtitles('00:01.000 --> 00:02.000\nText','vtt'));
  assert.throws(() => parseSubtitles('x','ass')); assert.throws(() => parseSubtitles('中'.repeat(Math.ceil(MAX_SUBTITLE_BYTES/3)), 'srt'), /2 MB/);
  assert.throws(() => serializeSubtitles([{start:NaN,end:1000,text:'bad'}]));
  assert.throws(() => serializeSubtitles([{start:0,end:Infinity,text:'bad'}]));
});
test('model paragraph breaks cannot introduce a new cue block during bilingual export', () => {
  const text = serializeSubtitles([{start:0,end:1000,text:'Source',translation:'First\n\n \nSecond'}]);
  assert.equal(parseSubtitles(text,'srt')[0].text,'Source\nFirst\nSecond');
});
test('parsed cues retain current and nearby group priority, seek cancels and blocks late callback', () => {
  const source = Array.from({length:30},(_,i)=>`${i+1}\n00:00:${String(i).padStart(2,'0')},000 --> 00:00:${String(i+1).padStart(2,'0')},000\nLine ${i}`).join('\n\n');
  const cues = parseSubtitles(source,'srt'); assert.deepEqual(groupPriority(cues,17300).map(g=>g.index),[3,4,2,5,1,0]);
  const calls=[]; const scheduler = new SubtitleScheduler({cues,request:{},service:{translateBatch(req,cb){ const handle={cancel(){handle.cancelled=true;}};calls.push({req,cb,handle});return handle;}}});
  scheduler.seek(17300); scheduler.seek(1200); assert.equal(calls[0].handle.cancelled,true); assert.equal(calls[1].req.items[0].id,'subtitle-0');
  calls[0].cb([{id:'subtitle-17',text:'late'}]); assert.equal(cues[17].translation,null); scheduler.stop();
});

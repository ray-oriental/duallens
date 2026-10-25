import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserscriptOCR } from '../../extension/userscript/lazy-ocr.js';

test('language cache management does not read the optional feature or OCR resources',async()=>{
  let reads=0;
  const records={eng:{bytes:4113088},jpn:{bytes:2471260},'runtime:duallensOcrCore':{bytes:123},unknown:{bytes:1}};
  const ocr=createUserscriptOCR({getResourceText(){reads++;throw Error('must stay lazy');},
    storage:{async get(){return {...records};},async remove(key){delete records[key];}}});
  assert.deepEqual(await ocr.languages(),{ok:true,languages:[{lang:'eng',bytes:4113088},{lang:'jpn',bytes:2471260}]});
  assert.deepEqual(await ocr.languages('invalid'),{ok:false});
  assert.deepEqual(await ocr.languages('eng'),{ok:true,languages:[{lang:'jpn',bytes:2471260}]});
  assert.ok(records['runtime:duallensOcrCore']);assert.equal(reads,0);
});

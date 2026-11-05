import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfPopupState } from '../../extension/ui/pdf-entry.js';

const reader = 'chrome-extension://test/pdf/viewer.html';
test('PDF popup separates known PDFs from hidden metadata without guessing local files', () => {
  for (const access of [false,true]) {
    for (const [url,restricted,check] of [
      ['file:///D:/%E6%B5%8B%E8%AF%95%20folder/Thursday%20Work.pdf',true,true],
      ['file:///D:/notes.txt',true,true], ['https://example.com/a.PDF?x#page=1',false,true],
      ['http://example.com/page',false,false], ['https://example.com/a.pdf.exe',false,false],
      ['edge://settings/',true,true], ['chrome://newtab/',true,true], ['about:blank',true,true],
      [undefined,true,true], [reader+'?token=test',false,false],
    ]) {
      const state=pdfPopupState({id:7,url},reader,access);
      assert.equal(state.restricted,restricted,String(url));
      assert.equal(state.check,check,String(url));
      assert.equal(state.localHelp,!url&&!access,String(url));
    }
    assert.equal(pdfPopupState(null,reader,access).localHelp,false);
    assert.equal(pdfPopupState(null,reader,access).check,false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfImageWriter } from '../../extension/pdf/writer.js';
import { parsePageRange, exportFilename } from '../../extension/pdf/ranges.js';
import { ocrLanguage, ocrSegments } from '../../extension/pdf/ocr.js';
import { abortable, runExport, waitForTranslations } from '../../extension/pdf/export-job.js';
import { createPDFEntries } from '../../extension/background/pdf.js';

test('PDF export range validation is strict, bounded, sorted and deduplicated', () => {
  assert.deepEqual(parsePageRange(' 8, 1-3, 2 ', 8), [1,2,3,8]);
  assert.deepEqual(parsePageRange('', 3), [1,2,3]);
  for (const range of ['0','9','5-1','1,,2','1,','-1','1.2','1-','1 2','1-3-4']) assert.throws(()=>parsePageRange(range,8));
  assert.throws(()=>parsePageRange('',2001));
  assert.equal(exportFilename('folder/report.PDF','side'),'report.bilingual.pdf');
  assert.equal(exportFilename('', 'translated'),'document.translated.pdf');
  assert.equal(exportFilename('../x:bad?.pdf', 'translated'),'x_bad_.translated.pdf');
});

// Original one-pixel RGB JPEG: zero DCT coefficients, one-symbol DC/AC tables.
// This is a real decodable image, constructed here without a font/image dependency.
const jpeg = new Uint8Array([255,216,
  255,219,0,67,0,...Array(64).fill(1),
  255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,
  255,196,0,38,0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0,
  255,218,0,12,3,1,0,2,0,3,0,0,63,0,3,255,217]);
const image = { jpeg,width:1,height:1,x:0,y:0,drawWidth:612,drawHeight:792 };
const page = {width:1224,height:792,images:[image,{...image,x:612}]};

test('PDF image writer creates byte-exact streams, xref offsets and readable page objects', async () => {
  const writer=new PdfImageWriter();writer.addPage(page);writer.addPage({...page,width:612,images:[image]});
  const blob=writer.finish(),data=new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type,'application/pdf');
  const text=new TextDecoder('latin1').decode(data);
  const xref=Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(new TextDecoder().decode(data.subarray(xref,xref+4)),'xref');
  const lines=text.slice(xref).split('\n');
  const count=Number(lines[1].split(' ')[1]);
  for(let id=1;id<count;id++) {
    const offset=Number(lines[id+2].slice(0,10));
    assert.equal(new TextDecoder().decode(data.subarray(offset,offset+`${id} 0 obj`.length)),`${id} 0 obj`);
  }
  assert.equal((text.match(/\/Subtype \/Image/g)||[]).length,3);
  // Parsing needs no rendering library. PDF.js initializes a matrix used only by rendering.
  globalThis.DOMMatrix ??= class DOMMatrix {};
  const lib=await import('../../extension/vendor/pdfjs/pdf.min.js');
  lib.GlobalWorkerOptions.workerSrc=new URL('../../extension/vendor/pdfjs/pdf.worker.min.js',import.meta.url).href;
  const task=lib.getDocument({data,isEvalSupported:false,useSystemFonts:true});
  try {
    const pdf=await task.promise;assert.equal(pdf.numPages,2);
    const first=await pdf.getPage(1),second=await pdf.getPage(2);
    assert.deepEqual(first.view,[0,0,1224,792]);
    assert.deepEqual(second.view,[0,0,612,792]);
    const images=async page=>(await page.getOperatorList()).fnArray.filter(op=>op===lib.OPS.paintImageXObject).length;
    assert.equal(await images(first),2);assert.equal(await images(second),1);
  } finally { await task.destroy(); }
  assert.throws(()=>writer.addPage(page));
});

test('PDF writer rejects invalid geometry, bytes and empty/discarded jobs', () => {
  for(const bad of [{...page,width:NaN},{...page,height:-1},{...page,images:[]},
    {...page,images:[{...image,x:-1}]},{...page,images:[{...image,jpeg:new Uint8Array(4)}]}])
    assert.throws(()=>new PdfImageWriter().addPage(bad));
  const writer=new PdfImageWriter();assert.throws(()=>writer.finish());writer.discard();assert.throws(()=>writer.finish());
});

test('PDF OCR conversion bounds coordinates, preserves uncertain pixels and escapes source later', () => {
  const regions=[{text:'Good <text>',confidence:92,bbox:{x0:.1,y0:.2,x1:.8,y1:.25}},
    {text:'Uncertain',confidence:40,bbox:{x0:.1,y0:.3,x1:.7,y1:.35}},
    {text:'Invalid',confidence:99,bbox:{x0:-1,y0:0,x1:1,y1:1}},
    {text:'Bad',confidence:NaN,bbox:{x0:0,y0:0,x1:1,y1:1}}];
  const result=ocrSegments(regions,600,800);
  assert.equal(result.blocks.length,2);assert.equal(result.blocks[0].kind,'text');assert.equal(result.blocks[1].kind,'other');
  assert.equal(result.blocks[0].box.left,60);assert.equal(result.blocks[0].box.top,160);
  assert.equal(result.blocks[0].parts[0].text,'Good <text>');
  assert.equal(ocrLanguage('ja'),'jpn');assert.equal(ocrLanguage('ko-KR'),'kor');assert.equal(ocrLanguage('auto'),'eng');
});

test('PDF export cancellation/failure never downloads a partial file and disposes the writer', async () => {
  for(const kind of ['abort','error']) {
    const ctrl=new AbortController(),writer=new PdfImageWriter();let downloads=0,renders=0;
    await assert.rejects(runExport({pages:[1,2],writer,signal:ctrl.signal,download:()=>downloads++,render:async()=>{
      renders++;if(kind==='error')throw new Error('test');ctrl.abort();return page;
    }}));
    assert.equal(downloads,0);assert.equal(renders,1);assert.equal(writer.objects.length,0);
  }
  const ctrl=new AbortController();ctrl.abort();
  await assert.rejects(waitForTranslations({get:()=>({state:'pending'})},['x'],ctrl.signal),{name:'AbortError'});
  await assert.rejects(waitForTranslations({get:()=>({state:'error'})},['x'],new AbortController().signal));
});

test('PDF export reuses terminal translations, waits through drafts and downloads once', async () => {
  let state='draft';setTimeout(()=>state='final',10);
  await waitForTranslations({get:()=>({state})},['x'],new AbortController().signal);
  const order=[],writer=new PdfImageWriter();let downloads=0;
  await runExport({pages:[2,4],writer,signal:new AbortController().signal,render:async n=>{order.push(n);return page;},download:blob=>{assert.equal(blob.type,'application/pdf');downloads++;}});
  assert.deepEqual(order,[2,4]);assert.equal(downloads,1);
});

test('PDF OCR bridge rejects webpage/raster abuse before creating any offscreen document', async () => {
  let calls=0;
  const api={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,
    getContexts:()=>{calls++;throw new Error('unexpected');}}};
  const handlers=createPDFEntries(api).handlers,job={jobId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',lang:'eng',base64:'test'};
  for(const sender of [{id:'test',url:'https://example.com/'},{id:'other',url:'chrome-extension://test/pdf/viewer.html'}])
    assert.equal((await handlers['pdf-ocr'](job,sender)).ok,false);
  const sender={id:'test',url:'chrome-extension://test/pdf/viewer.html'};
  for(const bad of [{...job,lang:'unknown'},{...job,jobId:'../bad'},{...job,base64:'x'.repeat(24*1024*1024+1)}])
    assert.equal((await handlers['pdf-ocr'](bad,sender)).ok,false);
  assert.equal(calls,0);
});

test('PDF abortable OCR waits reject promptly and ignore late completion', async () => {
  const ctrl=new AbortController();let finish;
  const wait=abortable(new Promise(resolve=>finish=resolve),ctrl.signal);
  ctrl.abort();await assert.rejects(wait,{name:'AbortError'});finish('late');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText,cleanRegions,readingOrder } from '../../extension/content/comics/order.js';
import { sourceFor,imageURL,discoverImages } from '../../extension/content/comics/discovery.js';
import { probeLocalOCR,createGMImageFetch } from '../../extension/content/comics/capabilities.js';
import { fetchImage,createComicHandlers } from '../../extension/background/comics.js';
import { verifyLanguage } from '../../extension/offscreen/language-store.js';
import { detectTextRegions } from '../../extension/offscreen/detector.js';
import { CORE_SOURCE,WORKER_SOURCE } from '../../extension/vendor/tesseract/userscript-sources.js';
import { LANGUAGES } from '../../extension/content/comics/languages.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const region=(text,x,y,panel)=>({text,confidence:90,bbox:{x0:x,y0:y,x1:x+.15,y1:y+.08},panel});
test('comic text cleanup removes control noise and joins vertical Japanese without removing markup text',()=>{
  assert.equal(cleanText(' あ\nい\u200b ','jpn_vert'),'あい');
  assert.equal(cleanText('Hello\n world'),'Hello world');assert.equal(cleanText(' !!! '),'');
  assert.equal(cleanText('<script>hello</script>'),'<script>hello</script>');
  assert.equal(cleanRegions([region('a',.1,.1),{...region('b',.3,.2),confidence:20},{...region('c',.2,.2),bbox:{x0:-1,y0:0,x1:.2,y1:.1}}],'eng').length,1);
});
test('comic page bands use Japanese RTL and English/Korean LTR, preserving input',()=>{
  const input=[region('left',.1,.1),region('right',.6,.12),region('bottom',.2,.6)];
  assert.deepEqual(readingOrder(input,{lang:'jpn'}).regions.map(r=>r.text),['right','left','bottom']);
  for(const lang of ['eng','kor']) assert.deepEqual(readingOrder(input,{lang}).regions.map(r=>r.text),['left','right','bottom']);
  assert.deepEqual(input.map(r=>r.text),['left','right','bottom']);assert.ok(readingOrder(input).uncertain);
});
test('webtoon follows y and explicit panel grouping precedes within-panel bubbles',()=>{
  assert.deepEqual(readingOrder([region('second',.1,.16),region('first',.6,.1)],{lang:'kor',width:1,height:4}).regions.map(r=>r.text),['first','second']);
  const result=readingOrder([region('a1',.7,.1,'a'),region('b1',.1,.1,'b'),region('a2',.7,.3,'a')],{lang:'jpn'});
  assert.deepEqual(result.regions.map(r=>r.text),['a1','a2','b1']);assert.equal(result.uncertain,false);
});
const img=(attrs,currentSrc='')=>({currentSrc,getAttribute:k=>attrs[k]});
test('image discovery prefers selected currentSrc and lazy URLs, restricts protocols and credentials',()=>{
  assert.equal(sourceFor(img({src:'old.png',srcset:'a.png 1x,b.png 2x'},'https://test/new.png'),'https://test/'),'https://test/new.png');
  assert.equal(sourceFor(img({'data-src':'lazy.png',src:'small.png'}),'https://test/'),'https://test/lazy.png');
  assert.equal(sourceFor(img({srcset:'a.png 1x, b.png 2x'}),'https://test/'),'https://test/b.png');
  for(const url of ['javascript:alert(1)','data:image/png;base64,x','https://u:p@test/img']) assert.equal(imageURL(url,'https://test/'),'');
});
test('discovery includes viewport and only one next image, excludes tiny, hidden and distant images',()=>{
  const make=(top,width=300,hidden=false)=>({...img({src:`${top}.png`}),tagName:'IMG',naturalWidth:300,naturalHeight:400,
    closest:()=>false,getBoundingClientRect:()=>({left:0,right:width,top,bottom:top+400,width,height:400}),hidden});
  const nodes=[make(0),make(850),make(1000),make(3000),make(100,10),make(100,300,true)];
  const doc={baseURI:'https://test/',querySelectorAll:()=>nodes,defaultView:{innerWidth:1000,innerHeight:800,getComputedStyle:el=>({display:el.hidden?'none':'block',visibility:'visible',opacity:'1'})}};
  assert.deepEqual(discoverImages(doc,{onlyImg:true}).map(r=>r.top),[0,850]);
});
test('capability probe returns clear CSP/unavailable failures without throwing',async()=>{
  assert.equal((await probeLocalOCR({})).ok,false);
  assert.equal((await probeLocalOCR({Worker(){},WebAssembly:{compile:async()=>{throw Error('CSP');}}})).ok,false);
  assert.equal((await probeLocalOCR({Worker(){},WebAssembly})).ok,true);
});
test('GM image request is anonymous blob-only and reports 403 without a retry',async()=>{
  let calls=0;
  const request=createGMImageFetch(req=>{calls++;assert.equal(req.responseType,'blob');assert.equal(req.anonymous,true);assert.equal(req.headers,undefined);req.onload({status:403});});
  await assert.rejects(request('https://test/img'),/403/);assert.equal(calls,1);
});
test('background image fetch uses sender referrer, no cookies, no redirects, validates format and 403',async()=>{
  let request;
  const fetcher=async(url,opts)=>{request={url,opts};return new Response(new Uint8Array([1,2]),{headers:{'content-type':'image/png'}});};
  assert.equal((await fetchImage('https://test/img','https://page/read',fetcher)).base64,'AQI=');
  assert.equal(request.opts.referrer,'https://page/read');assert.equal(request.opts.credentials,'omit');assert.equal(request.opts.redirect,'error');assert.equal(request.opts.headers,undefined);
  await assert.rejects(fetchImage('https://test/img','https://page/read',async()=>new Response('',{status:403})),/403/);
  await assert.rejects(fetchImage('https://test/img','https://page/read',async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})),/格式/);
  await assert.rejects(fetchImage('file:///img','https://page/read',fetcher),/地址/);
});
test('traineddata integrity rejects tampering and unexpected byte length',async()=>{
  const data=new Uint8Array([1,2]).buffer;
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex');
  await verifyLanguage(data,{bytes:2,sha256:hash});
  await assert.rejects(verifyLanguage(data,{bytes:3,sha256:hash}),/大小/);
  await assert.rejects(verifyLanguage(data,{bytes:2,sha256:'0'.repeat(64)}),/SHA-256/);
});
test('connected ink baseline groups horizontal/vertical lettering and discards panel frames',()=>{
  const make=()=>({width:100,height:100,data:new Uint8ClampedArray(100*100*4).fill(255)});
  const paint=(image,x,y,w,h)=>{for(let a=y;a<y+h;a++) for(let b=x;b<x+w;b++){const i=(a*100+b)*4;image.data[i]=image.data[i+1]=image.data[i+2]=0;}};
  const horizontal=make();paint(horizontal,1,1,98,1);paint(horizontal,1,1,1,98);paint(horizontal,98,1,1,98);paint(horizontal,1,98,98,1);
  for(const x of [10,20,30]) paint(horizontal,x,10,6,10);
  for(const x of [10,20,30]) paint(horizontal,x,60,6,10);
  assert.equal(detectTextRegions(horizontal).length,2);
  const vertical=make();for(const y of [10,30,50]) paint(vertical,60,y,10,10);
  assert.equal(detectTextRegions(vertical,{vertical:true}).length,1);
  assert.deepEqual(detectTextRegions(make()),[]);
});
test('userscript executable source strings are lossless upstream assets and fixed language catalog agrees',()=>{
  for(const [source,file] of [[CORE_SOURCE,'tesseract-core-simd-lstm.wasm.js'],[WORKER_SOURCE,'worker.min.js']]) {
    const actual=readFileSync(new URL('../../extension/vendor/tesseract/'+file,import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'),createHash('sha256').update(actual).digest('hex'));
  }
  assert.deepEqual(LANGUAGES,JSON.parse(readFileSync(new URL('../../extension/offscreen/languages.json',import.meta.url),'utf8')));
});
test('comic transport gate bounds all-tab fetching/OCR concurrency to two and rejects subframes',async()=>{
  const originalFetch=globalThis.fetch;let active=0,peak=0;
  globalThis.fetch=async()=> {active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,5));active--;return new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}});};
  const api={runtime:{getContexts:async()=>[{}],sendMessage:async()=>({ok:true,regions:[]})},offscreen:{createDocument:async()=>{}}};
  const handlers=createComicHandlers(api),sender={tab:{url:'https://page/'},url:'https://page/',frameId:0};
  try {
    await assert.rejects(handlers['comic-ocr']({lang:'eng',url:'https://image/'},{...sender,frameId:1}),/无效/);
    await Promise.all(Array.from({length:5},()=>handlers['comic-ocr']({lang:'eng',url:'https://image/'},sender)));
    assert.equal(peak,2);
  } finally {globalThis.fetch=originalFetch;}
});

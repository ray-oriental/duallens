import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfURL,hasPDFExtension,isPDFType,createPDFEntries,probePDFType } from '../../extension/background/pdf.js';
import { readPDFURL,checkPDFBytes,MAX_PDF_BYTES } from '../../extension/pdf/source.js';
const bytes = new TextEncoder().encode('%PDF-1.4\nfixture');
test('PDF entry accepts only document protocols, rejects embedded credentials', () => {
  for (const u of ['javascript:alert(1)','data:application/pdf,x','https://u:p@example.org/a.pdf','chrome://settings','not-a-url']) assert.equal(pdfURL(u),'');
  assert.equal(hasPDFExtension('https://example.org/a.PDF?download=1#page=2'),true);
  assert.equal(hasPDFExtension('https://example.org/a.pdf.exe'),false);
  assert.equal(isPDFType('application/pdf; charset=binary'),true);
  assert.equal(isPDFType('application/pdf-malicious'),false);
});
test('PDF source enforces signature, size, local permission and anonymous no-redirect fetch', async () => {
  assert.throws(()=>checkPDFBytes(new Uint8Array()),/64 MiB/);
  assert.throws(()=>checkPDFBytes(new TextEncoder().encode('<html>login')),/有效/);
  await assert.rejects(readPDFURL('file:///C:/fixture.pdf'),/允许访问/);
  await assert.rejects(readPDFURL('https://u:p@example.org/a.pdf'),/账号密码/);
  let options;
  const data=await readPDFURL('https://example.org/a.pdf',{fetchImpl:async(u,o)=>{options=o;return new Response(bytes);}});
  assert.deepEqual(data,bytes); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
  await assert.rejects(readPDFURL('https://example.org/a.pdf',{fetchImpl:async()=>new Response(bytes,{headers:{'Content-Length':String(MAX_PDF_BYTES+1)}})}),/64 MiB/);
  await assert.rejects(readPDFURL('https://example.org/a.pdf',{fetchImpl:async()=>new Response('login',{status:403})}),/无法读取/);
});
test('PDF streamed data stops at the size limit', async () => {
  let canceled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PDF_BYTES));c.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
  await assert.rejects(readPDFURL('https://example.org/a.pdf',{fetchImpl:async()=>new Response(stream)}),/64 MiB/);
  assert.ok(canceled);
});
test('PDF explicit probes and opens validate the actual tab, not supplied document URL', async () => {
  const noop={addListener(){}}; const opened=[]; const updates=[];
  let tab={id:7,url:'https://example.org/a.pdf'};
  const api={runtime:{getURL:p=>'chrome-extension://test/'+p},tabs:{get:async()=>tab,query:async()=>[tab],create:async x=>opened.push(x),onRemoved:noop,onActivated:noop,onUpdated:noop},contextMenus:{update:async(...x)=>updates.push(x)}};
  let count=0, stored;
  const sender={url:'chrome-extension://test/ui/popup.html'};
  const entries=createPDFEntries(api,async(u,o)=>{
    assert.equal(u,tab.url);assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
    if(o.method==='HEAD'){count++;return new Response(null,{headers:{'Content-Type':'application/pdf'}});}
    return new Response(bytes);
  },{async put(data){stored=data;return 'test-token';}});
  assert.ok((await entries.handlers['pdf-status']({tabId:7},sender)).available); assert.equal(count,0);
  assert.ok((await entries.handlers['pdf-open']({tabId:7,url:'https://evil.org/'},sender)).ok);
  assert.deepEqual(stored,bytes);
  assert.equal(opened[0].url,'chrome-extension://test/pdf/viewer.html?token=test-token');
  assert.equal((await entries.handlers['pdf-open']({tabId:7},{url:'https://page.example/'})).ok,false);
  tab={id:7,url:'https://example.org/download'};
  assert.ok((await entries.handlers['pdf-status']({tabId:7},sender)).available); assert.equal(count,1);
  assert.ok((await entries.handlers['pdf-status']({tabId:7},sender)).available); assert.equal(count,2);
  tab={id:7,url:'chrome://settings/'};
  assert.equal((await entries.handlers['pdf-open']({tabId:7},sender)).ok,false);
});
test('PDF entry installs no observation listeners and creates no startup requests', async () => {
  let calls=0; const opened=[];
  const forbidden=new Proxy({}, {get(){throw new Error('Background observation forbidden');}});
  const api={webRequest:forbidden,contextMenus:forbidden,
    tabs:{get:async()=>({id:1,url:'https://example.org/page'}),create:async x=>opened.push(x)},
    runtime:{getURL:path=>'chrome-extension://test/'+path}};
  const entries=createPDFEntries(api,async()=>{calls++;return new Response('',{headers:{'Content-Type':'text/html'}});});
  assert.equal(calls,0); assert.notEqual(entries.menu.enabled,false);
  assert.equal((await entries.openFromMenu({id:1,url:'https://example.org/page'})).ok,false);
  assert.equal(calls,1);
  assert.equal(opened[0].url,'chrome-extension://test/pdf/viewer.html?notice=not-pdf');
});
test('PDF HEAD success uses only headers and declines non-PDF without GET', async () => {
  for(const [type,expected] of [['application/pdf',true],['text/html',false]]){
    let canceled=0; const calls=[];
    const result=await probePDFType('https://example.org/download',async(url,options)=>{
      calls.push(options);
      return new Response(new ReadableStream({cancel(){canceled++;}}),{headers:{'Content-Type':type}});
    });
    assert.equal(result,expected); assert.equal(calls.length,1); assert.equal(calls[0].method,'HEAD');
    assert.equal(canceled,1); assert.equal(calls[0].signal.aborted,true);
  }
});
test('PDF failed or untyped HEAD falls back to one anonymous Range GET and cancels unread data', async () => {
  for(const failure of ['network','405','missing-type']){
    const calls=[]; let reads=0; let canceled=0;
    const result=await probePDFType('https://example.org/download',async(url,options)=>{
      calls.push(options);
      assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
      assert.equal(options.cache,'no-store');
      if(options.method==='HEAD'){
        if(failure==='network') throw new Error('network');
        return new Response(null,{status:failure==='405'?405:200});
      }
      assert.deepEqual(options.headers,{Range:'bytes=0-1023'});
      // Deliberately ignore Range and advertise a whole, very large response.
      return new Response(new ReadableStream({pull(){reads++;},cancel(){canceled++;}},{highWaterMark:0}),
        {status:200,headers:{'Content-Type':'application/pdf','Content-Length':'999999999'}});
    });
    assert.equal(result,true); assert.equal(calls.length,2); assert.equal(reads,0); assert.equal(canceled,1);
    assert.ok(calls.every(c=>c.signal.aborted));
  }
});
test('PDF each request times out, HEAD timeout still permits bounded GET fallback', async () => {
  const calls=[];
  const result=await probePDFType('https://example.org/download',(url,options)=>new Promise((resolve,reject)=>{
    calls.push(options);
    options.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});
  }),5);
  assert.equal(result,false); assert.deepEqual(calls.map(c=>c.method),['HEAD','GET']);
  assert.ok(calls.every(c=>c.signal.aborted));
});
test('PDF GET failure or non-PDF response declines without retry', async () => {
  for(const failure of ['network','403','html']){
    const calls=[];
    assert.equal(await probePDFType('https://example.org/download',async(url,options)=>{
      calls.push(options.method);
      if(options.method==='HEAD') return new Response(null,{status:405});
      if(failure==='network') throw new Error('network');
      return new Response(null,{status:failure==='403'?403:200,headers:{'Content-Type':'text/html'}});
    }),false);
    assert.deepEqual(calls,['HEAD','GET']);
  }
});

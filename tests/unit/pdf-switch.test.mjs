import test from 'node:test';
import assert from 'node:assert/strict';
import { createPDFEntries } from '../../extension/background/pdf.js';
import { createTabCommandHandler } from '../../extension/background/tab-command.js';
import { identifyPDFTab, stagePDFTab, takePDFTabChunk, clearPDFTab, readPDFTab, PDF_CHUNK_BYTES } from '../../extension/background/pdf-tab-read.js';
import { MAX_PDF_BYTES } from '../../extension/pdf/source.js';
import { createPDFSessions } from '../../extension/pdf/session.js';
import { memoryDatabase } from '../helpers/indexed-db.mjs';
import { pdfPrivacy } from '../../extension/pdf/privacy.js';
import { ExtensionTranslateClient } from '../../extension/platform/port-client.js';
import { readFile } from 'node:fs/promises';

const bytes = new TextEncoder().encode('%PDF-1.4\nfixture');
const tab = { id: 7, url: 'https://example.com/download' };
const identity = { href: tab.url, contentType: 'application/pdf', documentId: 'document-1' };
function fixture({ type = 'application/pdf', denied = false, stage = {size:bytes.length}, failChunk = false, fetchImpl } = {}) {
  const calls = [], opened = [], stored = [], created = [];
  const api = { runtime: {getURL:path=>'chrome-extension://test/'+path},
    extension:{isAllowedFileSchemeAccess:async()=>false},
    tabs:{get:async()=>tab,update:async(id,options)=>{assert.equal(id,7);opened.push(options.url);},
      create:async options=>{created.push(options.url);}},
    scripting:{async executeScript(options) {
      calls.push(options);
      if (denied) throw new Error('no activeTab');
      if (options.func === identifyPDFTab) return [{result:{href:tab.url,contentType:type},documentId:'document-1'}];
      assert.deepEqual(options.target,{tabId:7,documentIds:['document-1']});
      if (options.func === stagePDFTab) return [{result:stage}];
      if (options.func === takePDFTabChunk) {
        if(failChunk)throw new Error('navigation');
        return [{result:Buffer.from(bytes).toString('base64')}];
      }
      return [{result:null}];
    }},
  };
  const entries=createPDFEntries(api,fetchImpl||(async()=>{throw new Error('no background fetch expected');}),
    {put:async(data,name)=>{stored.push({data,name});return 'handoff';},remove:async()=>{}});
  return {api,entries,calls,opened,stored,created};
}
test('PDF identity is authoritative, rejected injection alone permits anonymous probing', async()=>{
  for(const type of ['application/pdf','text/html']) {
    let network=0;
    const f=fixture({type,fetchImpl:async()=>{network++;return new Response(null,{headers:{'content-type':'application/pdf'}});}});
    assert.equal((await f.entries.status({...tab,url:'https://example.com/paper.pdf'})).available,type==='application/pdf');
    assert.equal(f.calls.length,1);
    assert.equal(network,0,'successful top-document inspection must precede suffix and network checks');
  }
  let probes=0;
  const f=fixture({denied:true,fetchImpl:async(_url,options)=>{probes++;assert.equal(options.method,'HEAD');return new Response(null,{headers:{'content-type':'application/pdf'}});}});
  assert.equal((await f.entries.status(tab)).available,true);assert.equal(probes,1);
});
test('tab bytes precede anonymous fetch, transfer cleanup runs and success stays in same tab', async()=>{
  const f=fixture();assert.equal((await f.entries.open(tab)).ok,true);
  assert.deepEqual(f.stored[0].data,bytes);
  assert.ok(f.opened[0].endsWith('?token=handoff'));
  assert.deepEqual(f.calls.map(c=>c.func),[identifyPDFTab,stagePDFTab,takePDFTabChunk,clearPDFTab]);
});
test('private PDF sources open a new reader with private=1 and retain the native PDF, including notices',async()=>{
  for(const options of [{},{stage:{error:'too-large'}},{failChunk:true,fetchImpl:async()=>{throw Error('410');}}]) {
    const f=fixture(options);
    await f.entries.open({...tab,incognito:true});
    assert.equal(f.opened.length,0);
    assert.equal(f.created.length,1);
    assert.equal(new URL(f.created[0]).searchParams.get('private'),'1');
  }
  const local=fixture();await local.entries.openLocal({...tab,incognito:true});
  assert.equal(new URL(local.created[0]).searchParams.get('private'),'1');assert.equal(local.opened.length,0);
});
test('private reader signals independently bypass all reading sessions and survive refresh without URL tokens',async()=>{
  for(const signal of ['query','extension','tab','marker']) {
    const storage=new Map(signal==='marker'?[['duallens.pdf.private','1']]:[]);
    const options={params:new URLSearchParams(signal==='query'?'private=1':''),inIncognitoContext:signal==='extension',tab:{incognito:signal==='tab'},
      storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessions:{get(){assert.fail('private read');},put(){assert.fail('private write');}}};
    const state=pdfPrivacy(options);assert.equal(state.privateSource,true);
    assert.equal(await state.sessions.get('inherited-session'),null);assert.equal(await state.sessions.put(bytes),null);
    assert.equal(state.cleanURL('/pdf/viewer.html'),'/pdf/viewer.html');
    const refreshed=pdfPrivacy({...options,params:new URLSearchParams(),inIncognitoContext:false,tab:{incognito:false}});
    assert.equal(refreshed.privateSource,true);
    let request;state.translator({translateBatch:r=>{request=r;}}).translateBatch({incognito:false,items:[]});
    assert.equal(request.incognito,true);
  }
  const noStorage=pdfPrivacy({params:new URLSearchParams('private=1'),storage:{getItem(){throw Error();},setItem(){throw Error();}}});
  assert.equal(noStorage.cleanURL('/pdf/viewer.html'),'/pdf/viewer.html?private=1');
  const sessions={},service={};const normal=pdfPrivacy({params:new URLSearchParams(),tab:{incognito:false},storage:{getItem:()=>null},sessions});
  assert.equal(normal.privateSource,false);assert.equal(normal.sessions,sessions);assert.equal(normal.translator(service),service);
});
test('private PDF requests carry incognito through the real extension port; normal callers retain their shape',()=>{
  const sent=[];const client=new ExtensionTranslateClient({runtime:{id:'test',connect:()=>({postMessage:m=>sent.push(m),onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}})}});
  const state=pdfPrivacy({params:new URLSearchParams('private=1'),storage:{getItem:()=>null,setItem(){}}});
  state.translator({translateBatch:r=>client.request(r,{})}).translateBatch({items:[{id:'a'}],incognito:false});
  assert.equal(sent[0].incognito,true);
  client.request({items:[],incognito:false},{});assert.equal(Object.hasOwn(sent[1],'incognito'),false);client.dispose();
});
test('worker port privacy merge can only become more private',async()=>{
  const source=await readFile(new URL('../../extension/background/service-worker.js',import.meta.url),'utf8');
  const expression=source.match(/incognito:([^\n]+?), items, priority/)[1];
  const merge=new Function('port','msg',`return (${expression});`);
  for(const sender of [undefined,{}, {tab:{}},{tab:{incognito:true}},{tab:{incognito:false}}]) {
    for(const incognito of [undefined,false,true]) assert.equal(merge({sender},{incognito}),sender?.tab?.incognito!==false||incognito===true);
  }
});
test('file selection checks the actual opt-in even if an older browser allows type inspection',async()=>{
  const f=fixture();
  f.api.scripting.executeScript=async()=>[{result:{href:'file:///fixture.pdf',contentType:'application/pdf'}}];
  const status=await f.entries.status({id:7,url:'file:///fixture.pdf'});
  assert.equal(status.requiresFileSelection,true);
  assert.equal((await f.entries.open({id:7,url:'file:///fixture.pdf'})).ok,true);
  assert.ok(f.opened[0].includes('notice=file-access'));assert.equal(f.stored.length,0);
});
test('every tab read failure falls back; too-large and read-failed open a notice tab and keep the PDF tab', async()=>{
  for(const options of [{stage:{error:'response'}},{stage:{error:'not-pdf'}},{failChunk:true},{denied:true}]) {
    let reads=0;
    const f=fixture({...options,fetchImpl:async(_url,o)=>{reads++;return new Response(o.method?null:bytes,{headers:{'content-type':'application/pdf'}});}});
    assert.equal((await f.entries.open(tab)).ok,true);assert.ok(reads>=1);
    if(!options.denied)assert.equal(f.calls.at(-1).func,clearPDFTab);
  }
  for(const stage of [{error:'too-large'},{size:MAX_PDF_BYTES+1}]) {
    const f=fixture({stage});
    assert.equal((await f.entries.open(tab)).error.code,'pdf_too_large');
    assert.equal(f.opened.length,0);
    assert.equal(new URL(f.created[0]).searchParams.get('notice'),'too-large');
    assert.equal(f.calls.at(-1).func,clearPDFTab);
  }
  const failed=fixture({failChunk:true,fetchImpl:async()=>{throw new Error('410');}});
  const result=await failed.entries.open(tab);
  assert.equal(result.ok,false);assert.equal(result.error.code,'pdf_source');
  assert.equal(failed.opened.length,0,'the original PDF tab must stay untouched after a failed read');
  const url=new URL(failed.created[0]);assert.equal(url.searchParams.get('notice'),'read-failed');
  assert.equal(url.searchParams.get('name'),'download');assert.equal(url.searchParams.has('file'),false);
});
test('large scripting results assemble 8 MiB raw chunks and cleanup on middle-chunk failure', async()=>{
  const large=new Uint8Array(2*PDF_CHUNK_BYTES+37);large.set(bytes);
  for(const fail of [false,true]) {
    const calls=[];
    const api={scripting:{async executeScript({func,args}) {
      calls.push({func,args});
      if(func===stagePDFTab)return [{result:{size:large.length}}];
      if(func===takePDFTabChunk){if(fail&&args[1]>0)throw new Error('lost document');return [{result:Buffer.from(large.subarray(args[1],args[1]+args[2])).toString('base64')}];}
      return [{result:null}];
    }}};
    if(fail)await assert.rejects(readPDFTab(api,7,identity));
    else {assert.deepEqual(await readPDFTab(api,7,identity),large);assert.deepEqual(calls.filter(c=>c.func===takePDFTabChunk).map(c=>c.args.slice(1)),[[0,PDF_CHUNK_BYTES],[PDF_CHUNK_BYTES,PDF_CHUNK_BYTES],[2*PDF_CHUNK_BYTES,37]]);}
    assert.equal(calls.at(-1).func,clearPDFTab);
  }
});
test('serialized tab functions use current authenticated cache, validate bytes, clean on final chunk and size overflow', async()=>{
  const old={location:globalThis.location,document:globalThis.document,fetch:globalThis.fetch};
  globalThis.location={href:tab.url};globalThis.document={contentType:'application/pdf'};
  let options;
  globalThis.fetch=async(url,o)=>{assert.equal(url,tab.url);options=o;return new Response(bytes);};
  try {
    assert.deepEqual(identifyPDFTab(),{href:tab.url,contentType:'application/pdf'});
    assert.deepEqual(await stagePDFTab('fixture-job',tab.url,MAX_PDF_BYTES),{size:bytes.length});
    assert.equal(options.credentials,'include');assert.equal(options.cache,'force-cache');assert.equal(options.redirect,'follow');
    assert.equal(takePDFTabChunk('fixture-job',0,bytes.length),Buffer.from(bytes).toString('base64'));
    assert.equal(globalThis['fixture-job'],undefined);
    await stagePDFTab('fixture-job',tab.url,MAX_PDF_BYTES);clearPDFTab('fixture-job');assert.equal(globalThis['fixture-job'],undefined);
    assert.deepEqual(await stagePDFTab('fixture-job',tab.url,1),{error:'too-large'});
    globalThis.fetch=async()=>new Response('login');assert.deepEqual(await stagePDFTab('fixture-job',tab.url,MAX_PDF_BYTES),{error:'not-pdf'});
    assert.equal(globalThis['fixture-job'],undefined);
    assert.deepEqual(await stagePDFTab('fixture-job','https://example.com/other',MAX_PDF_BYTES),{error:'changed'});
  } finally {for(const [key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
test('page menu and shortcut fallback share toggle handler; ordinary commands never open PDF',async()=>{
  const f=fixture();let ensured=0;
  const handle=createTabCommandHandler(f.api,{ensure:async()=>{ensured++;return {ok:false};}},f.entries);
  assert.equal(await handle(7,{type:'command',name:'toggle-translation-only'}),null);
  assert.equal(f.calls.length,0);
  await handle(7,{type:'command',name:'toggle-page'});
  assert.ok(f.opened[0].endsWith('&translate=1'));assert.equal(ensured,2);
  // Hidden-address tabs (new tab, browser pages) are never replaced by a shortcut or menu click.
  let local=0,probed;const hidden=createTabCommandHandler({tabs:{get:async()=>({id:7})}},{ensure:async()=>({ok:false})},
    {status:async(_tab,options)=>{probed=options;return {available:false};},fileAccess:async()=>false,openLocal:async()=>{local++;}});
  assert.equal(await hidden(7,{type:'command',name:'toggle-page'}),null);assert.equal(local,0);
  assert.deepEqual(probed,{probe:false},'shortcut and menu never send a network probe');
  const throwing=createTabCommandHandler({tabs:{get:async()=>{throw new Error('closed');}}},{ensure:async()=>({ok:false})},f.entries);
  assert.equal(await throwing(7,{type:'command',name:'toggle-page'}),null);
  const ordinary=createTabCommandHandler({tabs:{sendMessage:async()=>({ok:true})}},{ensure:async()=>({ok:true})},f.entries);
  assert.deepEqual(await ordinary(7,{type:'command',name:'toggle-page'}),{ok:true});
});
test('sessions restore bytes/name, overwrite on file change, keep three newest and logically expire after 24 hours',async()=>{
  const memory=memoryDatabase();let clock=1000,sequence=0;
  const store=createPDFSessions({database:memory.database,now:()=>clock,randomUUID:()=>`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`});
  const first=await store.put(bytes,'first.pdf',{tabId:7});
  assert.deepEqual(await store.get(first),{bytes,name:'first.pdf',tabId:7});
  clock++;
  assert.equal(await store.put(bytes,'changed.pdf',{id:first,tabId:7}),first);assert.equal(memory.records.size,1);
  assert.equal((await store.get(first)).name,'changed.pdf');
  clock++;const second=await store.put(bytes,'second',{tabId:8});clock++;await store.put(bytes,'third');clock++;await store.put(bytes,'fourth');
  assert.equal(memory.records.size,3);assert.equal(await store.get(first),null);
  await store.removeTab(8);assert.equal(await store.get(second),null);assert.equal(memory.records.size,2);
  clock+=24*60*60*1000;assert.equal(await store.prune(),2);assert.equal(memory.records.size,0);
  const expired=await store.put(bytes);clock+=24*60*60*1000;assert.equal(await store.get(expired),null);
  await assert.rejects(store.put(new Uint8Array(MAX_PDF_BYTES+1)));assert.equal(await store.get('bad-id'),null);
});
test('session worker lifecycle prunes on startup/install and deletes the removed tab only',async()=>{
  const listeners={},seen=[];
  createPDFEntries({runtime:{onStartup:{addListener:f=>listeners.start=f},onInstalled:{addListener:f=>listeners.install=f}},tabs:{onRemoved:{addListener:f=>listeners.remove=f}}},undefined,
    {prune:async()=>seen.push('handoff')},{prune:async()=>seen.push('session'),removeTab:async id=>seen.push(id)});
  await listeners.start();await listeners.install();await listeners.remove(7);
  assert.ok(seen.filter(v=>v==='session').length>=3);assert.equal(seen.at(-1),7);
});

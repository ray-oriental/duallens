import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameRoots,frameRect,parentOwnsDocument} from '../../extension/content/frames.js';
import {createFrameHandlers} from '../../extension/background/frames.js';
import {startFrameAgent} from '../../extension/content/frame-agent.js';

function doc() {
  const d={contentType:'text/html',body:{},frames:[],styles:[],querySelectorAll(){return this.frames;}};
  const head={append(s){s.isConnected=true;d.styles.push(s);}};
  d.head=head;d.documentElement=head;
  d.createElement=()=>({isConnected:false,remove(){this.isConnected=false;}});
  d.defaultView={innerWidth:400,innerHeight:200,addEventListener(){},removeEventListener(){},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  return d;
}
function frame(parent,child,width=400,height=200) {
  const f={localName:'iframe',ownerDocument:parent,contentDocument:child,parentElement:null,clientLeft:0,clientTop:0,offsetWidth:width,offsetHeight:height,
    getBoundingClientRect:()=>({left:50,top:100,right:50+width,bottom:100+height,width,height}),
    listeners:new Set(),addEventListener(_n,fn){this.listeners.add(fn);},removeEventListener(_n,fn){this.listeners.delete(fn);}};
  if(child)child.defaultView.frameElement=f;
  parent.frames.push(f);return f;
}

test('frame roots discover nested blank/srcdoc documents once, skip tiny/cross-origin, and remove styles/listeners',()=>{
  const root=doc(),a=doc(),b=doc();const f=frame(root,a);frame(a,b);frame(root,a);frame(root,doc(),120,60);
  const cross=frame(root,null);Object.defineProperty(cross,'contentDocument',{get(){throw Error('cross-origin');}});
  const added=[],removed=[];
  const roots=new FrameRoots({doc:root,css:'dl-t{display:block}',added:d=>added.push(d),removed:d=>removed.push(d)});
  roots.update();roots.update();
  assert.deepEqual(added,[a,b]);assert.equal(a.styles.length,1);assert.equal(a.styles[0].textContent,'dl-t{display:block}');
  assert.equal(roots.entries.size,2);
  roots.stop();assert.deepEqual(removed,[a,b]);assert.equal(a.styles[0].isConnected,false);assert.equal(f.listeners.size,0);
});

test('only a top-frame publisher can broadcast the same public snapshot fields to its own tab',async()=>{
  const calls=[],state={active:true,confirmedDestinations:['mt:microsoft','mt:google'],settings:{displayMode:'bilingual'},context:{host:'top.example'}};
  const handler=createFrameHandlers({tabs:{async sendMessage(...args){calls.push(args);}}})['frame-publish'];
  for(const sender of [{},{tab:{id:7},frameId:1}])assert.deepEqual(await handler({state},sender),{ok:false});
  assert.deepEqual(await handler({state,tabId:99},{tab:{id:7},frameId:0}),{ok:true});
  assert.deepEqual(calls,[[7,{type:'frame-state',state}]]);
});

test('open/nested shadow roots share frame ownership, dedupe and stylesheet cleanup',()=>{
  const root=doc(),a=doc(),b=doc();
  const host={localName:'notice-card',shadowRoot:a};a.host=host;a.ownerDocument=root;
  const inner={localName:'inner-notice',shadowRoot:b};b.host=inner;b.ownerDocument=root;
  delete a.body;delete a.head;delete b.body;delete b.head;
  a.append=s=>a.documentElement.append(s);b.append=s=>b.documentElement.append(s);
  root.frames.push(host,host);a.frames.push(inner);
  const added=[],removed=[];
  const roots=new FrameRoots({doc:root,css:'dl-t{}',added:r=>added.push(r),removed:r=>removed.push(r)});
  roots.update();roots.update();assert.deepEqual(added,[a,b]);assert.equal(roots.entries.size,2);
  roots.stop();assert.deepEqual(removed,[a,b]);assert.ok(a.styles.every(s=>!s.isConnected));
});

test('inactive frame agent asks once; observer, resize, visibility and push events never poll',async()=>{
  const keys=['window','document','innerWidth','innerHeight','IntersectionObserver','ResizeObserver','MutationObserver'];
  const saved=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  const callbacks={};let requests=0,onMessage;
  try {
    const win=new EventTarget(),d=new EventTarget();win.parent={};Object.defineProperty(win.parent,'document',{get(){throw Error('other origin');}});
    d.documentElement={};d.hidden=false;globalThis.window=win;globalThis.document=d;globalThis.innerWidth=350;globalThis.innerHeight=200;
    for(const kind of ['Intersection','Resize','Mutation'])globalThis[kind+'Observer']=class {
      constructor(cb){callbacks[kind]=cb;}observe(){}unobserve(){}disconnect(){}
    };
    startFrameAgent({onMessage(cb){onMessage=cb;return ()=>{};},async frameSnapshot(){requests++;return {active:false};}});
    await Promise.resolve();
    callbacks.Intersection([{isIntersecting:true,intersectionRect:{width:350,height:200}}]);
    callbacks.Resize([{contentRect:{width:350,height:200}}]);
    win.dispatchEvent(new Event('resize'));d.dispatchEvent(new Event('visibilitychange'));
    onMessage({type:'frame-state',state:{active:false}});
    await Promise.resolve();assert.equal(requests,1);
  } finally {keys.forEach((key,i)=>saved[i]?Object.defineProperty(globalThis,key,saved[i]):delete globalThis[key]);}
});

test('document replacement and document.open body replacement trigger removal and a fresh scan',()=>{
  const root=doc(),a=doc(),b=doc();const f=frame(root,a);const events=[];
  const roots=new FrameRoots({doc:root,css:'styles',added:d=>events.push(['add',d]),removed:d=>events.push(['remove',d])});
  roots.update();a.body={};roots.update();
  assert.deepEqual(events.map(e=>e[0]),['add','remove','add']);
  assert.equal(a.styles[0].isConnected,false);assert.equal(a.styles[1].isConnected,true);
  f.contentDocument=b;roots.update();
  assert.ok(events.some(([type,d])=>type==='add'&&d===b));
  assert.equal(a.styles[1].isConnected,false);roots.stop();
});

test('frame range coordinates clip to local viewport and include parent offsets; ownership respects origin',()=>{
  const root=doc(),a=doc();frame(root,a);
  assert.deepEqual(frameRect({left:10,right:100,top:20,bottom:400},a,root),{left:60,right:150,top:120,bottom:300});
  const top={};top.parent=top;assert.equal(parentOwnsDocument(top),false);
  assert.equal(parentOwnsDocument({parent:{document:{}}}),true);
  const win={};Object.defineProperty(win,'parent',{get(){throw Error('denied');}});assert.equal(parentOwnsDocument(win),false);
});

test('frame routing trusts only browser sender tab/frame identity and fails closed',async()=>{
  const calls=[],snapshot={active:true,context:{host:'top.example'}};
  const handler=createFrameHandlers({tabs:{async sendMessage(...args){calls.push(args);return snapshot;}}})['frame-snapshot'];
  for(const sender of [{},{tab:{id:1}},{tab:{id:1},frameId:0},{tab:{id:1},frameId:-1}])assert.deepEqual(await handler({},sender),{active:false});
  assert.equal(calls.length,0);
  assert.equal(await handler({tabId:99,frameId:88},{tab:{id:7},frameId:2}),snapshot);
  assert.deepEqual(calls,[[7,{type:'frame-top-state'},{frameId:0}]]);
  const failed=createFrameHandlers({tabs:{sendMessage(){throw Error('no top controller');}}})['frame-snapshot'];
  assert.deepEqual(await failed({},{tab:{id:7},frameId:2}),{active:false});
});

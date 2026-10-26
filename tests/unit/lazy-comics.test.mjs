import test from 'node:test';
import assert from 'node:assert/strict';
import { ComicTranslator } from '../../extension/userscript/lazy-comics.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(load){
  const view=new EventTarget(),settings={comics:{enabled:true}},doc={defaultView:view,location:{href:'https://example.com/reader'}};
  let created=0,starts=0,restores=0,reads=0,errors=0;
  class RealComic {
    constructor(){created++;this.panels=new Map([['image',{}]]);}
    start(){starts++;return 1;}
    restore(){restores++;this.panels.clear();}
    state(){return ['fixture'];}
  }
  const wrapper=new ComicTranslator({doc,getSettings:()=>settings,platform:{}},{probe:async()=>({ok:true}),
    load:async()=>{reads++;return load?load({ComicTranslator:RealComic}):{ComicTranslator:RealComic};},report:()=>errors++});
  return {wrapper,doc,settings,view,get counts(){return {created,starts,restores,reads,errors};}};
}

test('comic resource stays unloaded at startup/disabled and delegates only after an explicit command',async()=>{
  const f=fixture();await flush();assert.equal(f.counts.reads,0);assert.equal(f.wrapper.panels.size,0);
  f.settings.comics.enabled=false;f.wrapper.start();await flush();assert.equal(f.counts.reads,0);
  f.settings.comics.enabled=true;f.wrapper.start();f.wrapper.start();assert.equal(f.wrapper.panels.size,1);
  await flush();assert.deepEqual(f.counts,{created:1,starts:1,restores:0,reads:1,errors:0});
  assert.deepEqual(f.wrapper.state(),['fixture']);f.wrapper.start();assert.equal(f.counts.starts,2);assert.equal(f.counts.reads,1);
  f.wrapper.restore();assert.equal(f.wrapper.panels.size,0);assert.equal(f.counts.restores,1);
});

for(const cancel of ['restore','disable','navigation','pagehide'])test(`pending comic load cannot translate after ${cancel}`,async()=>{
  let complete;
  const f=fixture(module=>new Promise(resolve=>{complete=()=>resolve(module);}));
  f.wrapper.start();await flush();assert.equal(f.counts.reads,1);
  if(cancel==='restore')f.wrapper.restore();
  if(cancel==='disable'){f.settings.comics.enabled=false;f.wrapper.restore();}
  if(cancel==='navigation')f.doc.location.href='https://example.com/next';
  if(cancel==='pagehide')f.view.dispatchEvent(new Event('pagehide'));
  complete();await flush();assert.equal(f.counts.created,0);assert.equal(f.counts.starts,0);assert.equal(f.wrapper.panels.size,0);
});

test('failed resources leave no panels and can be retried by a new explicit command',async()=>{
  let bad=true;
  const f=fixture(module=>{if(bad)throw Error('untrusted');return module;});
  f.wrapper.start();await flush();assert.equal(f.counts.errors,1);assert.equal(f.counts.created,0);assert.equal(f.wrapper.panels.size,0);
  bad=false;f.wrapper.start();await flush();assert.equal(f.counts.reads,2);assert.equal(f.counts.created,1);
});

test('CSP fallback respects image opt-outs, visibility and comic dimensions without loading a resource',async()=>{
  const view=Object.assign(new EventTarget(),{innerWidth:375,innerHeight:812,getComputedStyle:image=>image.style});
  const image=(change={})=>({closest:()=>!!change.excluded,style:{visibility:'visible',opacity:'1',...change.style},
    getBoundingClientRect:()=>({width:340,height:420,top:0,bottom:420,left:0,right:340,...change.rect})});
  const doc={defaultView:view,location:{href:'https://example.com/reader'},images:[image({excluded:true}),
    image({rect:{width:100}}),image({rect:{height:100}}),image({rect:{top:900,bottom:1320}}),
    image({rect:{left:-400,right:-60}}),image({style:{visibility:'hidden'}}),image({style:{opacity:'0'}})]};
  let reads=0,errors=0;
  const wrapper=new ComicTranslator({doc,getSettings:()=>({comics:{enabled:true}}),platform:{}},{
    probe:async()=>({ok:false,reason:'CSP fixture'}),load:async()=>{reads++;},report:()=>errors++});
  wrapper.start();await flush();assert.equal(reads,0);assert.equal(errors,0);assert.equal(wrapper.panels.size,0);
});

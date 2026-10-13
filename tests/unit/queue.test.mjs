import{test}from'node:test';import assert from'node:assert/strict';
import{createQueue}from'../../extension/background/queue.js';
import{ERR,err,sleep,testProfile}from'./helpers.mjs';
const make=over=>createQueue({cooldownMs:40,baseBackoffMs:10,maxBackoffMs:30,...over});
test('provider concurrency cap and FIFO within priority',async()=>{
 const q=make(),profile=testProfile({concurrency:1});const order=[];let release;
 const gate=new Promise(r=>release=r);const first=q.enqueue({profile,run:async()=>{await gate;order.push('first');}});
 const rest=[q.enqueue({profile,priority:2,run:async()=>order.push('later')}),q.enqueue({profile,priority:0,run:async()=>order.push('visible')})];
 release();await Promise.all([first,...rest]);assert.deepEqual(order,['first','visible','later']);
});
test('one 429 skips primary immediately and preserves model cooldown',async()=>{
 const q=make(),profile=testProfile(),seen=[];const start=Date.now();
 const value=await q.enqueue({profile,run:async({model})=>{seen.push(model);if(model==='m1')throw err(ERR.RATE_LIMITED,'429',{retryAfterMs:1000});return model;}});
 assert.equal(value,'m2');assert.deepEqual(seen,['m1','m2']);assert.ok(Date.now()-start<200);assert.equal(q.currentModel(profile),'m2');
});
test('single 502 or network error switches models immediately',async()=>{
 for(const code of[ERR.PROVIDER,ERR.NETWORK]){const q=make(),seen=[];await q.enqueue({profile:testProfile(),run:async({model})=>{seen.push(model);if(model==='m1')throw err(code);return model;}});assert.deepEqual(seen,['m1','m2']);}
});
test('all models cooling wait until earliest unfreezes',async()=>{
 const q=make({maxAttempts:4}),profile=testProfile(),seen=[];let n=0;const start=Date.now();
 await q.enqueue({profile,run:async({model})=>{seen.push(model);if(n++<2)throw err(ERR.RATE_LIMITED,'429',{retryAfterMs:35});return model;}});
 assert.equal(seen.length,3);assert.ok(Date.now()-start>=30);
});
test('primary becomes eligible after its cooldown',async()=>{
 const q=make(),profile=testProfile();await q.enqueue({profile,run:async({model})=>{if(model==='m1')throw err(ERR.NETWORK);return model;}});
 assert.equal(q.currentModel(profile),'m2');await sleep(50);assert.equal(q.currentModel(profile),'m1');
});
test('cancel clears pending, signals inflight and does not block another request',async()=>{
 const q=make(),profile=testProfile({concurrency:1});let aborted=false,ran=false;
 const a=q.enqueue({profile,reqId:'a',run:({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(err(ERR.CANCELLED));}))});
 const b=q.enqueue({profile,reqId:'a',run:async()=>ran=true});
 const c=q.enqueue({profile,reqId:'c',run:async()=>'keep'});await sleep(5);q.cancel('a');
 await assert.rejects(a,e=>e.code===ERR.CANCELLED);await assert.rejects(b,e=>e.code===ERR.CANCELLED);assert.equal(await c,'keep');assert.ok(aborted);assert.equal(ran,false);
});
test('bounded attempts and configuration error never retried',async()=>{
 const q=make({cooldownMs:1,maxAttempts:3});let count=0;
 await assert.rejects(q.enqueue({profile:testProfile({fallbackModels:[]}),run:async()=>{count++;throw err(ERR.PROVIDER);}}));assert.equal(count,3);
 count=0;await assert.rejects(q.enqueue({profile:testProfile(),run:async()=>{count++;throw err(ERR.CONFIG);}}));assert.equal(count,1);
});
test('external abort rejects even if provider ignores signal',async()=>{
 const q=make(),ctrl=new AbortController();const task=q.enqueue({profile:testProfile(),signal:ctrl.signal,run:()=>new Promise(()=>{})});ctrl.abort();await assert.rejects(task,e=>e.code===ERR.CANCELLED);
});

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

test('404 model_not_found immediately falls back and cools only that model for thirty minutes',async()=>{
 let clock=1000; const q=make({now:()=>clock}), profile=testProfile(), seen=[];
 const run=async({model})=>{seen.push(model);if(model==='m1')throw err(ERR.PROVIDER,'missing',{status:404,serverCode:'model_not_found'});return model;};
 assert.equal(await q.enqueue({profile,run}),'m2');
 clock+=29*60*1000; assert.equal(q.currentModel(profile),'m2');
 clock+=60*1000; assert.equal(q.currentModel(profile),'m1');
 assert.deepEqual(seen,['m1','m2']);
});

test('a chain consisting only of missing models fails promptly rather than waiting thirty minutes',async()=>{
 const q=make(),profile=testProfile({fallbackModels:[]});let calls=0;
 const run=async()=>{calls++;throw err(ERR.PROVIDER,'missing',{status:404,serverCode:'model_not_found'});};
 for(let i=0;i<2;i++)await assert.rejects(q.enqueue({profile,run}),e=>e.status===404);
 assert.equal(calls,1);
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
test('gateway_busy is neither a failure nor a cooldown: the call waits and is retried without using attempts',async()=>{
 const q=make({busyMinMs:1}),profile=testProfile({fallbackModels:[]});let calls=0;
 const busy=()=>err(ERR.RATE_LIMITED,'busy',{status:429,serverCode:'gateway_busy',retryAfterMs:5});
 const value=await q.enqueue({profile,run:async({model})=>{if(++calls<=6)throw busy();return model;}});
 assert.equal(value,'m1');assert.equal(calls,7,'six busy answers exceed maxAttempts (4) yet the job still succeeds');
 assert.equal(q.currentModel(profile),'m1');assert.equal(q.stats().t.pausedForMs,0);
});
test('a gateway that stays busy eventually surfaces the error instead of hanging',async()=>{
 const q=make({busyMinMs:1,maxBusyRetries:3}),profile=testProfile({fallbackModels:[]});let calls=0;
 await assert.rejects(q.enqueue({profile,run:async()=>{calls++;throw err(ERR.RATE_LIMITED,'busy',{status:429,serverCode:'gateway_busy',retryAfterMs:1});}}),e=>e.serverCode==='gateway_busy');
 assert.equal(calls,4);
});
test('busy waiting honours cancel and lets other jobs through',async()=>{
 const q=make({busyMinMs:20}),profile=testProfile({concurrency:1,fallbackModels:[]});let first=0;
 const a=q.enqueue({profile,reqId:'a',run:async()=>{first++;throw err(ERR.RATE_LIMITED,'busy',{status:429,serverCode:'gateway_busy',retryAfterMs:20});}});
 const b=q.enqueue({profile,reqId:'b',run:async()=>'other'});
 assert.equal(await b,'other');await sleep(5);q.cancel('a');
 await assert.rejects(a,e=>e.code===ERR.CANCELLED);assert.ok(first>=1);
});
test('a gateway profile trusts the gateway Retry-After and keeps auto on a short leash; other profiles keep the full cooldown',async()=>{
 let clock=1000;const make2=()=>createQueue({cooldownMs:60000,baseBackoffMs:10,maxBackoffMs:30,now:()=>clock});
 const hinted=make2(),gw=testProfile({model:'auto',fallbackModels:['m2']});
 await hinted.enqueue({profile:gw,run:async({model})=>{if(model==='auto')throw err(ERR.PROVIDER,'none',{status:503,serverCode:'no_backend_available',retryAfterMs:1500});return model;}});
 clock+=1400;assert.equal(hinted.currentModel(gw),'m2');clock+=200;assert.equal(hinted.currentModel(gw),'auto');
 clock=1000;const plain=make2();
 await plain.enqueue({profile:gw,run:async({model})=>{if(model==='auto')throw err(ERR.PROVIDER,'down',{status:502});return model;}});
 clock+=4900;assert.equal(plain.currentModel(gw),'m2');clock+=200;assert.equal(plain.currentModel(gw),'auto');
 clock=1000;const direct=make2(),op=testProfile({kind:'openai',model:'auto',fallbackModels:['m2']});
 await direct.enqueue({profile:op,run:async({model})=>{if(model==='auto')throw err(ERR.PROVIDER,'down',{status:502});return model;}});
 clock+=30000;assert.equal(direct.currentModel(op),'m2');clock+=31000;assert.equal(direct.currentModel(op),'auto');
});
test('bounded attempts and configuration error never retried',async()=>{
 const q=make({cooldownMs:1,maxAttempts:3});let count=0;
 await assert.rejects(q.enqueue({profile:testProfile({fallbackModels:[]}),run:async()=>{count++;throw err(ERR.PROVIDER);}}));assert.equal(count,3);
 count=0;await assert.rejects(q.enqueue({profile:testProfile(),run:async()=>{count++;throw err(ERR.CONFIG);}}));assert.equal(count,1);
});
test('external abort rejects even if provider ignores signal',async()=>{
 const q=make(),ctrl=new AbortController();const task=q.enqueue({profile:testProfile(),signal:ctrl.signal,run:()=>new Promise(()=>{})});ctrl.abort();await assert.rejects(task,e=>e.code===ERR.CANCELLED);
});

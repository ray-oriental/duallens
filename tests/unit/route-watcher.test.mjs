import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteWatcher } from '../../extension/content/observer.js';

function environment(t, { navigation = true, hidden = false } = {}) {
  const saved = new Map(['window','document','location','setInterval','clearInterval'].map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const win = new EventTarget(), doc = new EventTarget(), timers = new Map();
  let sequence = 0, starts = 0;
  win.history = {pushState(){return 7;},replaceState(){return 8;}};
  if (navigation) win.navigation = new EventTarget();
  doc.visibilityState = hidden ? 'hidden' : 'visible';
  Object.assign(globalThis,{window:win,document:doc,location:{href:'https://example.test/start'},
    setInterval(fn,ms){assert.equal(ms,1000);starts++;timers.set(++sequence,fn);return sequence;},
    clearInterval(id){timers.delete(id);}});
  t.after(() => { for (const [key,desc] of saved) { if(desc)Object.defineProperty(globalThis,key,desc);else delete globalThis[key]; } });
  return {win,doc,timers,get starts(){return starts;},
    route(path,target=win,event='popstate'){location.href='https://example.test/'+path;target.dispatchEvent(new Event(event));},
    visibility(value){doc.visibilityState=value;doc.dispatchEvent(new Event('visibilitychange'));}};
}
test('Navigation API uses both events plus legacy signals, deduplicates and never polls', t => {
  const e = environment(t); let calls = 0;
  const watcher = new RouteWatcher(() => calls++);watcher.start();watcher.start();
  assert.equal(e.starts,0);
  e.route('one',e.win.navigation,'currententrychange');
  e.win.navigation.dispatchEvent(new Event('navigatesuccess'));assert.equal(calls,1);
  e.route('two',e.win.navigation,'navigatesuccess');
  e.route('three');e.route('four',e.win,'hashchange');assert.equal(calls,4);
  e.visibility('hidden');e.visibility('visible');assert.equal(e.starts,0);
  watcher.stop();watcher.stop();e.route('five',e.win.navigation,'navigatesuccess');assert.equal(calls,4);
  watcher.start();e.route('six',e.win.navigation,'navigatesuccess');assert.equal(calls,5);watcher.stop();
});
test('fallback is shared by rules/translation, pauses hidden polling and checks immediately on resume', async t => {
  const e = environment(t,{navigation:false});let rules=0,translation=0;
  const original=e.win.history.pushState;
  const a=new RouteWatcher(()=>rules++),b=new RouteWatcher(()=>translation++);
  a.start();b.start();a.start();assert.equal(e.timers.size,1);assert.equal(e.starts,1);
  location.href='https://example.test/poll';[...e.timers.values()][0]();assert.deepEqual([rules,translation],[1,1]);
  e.visibility('hidden');assert.equal(e.timers.size,0);
  location.href='https://example.test/background';e.visibility('visible');assert.deepEqual([rules,translation],[2,2]);assert.equal(e.timers.size,1);
  e.visibility('visible');assert.equal(e.starts,2);
  location.href='https://example.test/history';assert.equal(e.win.history.pushState(),7);await Promise.resolve();assert.deepEqual([rules,translation],[3,3]);
  a.stop();assert.equal(e.timers.size,1);e.route('pop');assert.deepEqual([rules,translation],[3,4]);
  b.stop();assert.equal(e.timers.size,0);assert.equal(e.win.history.pushState,original);
  e.route('stopped');e.visibility('visible');assert.equal(e.starts,2);
});
test('initially hidden fallback waits for visibility and preserves later history changes on stop', t => {
  const e=environment(t,{navigation:false,hidden:true});let calls=0;
  const watcher=new RouteWatcher(()=>calls++);watcher.start();assert.equal(e.starts,0);
  location.href='https://example.test/hidden';e.visibility('visible');assert.equal(calls,1);assert.equal(e.timers.size,1);
  const pageHook=()=>{};e.win.history.pushState=pageHook;
  watcher.stop();assert.equal(e.win.history.pushState,pageHook);assert.equal(e.timers.size,0);
});

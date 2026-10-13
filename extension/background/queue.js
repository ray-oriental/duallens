// Priority queue with per-model cooldown and immediate fallback.
import {ERR} from '../shared/protocol.js';
import {cancelledError,isCancelled} from '../shared/errors.js';
export function createQueue(options={}){
 const cfg={baseBackoffMs:2000,maxBackoffMs:60000,cooldownMs:60000,maxAttempts:4,now:()=>Date.now(),...options};
 const states=new Map(),live=new Set();let seq=0;
 const chain=p=>[p.model,...(p.fallbackModels||[])].filter((m,i,a)=>typeof m==='string'&&m&&a.indexOf(m)===i);
 function state(p){let s=states.get(p.id);if(!s){s={profile:p,running:0,pending:[],cooldowns:new Map(),rates:new Map(),timer:null};states.set(p.id,s);}s.profile=p;return s;}
 function available(s){return chain(s.profile).find(m=>(s.cooldowns.get(m)||0)<=cfg.now());}
 function soonest(s){return Math.min(...chain(s.profile).map(m=>s.cooldowns.get(m)||0));}
 function currentModel(p){const s=state(p);return available(s)||chain(p).sort((a,b)=>(s.cooldowns.get(a)||0)-(s.cooldowns.get(b)||0))[0];}
 function settle(j,ok,value){if(j.settled)return;j.settled=true;live.delete(j);j.unlink?.();ok?j.resolve(value):j.reject(value);}
 function cancelJob(j){if(j.settled)return;j.cancelled=true;j.ctrl.abort();const s=j.state;s.pending=s.pending.filter(x=>x!==j);settle(j,false,cancelledError());pump(s);}
 function pump(s){
  if(s.timer){clearTimeout(s.timer);s.timer=null;}
  if(!s.pending.length)return;
  if(!available(s)){s.timer=setTimeout(()=>pump(s),Math.max(1,soonest(s)-cfg.now()));return;}
  const limit=Math.max(1,Math.floor(s.profile.concurrency)||1);
  s.pending.sort((a,b)=>a.priority-b.priority||a.seq-b.seq);
  while(s.running<limit&&s.pending.length&&available(s)){
   const j=s.pending.shift();if(j.settled)continue;
   const model=available(s);s.running++;j.attempts++;j.running=true;
   Promise.resolve().then(()=>j.run({model,signal:j.ctrl.signal,attempt:j.attempts})).then(
    value=>{s.rates.delete(model);settle(j,!j.cancelled,j.cancelled?cancelledError():value);},
    error=>{
     if(j.settled)return;
     if(j.cancelled||isCancelled(error))return settle(j,false,cancelledError());
     if(error?.code===ERR.CONFIG)return settle(j,false,error);
     let wait=cfg.cooldownMs;
     if(error?.code===ERR.RATE_LIMITED){
      const streak=(s.rates.get(model)||0)+1;s.rates.set(model,streak);
      wait=Number.isFinite(error.retryAfterMs)?Math.max(0,error.retryAfterMs):Math.min(cfg.maxBackoffMs,cfg.baseBackoffMs*2**(streak-1));
     }
     s.cooldowns.set(model,Math.max(s.cooldowns.get(model)||0,cfg.now()+wait));
     if(j.attempts>=cfg.maxAttempts)settle(j,false,error);else s.pending.push(j);
    }
   ).finally(()=>{j.running=false;s.running--;pump(s);});
  }
 }
 function enqueue({profile,priority=1,reqId=null,signal=null,run}){
  return new Promise((resolve,reject)=>{
   if(signal?.aborted)return reject(cancelledError());
   const s=state(profile),j={seq:++seq,profile,priority,reqId,run,resolve,reject,state:s,attempts:0,ctrl:new AbortController(),settled:false,cancelled:false,running:false};
   if(!chain(profile).length)return reject(new Error('No model configured'));
   if(signal){const abort=()=>cancelJob(j);signal.addEventListener('abort',abort,{once:true});j.unlink=()=>signal.removeEventListener('abort',abort);}
   live.add(j);s.pending.push(j);pump(s);
  });
 }
 function cancel(reqId){for(const j of [...live])if(j.reqId===reqId)cancelJob(j);}
 function stats(){const out={};for(const[id,s]of states)out[id]={running:s.running,pending:s.pending.length,model:currentModel(s.profile),pausedForMs:available(s)?0:Math.max(0,soonest(s)-cfg.now())};return out;}
 return{enqueue,cancel,currentModel,stats};
}

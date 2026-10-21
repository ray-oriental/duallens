// Content-only gate shared by the extension and userscript. No text crosses the transport
// until every possible destination (including fallbacks) has been acknowledged on this device.
import{requestDestinations,destinationMessage}from '../shared/destinations.js';
export {requestDestinations};
import{loadDeviceState,needsConfirmation,acknowledge}from '../shared/device-state.js';
import{createOverlay}from './overlay.js';

const UI={
  title:'确认发送',continue:'继续翻译',change:'更换服务',close:'关闭',stopped:'本次未翻译。',
  download:'下载语言包',ocr:'需下载语言包，图片在本机识别。',
};
const CSS=`.confirm{position:fixed;right:max(16px,var(--safe-right));bottom:max(16px,var(--safe-bottom));width:320px;max-width:calc(100vw - 32px);padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);box-shadow:var(--shadow);pointer-events:auto}.confirm.left{right:auto;left:max(16px,var(--safe-left))}.confirm p{margin:4px 24px 12px 0;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.confirm button{padding:6px 10px;color:var(--accent);background:transparent}.confirm .primary{background:var(--accent);color:var(--accent-fg)}.confirm .close{position:absolute;right:6px;top:6px;padding:2px 8px;color:var(--fg2)}`;

export function confirmationCard({message,platform,label=UI.continue,signal,left=false,root,group='common'}){
  if(signal?.aborted)return Promise.resolve(false);
  return new Promise(resolve=>{
    const ui=root?null:createOverlay(CSS),box=document.createElement('section');box.className=root?'dl-notice dl-confirmation':'confirm'+(left?' left':'');
    box.setAttribute('role','dialog');box.setAttribute('aria-label',UI.title);
    const p=document.createElement('p');p.textContent=message;
    const actions=document.createElement('div');actions.className='actions';
    const finish=ok=>{ui?.detach();box.remove();document.removeEventListener('keydown',key,true);signal?.removeEventListener('abort',abort);resolve(ok);};
    const key=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();finish(false);}};
    const abort=()=>finish(false);
    const button=(text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;};
    const close=button('×',()=>finish(false),'close');close.setAttribute('aria-label',UI.close);
    actions.append(button(UI.change,()=>{finish(false);platform.openSettings(group);}),button(label,()=>finish(true),'primary'));
    box.append(p,close,actions);if(root)root.append(box);else{ui.el.append(box);ui.attach();}
    document.addEventListener('keydown',key,true);signal?.addEventListener('abort',abort,{once:true});
  });
}

const GATED=Symbol('confirmed');
export function withSendConfirmation(p,getSettings,{prompt=confirmationCard}={}){
  if(p[GATED])return p;
  const waiting=new Map();let serial=Promise.resolve();
  const stopped=()=>({ok:false,error:{code:'CANCELLED',message:UI.stopped}});
  async function ensure(req,signal,forced){
    if(signal?.aborted)return false;
    const dests=forced?[forced]:requestDestinations(getSettings(),req),key=JSON.stringify(dests.map(d=>d.id));
    if(!dests.length)return true;
    // Child agents have no consent UI and cannot infer permission from local storage.
    if(p.frameAgent)return dests.every(d=>!needsConfirmation({acked:p.confirmedDestinations?.()||[]},d.id));
    let job=waiting.get(key);
    if(!job){
      job={users:0,abort:new AbortController()};
      const run=async()=>{
        if(job.abort.signal.aborted)return false;
        const state=await loadDeviceState(p.localArea);
        const missing=dests.filter(d=>needsConfirmation(state,d.id));
        if(missing.length){
          const s=getSettings();
          const ok=await prompt({message:missing.map(d=>destinationMessage(d)).join(' '),platform:p,signal:job.abort.signal,
            group:missing.some(d=>d.id.startsWith('llm:'))?'ai':'common',
            left:s.floatBall?.enabled&&s.floatBall.side!=='left'});
          if(!ok&&req.purpose==='page')out.onDecline?.();
          if(!ok||job.abort.signal.aborted)return false;
          for(const d of missing)await acknowledge(p.localArea,d.id);
          out.onDestinationConfirmed?.();
        }
        return !!forced||key===JSON.stringify(requestDestinations(getSettings(),req).map(d=>d.id));
      };
      job.promise=serial.then(run).catch(()=>false).finally(()=>waiting.delete(key));
      serial=job.promise;waiting.set(key,job);
    }
    job.users++;
    let released=false;
    const release=()=>{if(released)return;released=true;if(!--job.users)job.abort.abort();};
    signal?.addEventListener('abort',release,{once:true});
    try{return await job.promise&&!signal?.aborted;}
    finally{signal?.removeEventListener('abort',release);release();}
  }
  const out={...p,[GATED]:true,confirmSend:ensure,translator(){
    const svc=p.translator();
    return{...svc,
      async translateText(req){const{signal,...body}=req;if(!await ensure(body,signal))return stopped();
        for(let retry=0;retry<8;retry++){const result=await svc.translateText(body);
          if(result?.error?.code!=='confirmation-required')return result;
          if(!result.error.destination||!await ensure(body,signal,result.error.destination))return stopped();
        }return stopped();},
      translateBatch(req,onPartial){
        const abort=new AbortController();let handle,finish;
        const done=(async()=>{
          if(await ensure(req,abort.signal)){
            if(abort.signal.aborted)return;
            let pending=req.items;
            for(let retry=0;pending.length&&retry<8&&!abort.signal.aborted;retry++){
              let left=pending.length;const complete=new Promise(r=>{finish=r;});const blocked=new Map();
              handle=svc.translateBatch({...req,items:pending},results=>{
                const delivered=[];
                for(const r of results){if(r.error?.code==='confirmation-required'&&r.error.destination)blocked.set(r.id,r.error.destination);else delivered.push(r);}
                if(!abort.signal.aborted&&delivered.length)onPartial(delivered);
                left-=results.filter(r=>r.stage!=='draft').length;if(left<=0)finish();
              });
              await(handle.done||complete);
              if(!blocked.size)break;
              const dests=[...new Map([...blocked.values()].map(d=>[d.id,d])).values()];
              for(const d of dests)if(!await ensure(req,abort.signal,d)){
                if(!abort.signal.aborted)onPartial(pending.map(it=>({id:it.id,error:stopped().error})));return;
              }
              pending=pending.filter(it=>blocked.has(it.id));
            }
          }else if(!abort.signal.aborted)onPartial(req.items.map(item=>({id:item.id,error:stopped().error})));
        })();
        return{done,cancel(){abort.abort();handle?.cancel();finish?.();}};
      },
    };
  }};
  if(p.comics)out.comics={...p.comics,async recognize(req){
    const packs=await p.comics.languages?.();
    if(!packs?.ok||!packs.languages.some(l=>l.lang===req.lang)){
      // Language keys and serialized destination-list keys cannot collide.
      if(!waiting.has(req.lang))waiting.set(req.lang,prompt({message:`${UI.ocr} 来源：GitHub raw.githubusercontent.com；体积：${({eng:'4.11 MB',jpn:'2.47 MB',jpn_vert:'3.04 MB',kor:'1.68 MB'})[req.lang]||'约 11.3 MB'}（下载前校验固定大小与 SHA-256）。`,platform:p,label:UI.download}));
      let ok;try{ok=await waiting.get(req.lang);}finally{waiting.delete(req.lang);}if(!ok)return stopped();
    }
    return p.comics.recognize(req);
  }};
  return out;
}

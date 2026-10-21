// Content-only gate shared by the extension and userscript. No text crosses the transport
// until every possible destination (including fallbacks) has been acknowledged on this device.
import{providerChain}from '../shared/settings.js';
import{loadDeviceState,needsConfirmation,acknowledge,llmDestination,mtDestination}from '../shared/device-state.js';
import{createOverlay}from './overlay.js';

const UI={
  title:'确认发送',continue:'继续翻译',change:'更换服务',close:'关闭',stopped:'本次未翻译。',
  sentence:(name,host)=>`将使用 ${name} 翻译，本页文字会发送到 ${host}。`,
  microsoft:'微软机器翻译',google:'谷歌机器翻译','microsoft-api':'微软 Translator',deepl:'DeepL',
  download:'下载语言包',ocr:'需下载语言包，图片在本机识别。',
};
const HOSTS={microsoft:'edge.microsoft.com / api-edge.cognitive.microsofttranslator.com',google:'clients5.google.com',
  'microsoft-api':'api.cognitive.microsofttranslator.com',deepl:'api.deepl.com / api-free.deepl.com'};
const CSS=`.confirm{position:fixed;right:max(16px,var(--safe-right));bottom:max(16px,var(--safe-bottom));width:320px;max-width:calc(100vw - 32px);padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);box-shadow:var(--shadow);pointer-events:auto}.confirm.left{right:auto;left:max(16px,var(--safe-left))}.confirm p{margin:4px 24px 12px 0;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.confirm button{padding:6px 10px;color:var(--accent);background:transparent}.confirm .primary{background:var(--accent);color:var(--accent-fg)}.confirm .close{position:absolute;right:6px;top:6px;padding:2px 8px;color:var(--fg2)}`;

export function confirmationCard({message,platform:p,label=UI.continue,signal,left=false}){
  if(signal?.aborted)return Promise.resolve(false);
  return new Promise(resolve=>{
    const ui=createOverlay(CSS),box=document.createElement('section');box.className='confirm'+(left?' left':'');
    box.setAttribute('role','dialog');box.setAttribute('aria-label',UI.title);
    const p=document.createElement('p');p.textContent=message;
    const actions=document.createElement('div');actions.className='actions';
    const finish=ok=>{ui.detach();document.removeEventListener('keydown',key,true);signal?.removeEventListener('abort',abort);resolve(ok);};
    const key=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();finish(false);}};
    const abort=()=>finish(false);
    const button=(text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;};
    const close=button('×',()=>finish(false),'close');close.setAttribute('aria-label',UI.close);
    actions.append(button(UI.change,()=>{finish(false);p.openSettings('common');}),button(label,()=>finish(true),'primary'));
    box.append(p,close,actions);ui.el.append(box);ui.attach();
    document.addEventListener('keydown',key,true);signal?.addEventListener('abort',abort,{once:true});
  });
}

export function requestDestinations(s,req={}){
  let chain=providerChain(s);
  if(req.profileId!==undefined){const profile=s.provider.profiles.find(p=>p.id===req.profileId);
    if(profile)chain=[{profile,model:req.model||profile.model},...chain];}
  chain=chain.filter(c=>c.model?.trim()&&(c.profile.kind==='mock'||c.profile.baseUrl));
  const mode=req.mode||s.translation?.mode||'mt+llm';
  const dests=[];
  if(mode!=='llm'){
    const engine=s.translation?.mt?.engine||'microsoft';
    const engines=[engine,...(engine!=='mock'&&s.translation?.mt?.fallback!==false?['microsoft','google']:[])];
    for(const id of engines)dests.push({id:mtDestination(id),name:UI[id]||id,host:HOSTS[id]||''});
  }
  // Quick interactions can fall back to the configured LLM; explicit MT cannot.
  if(mode!=='mt'){
    for(const{profile}of chain)if(profile.kind!=='mock'){
      const id=llmDestination(profile.baseUrl);if(id)dests.push({id,name:profile.name||new URL(profile.baseUrl).hostname,host:new URL(profile.baseUrl).hostname});
    }
  }
  return dests.filter((d,i,a)=>a.findIndex(x=>x.id===d.id)===i);
}

const GATED=Symbol('confirmed');
export function withSendConfirmation(p,getSettings,{prompt=confirmationCard}={}){
  if(p[GATED])return p;
  const waiting=new Map();let serial=Promise.resolve();
  const stopped=()=>({ok:false,error:{code:'CANCELLED',message:UI.stopped}});
  async function ensure(req,signal){
    if(signal?.aborted)return false;
    const dests=requestDestinations(getSettings(),req),key=JSON.stringify(dests.map(d=>d.id));
    if(!dests.length)return true;
    let job=waiting.get(key);
    if(!job){
      job={users:0,abort:new AbortController()};
      const run=async()=>{
        if(job.abort.signal.aborted)return false;
        const state=await loadDeviceState(p.localArea);
        const missing=dests.filter(d=>needsConfirmation(state,d.id));
        if(missing.length){
          const s=getSettings();
          const ok=await prompt({message:missing.map(d=>UI.sentence(d.name,d.host)).join(' '),platform:p,signal:job.abort.signal,
            left:s.floatBall?.enabled&&s.floatBall.side!=='left'});
          if(!ok&&req.purpose==='page')out.onDecline?.();
          if(!ok||job.abort.signal.aborted)return false;
          for(const d of missing)await acknowledge(p.localArea,d.id);
        }
        return key===JSON.stringify(requestDestinations(getSettings(),req).map(d=>d.id));
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
  const out={...p,[GATED]:true,translator(){
    const svc=p.translator();
    return{...svc,
      async translateText(req){const{signal,...body}=req;return await ensure(body,signal)?svc.translateText(body):stopped();},
      translateBatch(req,onPartial){
        const abort=new AbortController();let handle,finish;
        const done=(async()=>{
          if(await ensure(req,abort.signal)){
            if(abort.signal.aborted)return;
            let left=req.items.length;const complete=new Promise(r=>{finish=r;});
            handle=svc.translateBatch(req,results=>{if(!abort.signal.aborted)onPartial(results);left-=results.filter(r=>r.stage!=='draft').length;if(!left)finish();});
            await(handle.done||complete);
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
      if(!waiting.has(req.lang))waiting.set(req.lang,prompt({message:UI.ocr,platform:p,label:UI.download}));
      if(!await waiting.get(req.lang)){waiting.delete(req.lang);return stopped();}
    }
    return p.comics.recognize(req);
  }};
  return out;
}

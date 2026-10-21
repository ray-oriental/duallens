import { DEFAULT_SETTINGS,mergeSettings,STYLES } from '../../shared/settings.js';
import { featureNeedsBroad,requestBroad,requestOrigin,requestMTOrigin } from '../../shared/permissions.js';
import { acknowledge,llmDestination } from '../../shared/device-state.js';
import { element,FEATURES,TEXT as COMMON,engineSummary,featureDescription } from '../components.js';
import { GROUPS } from './navigation.js';
import { validateSettings } from '../validation.js';

const T=Object.freeze({saved:'已保存',save:'保存',cancel:'取消',confirm:'继续',discard:'有未保存的修改，要放弃这些修改吗？',denied:COMMON.denied,originDenied:'未获得服务访问权限，配置没有保存。',reset:'恢复默认设置？本机密钥、上手状态与去向确认会保留。',delete:'删除此服务？同时删除它的本机密钥。',clear:'清除此密钥？',up:'上移',down:'下移',remove:'移除',model:'填写备选模型',unconfigured:'不使用 AI 服务',local:'文字只发送到你本机的服务，不会离开这台电脑。',destination:host=>`使用后，网页文字和页面标题会发送给 ${host}。`,version:'版本',copied:'命令已复制',copyFallback:'复制以下命令：',free:'只列出免费模型',missing:'先选择服务并填写模型。',failure:'操作没有完成，请检查设置。'});

export function installSettingsInteractions(ui,ctx){
  const {store,platform,getSettings,setSettings,getDirty,setDirty,getProfile,save,draw,notice,bind,simple,nums}=ctx;
  const doc=ui.ownerDocument,win=doc.defaultView,$=id=>ui.querySelector('#'+id),el=(tag,text,attrs)=>element(doc,tag,text,attrs),unbind=[];
  let group='',closed=false,savedTimer,confirming=null;
  const on=(n,type,fn,options)=>{n.addEventListener(type,fn,options);unbind.push(()=>n.removeEventListener(type,fn,options));};
  const fieldPath=id=>simple.includes(id)?id:bind[id]||({translationMode:'translation.mode',mtEngine:'translation.mt.engine',mtFallback:'translation.mt.fallback',mtRegion:'translation.mt.region'})[id];
  const immediate=n=>n.id==='freeModels'||!!n.closest?.('#display-segments')||!!fieldPath(n.id)&&!['hoverModel','inputModel','customPrompt'].includes(n.id);
  const val=n=>n.type==='checkbox'?n.checked:nums.has(n.id)?Number(n.value):n.value;
  const patchFor=(path,value)=>path.split('.').reverse().reduce((v,key)=>({[key]:v}),value);
  const flash=()=>{const node=$('saved-toast');node.classList.add('show');clearTimeout(savedTimer);savedTimer=setTimeout(()=>node.classList.remove('show'),1600);};
  async function ask(message){
    if(confirming)return false;
    return new Promise(resolve=>{const box=el('div',null,{class:'confirmation',role:'alertdialog','aria-label':message}),a=el('div',null,{class:'actions'});box.append(el('p',message),a);ui.querySelector('.settings-content').prepend(box);const done=answer=>{confirming=null;box.remove();resolve(answer);};confirming=done;for(const [title,result]of[[T.cancel,false],[T.confirm,true]]){const b=el('button',title,{type:'button'});b.addEventListener('click',()=>done(result));a.append(b);}a.firstChild.focus();});
  }
  async function select(next,force=false){
    if(!GROUPS.some(([id])=>id===next))next='common';if(next===group&&!force)return;
    if(group&&getDirty()&&!force){if(!await ask(T.discard)){if(platform.kind==='extension')win.history.replaceState(null,'','#'+group);return;}setDirty(false);setSettings(await store.load());await draw();}
    group=next;for(const page of ui.querySelectorAll('[data-group]'))page.hidden=page.dataset.group!==group;
    for(const link of ui.querySelectorAll('[data-group-link]')){if(link.dataset.groupLink===group){link.setAttribute('aria-current','page');link.scrollIntoView({block:'nearest',inline:'nearest'});}else link.removeAttribute('aria-current');}
    if(platform.kind==='extension'&&win.location.hash!=='#'+group)win.history.replaceState(null,'','#'+group);
  }
  for(const link of ui.querySelectorAll('[data-group-link]'))on(link,'click',event=>{event.preventDefault();void select(link.dataset.groupLink);});
  if(platform.kind==='extension')on(win,'hashchange',()=>void select(win.location.hash.slice(1)));
  on(win,'beforeunload',event=>{if(getDirty()){event.preventDefault();event.returnValue='';}});
  async function persistField(n){
    const path=fieldPath(n.id);if(!path)return;const before=getSettings(),value=val(n),feature=path.endsWith('.enabled')?path.split('.')[0]:null;
    if(value&&feature&&featureNeedsBroad(feature)&&platform.kind==='extension'&&!await requestBroad(platform.permissionAPI)){n.checked=false;notice(T.denied);drawView();return;}
    if(n.id==='mtEngine'&&platform.kind==='extension'&&!await requestMTOrigin(value,platform.permissionAPI)){n.value=before.translation.mt.engine;notice(T.originDenied);return;}
    const patch=patchFor(path,value);const previousDirty=getDirty();setDirty(true);
    try{validateSettings(mergeSettings(before,patch));await store.save(patch);if(closed)return;setSettings(mergeSettings(getSettings(),patch));setDirty(previousDirty);n.removeAttribute('aria-invalid');ui.querySelector('#error-'+n.id)?.remove();flash();drawView();}
    catch(error){setSettings(before);setDirty(previousDirty);if(n.type==='checkbox')n.checked=!value;n.setAttribute('aria-invalid','true');ui.querySelector('#error-'+n.id)?.remove();const help=el('small',error.message||T.failure,{class:'field-error',id:'error-'+n.id});n.parentElement.append(help);notice(error.message||T.failure,true);}
  }
  on($('settings-form'),'change',event=>{const n=event.target;if(immediate(n))void persistField(n);});
  for(const b of ui.querySelectorAll('#style-tiles input'))on(b,'change',()=>{if(b.checked){$('style').value=b.value;void persistField($('style'));}});
  for(const b of ui.querySelectorAll('[data-preset]'))on(b,'click',()=>{$('providerPreset').value=b.dataset.preset;$('add-profile').click();});
  on($('localOnly'),'change',()=>{$('translationMode').value=$('localOnly').checked?'llm':'mt+llm';setSettings(mergeSettings(getSettings(),{translation:{mode:$('translationMode').value}}));setDirty(true);drawView();});
  on($('localEngine'),'change',()=>{const p=getProfile();if(!p)return;p.preset=$('localEngine').value;p.baseUrl=p.preset==='ollama'?'http://127.0.0.1:11434/v1':'http://127.0.0.1:1234/v1';$('baseUrl').value=p.baseUrl;setDirty(true);drawView();});
  if($('show-key'))on($('show-key'),'click',()=>{const key=$('apiKey');key.type=key.type==='password'?'text':'password';$('show-key').setAttribute('aria-pressed',String(key.type==='text'));$('show-key').textContent=key.type==='text'?COMMON.hideKey:COMMON.showKey;});
  on($('copy-origin'),'click',async()=>{const command=`setx OLLAMA_ORIGINS "chrome-extension://${globalThis.chrome?.runtime?.id||'<扩展 ID>'}"`;try{await win.navigator.clipboard.writeText(command);notice(T.copied);}catch{notice(T.copyFallback+command);}});
  function chain(){try{return JSON.parse($('providerChain').value||'[]');}catch{return[];}}
  function setChain(entries){$('providerChain').value=JSON.stringify(entries,null,2);setDirty(true);drawChain();}
  function drawChain(){const root=$('chain-list');root.replaceChildren();chain().forEach((entry,i)=>{const row=el('div',null,{class:'chain-row'});row.append(el('span',`${getSettings().provider.profiles.find(p=>p.id===entry.profileId)?.name||entry.profileId} / ${entry.model}`));for(const [label,delta]of[[T.up,-1],[T.down,1],[T.remove,0]]){const b=el('button',label,{type:'button','aria-label':`${label} ${entry.model}`});b.disabled=delta!==0&&(i+delta<0||i+delta>=chain().length);b.addEventListener('click',()=>{const values=chain();if(delta)[values[i],values[i+delta]]=[values[i+delta],values[i]];else values.splice(i,1);setChain(values);});row.append(b);}root.append(row);});}
  on($('chain-add'),'click',()=>{const profileId=$('chain-profile').value,model=$('chain-model').value.trim();if(!profileId||!model){notice(T.missing,true);return;}setChain([...chain(),{profileId,model}]);$('chain-model').value='';});
  const run=fn=>async()=>{try{await fn();}catch{notice(T.failure,true);}};
  for(const id of ['sites','glossary'])on($('save-'+id),'click',run(async()=>{await save();flash();}));
  for(const id of ['ai','sites','glossary'])on($('cancel-'+id),'click',run(async()=>{setDirty(false);setSettings(await store.load());await draw();}));
  on($('delete-profile'),'click',run(async()=>{const p=getProfile();if(!p||!await ask(T.delete))return;const settings=await store.load();settings.provider.profiles=settings.provider.profiles.filter(item=>item.id!==p.id);if(!settings.provider.profiles.length)settings.provider.profiles=structuredClone(DEFAULT_SETTINGS.provider.profiles);settings.provider.chain=settings.provider.chain.filter(c=>c.profileId!==p.id);if(settings.provider.active===p.id)settings.provider.active='';for(const key of ['input','hover'])if(settings[key].profileId===p.id){settings[key].profileId='';settings[key].model='';}setDirty(true);await store.save(settings);await store.setSecret(p.id,'');setDirty(false);setSettings(await store.load());await draw();flash();}));
  on($('restore-defaults'),'click',run(async()=>{if(!await ask(T.reset))return;setDirty(true);await store.save(structuredClone(DEFAULT_SETTINGS));setDirty(false);setSettings(await store.load());await draw();flash();}));
  // Capture destructive key-clearing clicks before the existing draft handler runs.
  for(const id of ['clear-key','mt-clear-key'])if($(id))on($(id),'click',event=>{if($(id).dataset.confirmed){delete $(id).dataset.confirmed;return;}event.stopImmediatePropagation();void ask(T.clear).then(yes=>{if(yes){$(id).dataset.confirmed='true';$(id).click();}});},true);
  on($('preset'),'change',()=>{$('customPrompt').parentElement.hidden=$('preset').value!=='custom';});
  on($('inputMode'),'change',()=>{$('inputOrder').parentElement.hidden=$('inputMode').value!=='bilingual';});
  function drawView(){
    const s=getSettings(),p=getProfile(),summary=engineSummary(s);
    for(const [key]of FEATURES){$('details-'+key).hidden=!s[key].enabled;const hint=ui.querySelector(`[data-feature="${key}"] small`);if(hint)hint.textContent=featureDescription(key,s,platform.coarse);}
    for(const input of ui.querySelectorAll('#style-tiles input'))input.checked=input.value===s.style;$('style-preview').dataset.style=s.style;$('learn-hint').hidden=s.style!=='blur';
    for(const input of ui.querySelectorAll('#display-segments input'))input.checked=input.value===s.displayMode;
    $('inputOrder').parentElement.hidden=$('inputMode').value!=='bilingual';$('customPrompt').parentElement.hidden=$('preset').value!=='custom';
    $('privacy-current').textContent=summary.full;$('mt-destination').textContent=engineSummary({...s,translation:{...s.translation,mode:'mt'}}).full;
    $('ai-destination').textContent=p?.baseUrl?summary.full:'';
    const local=['ollama','lmstudio'].includes(p?.preset);$('localOnly').parentElement.hidden=!local;$('localOnly').checked=s.translation.mode==='llm';$('localEngine').parentElement.hidden=!local;$('local-help').hidden=!local;$('freeModels').parentElement.hidden=p?.preset!=='openrouter';
    if(local){$('localEngine').value=p.preset;$('key-row').hidden=true;}
    for(const tile of ui.querySelectorAll('[data-preset]'))tile.setAttribute('aria-pressed',String(tile.dataset.preset===(local?'ollama':p?.preset)));
    $('chain-profile').replaceChildren(...s.provider.profiles.filter(p=>p.kind!=='mock').map(p=>el('option',p.name,{value:p.id})));drawChain();
    $('delete-profile').disabled=!p;
    const version=ctx.version||platform.version||'—';$('app-version').textContent=`${T.version} ${version}`;
  }
  $('freeModels').checked=true;
  void select(platform.settingsGroup|| (platform.kind==='extension'?win.location.hash.slice(1):'common'),true);
  return {draw:drawView,isImmediate:immediate,select,ask,flash,destroy(){closed=true;clearTimeout(savedTimer);confirming?.(false);for(const off of unbind)off();}};
}

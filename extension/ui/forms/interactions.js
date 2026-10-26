import { t as l10n } from '../../shared/i18n.js';
import { DEFAULT_SETTINGS,mergeSettings,STYLES } from '../../shared/settings.js';
import { featureNeedsBroad,requestBroad,requestOrigin,requestMTOrigin } from '../../shared/permissions.js';
import { acknowledge,llmDestination } from '../../shared/device-state.js';
import { element,FEATURES,TEXT as COMMON,engineSummary,featureDescription } from '../components.js';
import { PREVIEW_SAMPLES as previews } from '../../shared/preview-samples.js';
import { requestDestinations } from '../../shared/destinations.js';
import { isLocalUrl } from '../../shared/device-state.js';
import { GROUPS } from './navigation.js';
import { validateSettings } from '../validation.js';
import { shortcutSummary } from '../shortcuts.js';

const T=Object.freeze({get saved(){return l10n('mda');},get save(){return l10n('mdb');},get cancel(){return l10n('mdc');},get confirm(){return l10n('mdd');},get discard(){return l10n('mat');},get denied(){return COMMON.denied;},get originDenied(){return l10n('mde');},get reset(){return l10n('mdf');},get delete(){return l10n('mdg');},get clear(){return l10n('mdh');},get up(){return l10n('m38');},get down(){return l10n('mdi');},get remove(){return l10n('mdj');},get model(){return l10n('mdk');},get unconfigured(){return l10n('mdl');},get local(){return l10n('mdm');},destination:host=>l10n('mdn', [host]),get version(){return l10n('mdo');},get copied(){return l10n('mdp');},get copyFallback(){return l10n('mdq');},get free(){return l10n('mdr');},get missing(){return l10n('mds');},get failure(){return l10n('mdt');}});

export function installSettingsInteractions(ui,ctx){
  const {store,platform,getSettings,setSettings,getDirty,setDirty,getProfile,save,draw,notice,bind,simple,nums}=ctx;
  const doc=ui.ownerDocument,win=doc.defaultView,$=id=>ui.querySelector('#'+id),el=(tag,text,attrs)=>element(doc,tag,text,attrs),unbind=[];
  let group='',closed=false,savedTimer,confirming=null;
  const pendingFields=new Set();
  async function settleFields(){while(pendingFields.size)await Promise.all([...pendingFields]);}
  let commands=[];
  if(platform.kind==='extension')Promise.resolve(globalThis.chrome?.commands?.getAll?.()||[]).then(value=>{commands=value;if(!closed)drawView();}).catch(()=>{});
  const on=(n,type,fn,options)=>{n.addEventListener(type,fn,options);unbind.push(()=>n.removeEventListener(type,fn,options));};
  const fieldPath=id=>simple.includes(id)?id:bind[id]||({translationMode:'translation.mode',mtEngine:'translation.mt.engine',mtFallback:'translation.mt.fallback',mtRegion:'translation.mt.region'})[id];
  const immediate=n=>n.id==='freeModels'||!!n.closest?.('#display-segments')||!!fieldPath(n.id)&&n.id!=='customPrompt';
  const val=n=>n.type==='checkbox'?n.checked:nums.has(n.id)?Number(n.value):n.value;
  const patchFor=(path,value)=>path.split('.').reverse().reduce((v,key)=>({[key]:v}),value);
  const flash=()=>{const node=$('saved-toast');node.dataset.count=String((Number(node.dataset.count)||0)+1);node.classList.add('show');clearTimeout(savedTimer);savedTimer=setTimeout(()=>node.classList.remove('show'),1600);};
  async function ask(message){
    if(confirming)return false;
    return new Promise(resolve=>{const box=el('div',null,{class:'confirmation',role:'alertdialog','aria-label':message}),a=el('div',null,{class:'actions'});box.append(el('p',message),a);ui.querySelector('.settings-content').prepend(box);const done=answer=>{confirming=null;box.remove();resolve(answer);};confirming=done;for(const [title,result]of[[T.cancel,false],[T.confirm,true]]){const b=el('button',title,{type:'button'});b.addEventListener('click',()=>done(result));a.append(b);}a.firstChild.focus();});
  }
  async function select(next,force=false){
    if(!GROUPS.some(([id])=>id===next))next='common';if(next===group&&!force)return;
    if(pendingFields.size)await settleFields();if(closed)return;
    if(group&&getDirty()&&!force){if(!await ask(T.discard)){if(platform.kind==='extension')win.history.replaceState(null,'','#'+group);return;}setDirty(false);setSettings(await store.load());await draw();}
    $('saved-toast').classList.remove('show');$('status').textContent='';$('status').classList.remove('error');for(const id of ['result-test','result-load-models','result-mt-test'])$(id)?.remove();if(group&&group!==next){$('backupText').value='';$('backup-qr').hidden=true;if($('backupPassword'))$('backupPassword').value='';}
    group=next;const title=ui.querySelector(`[data-group="${group}"] .group-title`);title.append($('saved-toast'));for(const page of ui.querySelectorAll('[data-group]'))page.hidden=page.dataset.group!==group;
    for(const link of ui.querySelectorAll('[data-group-link]')){if(link.dataset.groupLink===group){link.setAttribute('aria-current','page');link.scrollIntoView({block:'nearest',inline:'nearest'});}else link.removeAttribute('aria-current');}
    if(platform.kind==='extension'&&win.location.hash!=='#'+group)win.history.replaceState(null,'','#'+group);
  }
  for(const link of ui.querySelectorAll('[data-group-link]'))on(link,'click',event=>{event.preventDefault();void select(link.dataset.groupLink);});
  if(platform.kind==='extension')on(win,'hashchange',()=>void select(win.location.hash.slice(1)));
  on(win,'beforeunload',event=>{if(getDirty()){event.preventDefault();event.returnValue='';}});
  function persistField(n){
    const work=saveField(n);pendingFields.add(work);
    void work.then(()=>pendingFields.delete(work),()=>pendingFields.delete(work));return work;
  }
  async function saveField(n){
    const path=fieldPath(n.id);if(!path)return;const before=getSettings(),value=val(n),feature=path.endsWith('.enabled')?path.split('.')[0]:null;
    if(value&&feature&&featureNeedsBroad(feature)&&platform.kind==='extension'&&!await requestBroad(platform.permissionAPI)){n.checked=false;notice(T.denied);drawView();return;}
    if(n.id==='mtEngine'&&platform.kind==='extension'&&!await requestMTOrigin(value,platform.permissionAPI)){n.value=before.translation.mt.engine;notice(T.originDenied);return;}
    // Pending immediate writes are independent of explicit-save drafts.
    const patch=patchFor(path,value);
    try{validateSettings(mergeSettings(before,patch));await store.save(patch);if(closed)return;setSettings(mergeSettings(getSettings(),patch));if(n.id==='uiLanguage')ctx.refreshLanguage();n.removeAttribute('aria-invalid');ui.querySelector('#error-'+n.id)?.remove();flash();drawView();}
    catch(error){if(closed)return;if(n.type==='checkbox')n.checked=!value;n.setAttribute('aria-invalid','true');ui.querySelector('#error-'+n.id)?.remove();const help=el('small',error.message||T.failure,{class:'field-error',id:'error-'+n.id});n.parentElement.append(help);notice(error.message||T.failure,true);}
  }
  for(const radio of ui.querySelectorAll('[name=translation-method]'))on(radio,'change',()=>{if(radio.checked){$('translationMode').value=radio.value;void persistField($('translationMode'));}});
  on($('settings-form'),'change',event=>{const n=event.target;if(immediate(n))void persistField(n);});
  for(const b of ui.querySelectorAll('#style-tiles input'))on(b,'change',()=>{if(b.checked){$('style').value=b.value;void persistField($('style'));}});
  for(const b of ui.querySelectorAll('[data-preset]'))on(b,'click',()=>{$('providerPreset').value=b.dataset.preset;$('add-profile').click();});
  on($('localOnly'),'change',()=>{$('translationMode').value=$('localOnly').checked?'llm':'mt+llm';setSettings(mergeSettings(getSettings(),{translation:{mode:$('translationMode').value}}));setDirty(true);drawView();});
  on($('localEngine'),'change',()=>{const p=getProfile();if(!p)return;p.preset=$('localEngine').value;p.baseUrl=p.preset==='ollama'?'http://127.0.0.1:11434/v1':'http://127.0.0.1:1234/v1';$('baseUrl').value=p.baseUrl;setDirty(true);drawView();});
  if($('show-key'))on($('show-key'),'click',()=>{const key=$('apiKey');key.type=key.type==='password'?'text':'password';$('show-key').setAttribute('aria-pressed',String(key.type==='text'));$('show-key').textContent=key.type==='text'?COMMON.hideKey:COMMON.showKey;});
  on($('copy-origin'),'click',()=>ctx.feedback.run($('copy-origin'),async()=>{const command=`setx OLLAMA_ORIGINS "chrome-extension://${globalThis.chrome?.runtime?.id||l10n('mdu')}"`;try{await win.navigator.clipboard.writeText(command);notice(T.copied);}catch{notice(T.copyFallback+command);}}));
  function chain(){try{return JSON.parse($('providerChain').value||'[]');}catch{return[];}}
  function setChain(entries){$('providerChain').value=JSON.stringify(entries,null,2);setDirty(true);drawChain();}
  function drawChain(){const root=$('chain-list');root.replaceChildren();chain().forEach((entry,i)=>{const row=el('div',null,{class:'chain-row'});row.append(el('span',`${getSettings().provider.profiles.find(p=>p.id===entry.profileId)?.name||entry.profileId} / ${entry.model}`));for(const [label,delta]of[[T.up,-1],[T.down,1],[T.remove,0]]){const b=el('button',label,{type:'button','aria-label':`${label} ${entry.model}`});b.disabled=delta!==0&&(i+delta<0||i+delta>=chain().length);b.addEventListener('click',()=>{const values=chain();if(delta)[values[i],values[i+delta]]=[values[i+delta],values[i]];else values.splice(i,1);setChain(values);});row.append(b);}root.append(row);});}
  on($('chain-add'),'click',()=>{const profileId=$('chain-profile').value,model=$('chain-model').value.trim();if(!profileId||!model){notice(T.missing,true);return;}setChain([...chain(),{profileId,model}]);$('chain-model').value='';});
  const run=fn=>event=>ctx.feedback.run(event.currentTarget,fn);
  for(const id of ['sites','glossary','enhance'])on($('save-'+id),'click',run(async()=>{await save();flash();}));
  for(const id of ['ai','sites','glossary','enhance'])on($('cancel-'+id),'click',run(async()=>{setDirty(false);setSettings(await store.load());await draw();}));
  on($('delete-profile'),'click',run(async()=>{const p=getProfile();if(!p||!await ask(T.delete))return;const settings=await store.load();settings.provider.profiles=settings.provider.profiles.filter(item=>item.id!==p.id);if(!settings.provider.profiles.length)settings.provider.profiles=structuredClone(DEFAULT_SETTINGS.provider.profiles);settings.provider.chain=settings.provider.chain.filter(c=>c.profileId!==p.id);if(settings.provider.active===p.id)settings.provider.active='';for(const key of ['input','hover'])if(settings[key].profileId===p.id){settings[key].profileId='';settings[key].model='';}setDirty(true);await store.save(settings);await store.setSecret(p.id,'');setDirty(false);setSettings(await store.load());await draw();flash();}));
  on($('restore-defaults'),'click',run(async()=>{if(!await ask(T.reset))return;setDirty(true);await store.save(structuredClone(DEFAULT_SETTINGS));setDirty(false);setSettings(await store.load());await draw();flash();}));
  // Capture destructive key-clearing clicks before the existing draft handler runs.
  for(const id of ['clear-key','mt-clear-key'])if($(id))on($(id),'click',event=>{if($(id).dataset.confirmed){delete $(id).dataset.confirmed;return;}event.stopImmediatePropagation();void ask(T.clear).then(yes=>{if(yes){$(id).dataset.confirmed='true';$(id).click();}});},true);
  on($('preset'),'change',()=>{$('customPrompt').parentElement.hidden=$('preset').value!=='custom';});
  on($('inputMode'),'change',()=>{$('inputOrder').parentElement.hidden=$('inputMode').value!=='bilingual';});
  function drawView(){
    const s=getSettings(),p=getProfile(),summary=engineSummary(s);
    $('shortcut-hint').textContent=[shortcutSummary(commands),l10n(platform.kind==='extension'?'uxShortcutSettings':'uxShortcutMobile')].filter(Boolean).join(' ');
    $('glossary-empty').hidden=!!$('glossary').value.trim();$('glossary').setAttribute('placeholder',l10n('uxGlossaryPlaceholder'));
    const configured=!!p&&p.kind!=='mock';$('provider-card').hidden=!configured;$('provider-empty').hidden=configured;$('prompt-card').hidden=!configured;if(p)$('provider-name').textContent=p.name;
    for(const radio of ui.querySelectorAll('[name=translation-method]'))radio.checked=radio.value===s.translation.mode;
    $('style-preview').textContent=previews[s.targetLang]||previews.en;
    const rows=$('privacy-rows');rows.replaceChildren();const addRow=(who,what,when)=>{const tr=el('tr');for(const text of [who,what,when])tr.append(el('td',text));rows.append(tr);};for(const d of requestDestinations(s))addRow(d.name,d.id.startsWith('llm:')?l10n('polishTextTitle'):l10n('polishText'),d.id.startsWith('mt:')&&d.id!=='mt:'+s.translation.mt.engine?l10n('polishWhenPrimaryFails',[COMMON.mt[s.translation.mt.engine]]):d.id.startsWith('llm:')?l10n('polishWhenRefine'):l10n('polishWhenTranslate'));
    $('mt-unofficial').hidden=!['microsoft','google'].includes(s.translation.mt.engine);$('mtFallback').parentElement.hidden=!['microsoft','google'].includes(s.translation.mt.engine);

    for(const [key]of FEATURES){$('details-'+key).hidden=!s[key].enabled;const hint=ui.querySelector(`[data-feature="${key}"] small`);if(hint)hint.textContent=featureDescription(key,s,platform.coarse);}
    for(const input of ui.querySelectorAll('#style-tiles input'))input.checked=input.value===s.style;$('style-preview').dataset.style=s.style;$('learn-hint').hidden=s.style!=='blur';
    for(const input of ui.querySelectorAll('#display-segments input'))input.checked=input.value===s.displayMode;
    $('inputOrder').parentElement.hidden=$('inputMode').value!=='bilingual';$('customPrompt').parentElement.hidden=$('preset').value!=='custom';
    $('privacy-current').textContent=summary.full;$('mt-destination').textContent=engineSummary({...s,translation:{...s.translation,mode:'mt'}}).full;
    $('ai-destination').textContent=p?.baseUrl?(isLocalUrl(p.baseUrl)?COMMON.local:l10n('polishAIDestination',[p.name])):'';
    const local=['ollama','lmstudio'].includes(p?.preset);$('localOnly').parentElement.hidden=!local;$('localOnly').checked=s.translation.mode==='llm';$('localEngine').parentElement.hidden=!local;$('local-help').hidden=!local;$('freeModels').parentElement.hidden=p?.preset!=='openrouter';
    $('key-row').hidden=!p||local||p.kind==='mock';if(local){$('localEngine').value=p.preset;$('key-link').hidden=true;}
    const address=$('baseUrl').parentElement,advanced=$('provider-card details .grid');if(p?.preset==='custom'||local)$('model').closest('.frow').before(address);else advanced.prepend(address);

    for(const tile of ui.querySelectorAll('[data-preset]'))tile.setAttribute('aria-pressed',String(tile.dataset.preset===(local?'ollama':p?.preset)));
    // The chosen service expands in place, directly under its row.
    const hint=$('provider-hint');if(!getDirty())hint.textContent='';hint.hidden=!hint.textContent;
    const pressed=ui.querySelector('[data-preset][aria-pressed=true]');if(pressed&&configured&&pressed.nextElementSibling!==$('provider-card'))pressed.after($('provider-card'));
    $('chain-profile').replaceChildren(...s.provider.profiles.filter(p=>p.kind!=='mock').map(p=>el('option',p.name,{value:p.id})));drawChain();
    $('delete-profile').disabled=!p;
    const version=ctx.version||platform.version||'—';$('app-version').textContent=`${T.version} ${version}`;
  }
  $('freeModels').checked=true;
  void select(platform.settingsGroup|| (platform.kind==='extension'?win.location.hash.slice(1):'common'),true);
  return {draw:drawView,isImmediate:immediate,isSaving:()=>pendingFields.size>0,settle: settleFields,select,ask,flash,destroy(){closed=true;clearTimeout(savedTimer);confirming?.(false);for(const off of unbind)off();}};
}

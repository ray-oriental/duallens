import { renderError } from '../shared/errors.js';
import { ERR } from '../shared/protocol.js';
import { t as l10n, uiLanguage, setUiLanguage, localize } from '../shared/i18n.js';
import {confirmationCard} from '../content/confirmation.js';
import {destinationNotice} from '../shared/destinations.js';
import { LANGS,siteRuleFor,setSitePageRule } from '../shared/settings.js';
import { loadDeviceState,updateDeviceState,acknowledge,mtDestination } from '../shared/device-state.js';
import { featureNeedsBroad,requestBroad } from '../shared/permissions.js';
import { pathPattern } from '../shared/site-pattern.js';
import { FEATURES,element,segmented,engineDisclosure,featureDescription } from './components.js';
import { SHARED_CSS } from './theme.js';
import { POPUP_CSS } from './popup-theme.js';
const EXTRA = { get revoked(){return l10n('mi4');},
  get pdf(){return l10n('m18');}, get images(){return l10n('mi5');} };
const T=Object.freeze({title:'DualLens',get text(){return l10n('ma6');},get settings(){return l10n('m4n');},get translate(){return l10n('m4c');},get original(){return l10n('m4d');},get restricted(){return l10n('mi7');},get stale(){return l10n('popupStale');},get reload(){return l10n('popupReload');},get mode(){return l10n('me1');},get bilingual(){return l10n('me2');},get translation(){return l10n('m4f');},get target(){return l10n('mi9');},get to(){return l10n('mia');},get site(){return l10n('m4g');},get demand(){return l10n('m4h');},get always(){return l10n('m4i');},get never(){return l10n('m4j');},get enhance(){return l10n('mh4');},get skip(){return l10n('mig');},get next(){return l10n('mih');},get back(){return l10n('mii');},get start(){return l10n('mij');},get languageTitle(){return l10n('mik');},get languageHint(){return l10n('mil');},get browser(){return l10n('mim');},get engineTitle(){return l10n('min');},get engineHint(){return l10n('mio');},get free(){return l10n('mip');},get freeHint(){return l10n('miq');},get ai(){return l10n('mir');},get aiHint(){return l10n('mis');},get ready(){return l10n('mit');},get tips(){return [l10n('miu'),l10n('miv'),l10n('miw')];},get mobile(){return l10n('mix');},get upgrade(){return l10n('miy');},get understood(){return l10n('miz');},get failure(){return l10n('mj0');},step:n=>l10n('mj1', [n]),shortcut:(label,key)=>l10n('lookShortcut',[label,key]),progress:(done,pending,failed,refining)=>l10n('mj5', [done, refining?l10n('mj2', [refining]):'', pending?l10n('mj3', [pending]):'', failed?l10n('mj4', [failed]):''])});
// Popup rows use the shortest unambiguous names; Settings keeps the full ones with descriptions.
const ROW=Object.freeze({get floatBall(){return l10n('mau');},get selection(){return l10n('polishSelectionShort');},get input(){return l10n('polishInputShort');},get subtitles(){return l10n('polishSubtitlesShort');}});
const hoverRow=(s,coarse)=>coarse?l10n('lookLongPress'):s.hover.modifier==='none'?l10n('polishHoverShort'):l10n('lookHoverRow',[s.hover.modifier==='Control'?'Ctrl':s.hover.modifier]);

export async function mountPopup(root,{store,platform,localArea=platform.localArea,url='',pageMessage,onSettings=()=>platform.openSettings(),onText=()=>platform.openTextTranslation?.(),shortcut='',restricted=false,stale=false,accessError,onReload=()=>{},pdfAvailable=false,onPDF}) {
  const doc=root.ownerDocument,el=(tag,text,attrs)=>element(doc,tag,text,attrs),box=el('div',null,{class:'dl-theme dl-popup',lang:uiLanguage()}),style=el('style',SHARED_CSS+POPUP_CSS);box.append(style);root.append(box);
  let s=await store.load(),device=await loadDeviceState(localArea),closed=false,step=1,ai=false,state=null,refreshing=false,feedback,poll;
  const revoked=(await localArea.get('ui.permissionsRevoked'))['ui.permissionsRevoked'];
  const revokedText=()=>revoked?.features?.length?EXTRA.revoked:'';
  let host='';try{host=new URL(url).hostname;}catch{/* unavailable tab */}
  async function run(fn){try{for(let retry=0;retry<8;retry++){const result=await fn(),error=result?.error;if(error?.code!=='confirmation-required'){if(error)showError(error,()=>run(fn));return result;}
    if(!error.destination||!await confirmationCard({...destinationNotice([error.destination]),platform:{...platform,openSettings:onSettings},root:box,group:error.destination.id.startsWith('llm:')?'ai':'common'}))return;
    await acknowledge(localArea,error.destination.id);}}catch(error){showError(error,()=>run(fn));}}
  function showError(error,retry){if(feedback)renderError(feedback,error,{retry,openSettings:onSettings});}
  const button=(text,fn,attrs={})=>{const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',()=>run(fn));return b;};
  async function persist(patch){s=await store.save(patch);if(!closed)draw();}
  async function finish(skip=false){device=await updateDeviceState(localArea,{onboarded:true,upgradeNoticeSeen:true});if(closed)return;draw();if(ai&&!skip)onSettings('ai');}
  const languages=(value,change,id)=>{const select=el('select',null,{'aria-label':T.target,id});for(const l of LANGS)select.append(el('option',l.name,{value:l.code}));select.value=value;select.addEventListener('change',()=>run(()=>change(select.value)));return select;};
  const switchRow=(name,id,checked,onChange,hint='')=>{const row=el('label',null,{class:'feature-row'}),input=el('input',null,{type:'checkbox',role:'switch',id});input.checked=checked;if(hint)row.title=hint;input.addEventListener('change',()=>run(()=>onChange(input)));row.append(el('span',name),input);return row;};
  function onboarding(){
    box.classList.add('dl-onboarding');
    const head=el('header',null,{class:'dl-head'});head.append(el('span',T.step(step),{class:'dl-step'}),button(T.skip,()=>finish(true),{class:'dl-text-button',id:'onboard-skip'}));
    const body=el('div',null,{class:'dl-onboard-body'});body.append(el('h2',step===1?T.languageTitle:step===2?T.engineTitle:T.ready));box.append(head,body);
    if(step===1)body.append(el('p',T.languageHint),languages(s.targetLang,async value=>{s=await store.save({targetLang:value});},'onboard-language'),el('p',T.browser,{class:'dl-hint'}));
    if(step===2){body.append(el('p',T.engineHint));const list=el('div',null,{class:'dl-choices',role:'radiogroup','aria-label':T.engineTitle});for(const [value,title,hint]of[['mt',T.free,T.freeHint],['ai',T.ai,T.aiHint]]){const row=el('label',null,{class:'dl-choice'}),input=el('input',null,{type:'radio',name:'onboard-engine',value});input.checked=(value==='ai')===ai;input.addEventListener('change',()=>{ai=value==='ai';});const content=el('span',title);content.append(el('small',hint));row.append(input,content);list.append(row);}body.append(list);}
    if(step===3){const tips=el('ul',null,{class:'dl-tips'});for(const tip of [...T.tips,...platform.kind!=='extension'?[T.mobile]:[]])tips.append(el('li',tip));body.append(tips);}
    const actions=el('div',null,{class:'dl-actions'});if(step>1)actions.append(button(T.back,()=>{step--;draw();},{class:'dl-text-button',id:'onboard-back'}));actions.append(button(step===3?T.start:T.next,async()=>{
      if(step===2&&!ai){s=await store.save({translation:{mode:'mt+llm',mt:{engine:'microsoft',fallback:true}},provider:{active:'',chain:[]}});await acknowledge(localArea,mtDestination('microsoft'));await acknowledge(localArea,mtDestination('google'));}
      if(step===3)await finish();else{step++;draw();}
    },{class:'primary',id:'onboard-next'}));box.append(actions);queueMicrotask(()=>box.querySelector('#onboard-next')?.focus());
  }
  function draw(){setUiLanguage(s.uiLanguage);localize(root);
    if(closed)return;box.replaceChildren(style);box.classList.remove('dl-onboarding');feedback=el('div',null,{id:'status',class:'dl-feedback dl-status dl-warn',role:'status','aria-live':'polite'});
    if(revokedText()){box.append(el('p',revokedText(),{class:'dl-notice dl-banner',id:'permissions-revoked',role:'status'}));void localArea.remove('ui.permissionsRevoked');}
    if(!device.onboarded){onboarding();box.append(feedback);return;}
    const head=el('header',null,{class:'dl-head'}),links=el('div',null,{class:'dl-head-links'});links.append(button(T.text,onText,{class:'dl-text-button',id:'text-open'}),button(T.settings,()=>onSettings('common'),{class:'dl-text-button',id:'options'}));head.append(el('strong',T.title,{class:'dl-brand'}),links);box.append(head);
    if(stale){const note=el('div',null,{class:'dl-notice dl-banner',id:'stale-notice',role:'status'});note.append(el('p',T.stale),button(T.reload,()=>onReload(),{class:'dl-text-button',id:'reload-extension'}));box.append(note);}
    if(!device.upgradeNoticeSeen){const note=el('div',null,{class:'dl-notice dl-banner',id:'upgrade-notice'});note.append(el('p',T.upgrade),button(T.understood,async()=>{device=await updateDeviceState(localArea,{upgradeNoticeSeen:true});draw();},{class:'dl-text-button'}));box.append(note);void updateDeviceState(localArea,{upgradeNoticeSeen:true});}
    if(pdfAvailable)box.append(button(EXTRA.pdf,onPDF,{id:'pdf-open',class:'dl-hero'}));
    const main=el('section',null,{class:'dl-main'}),label=state?.translated?T.original:T.translate,toggle=button(label,async()=>{const result=await pageMessage({type:'command',name:'toggle-page'});if(result?.error)return result;await refresh();},{class:state?.translated?'dl-hero':'dl-hero primary',id:'toggle'});toggle.disabled=restricted||!state;if(shortcut)toggle.title=T.shortcut(label,shortcut);main.append(toggle,el('p',statusText(),{class:'page-status',id:'page-status','aria-live':'polite'}));
    const row=el('div',null,{class:'display-row'}),target=el('label',null,{class:'target-pick'});target.append(el('span',T.to),languages(s.targetLang,value=>persist({targetLang:value}),'target'));row.append(segmented(doc,T.mode,[['bilingual',T.bilingual],['translation-only',T.translation]],s.displayMode,value=>run(()=>persist({displayMode:value}))),target);main.append(row);
    main.append(engineDisclosure(doc,s,group=>run(()=>onSettings(group))));box.append(main);
    const site=el('section',null,{class:'dl-site'}),siteRow=el('div',null,{class:'site-row'}),mode=host?siteRuleFor(s,url).mode||'':'';
    const apply=async value=>{if(value==='always'&&platform.kind==='extension'&&!await requestBroad(platform.permissionAPI)){draw();showError({code:ERR.PERMISSION});return;}await persist({siteRules:setSitePageRule(s,box.querySelector('#site-path')?.checked?pathPattern(url):host,value)});};
    const pick=el('select',null,{id:'site-mode','aria-label':T.site});for(const [value,name]of[['',T.demand],['always',T.always],['never',T.never]])pick.append(el('option',name,{value}));pick.value=mode;pick.disabled=!host;pick.addEventListener('change',()=>run(()=>apply(pick.value)));
    siteRow.append(el('span',T.site,{class:'site-label'}),el('span',host||'—',{class:'host',title:host}),pick);site.append(siteRow);
    if(mode){const scope=pathPattern(url),path=switchRow(l10n('polishPath',[scope.slice(scope.indexOf('/'))]),'site-path',!!siteRuleFor(s,url).custom?.match?.includes('/'),async input=>{let next={...s,siteRules:setSitePageRule(s,host,'')};next.siteRules=setSitePageRule(next,scope,'');await persist({siteRules:setSitePageRule(next,input.checked?scope:host,mode)});},`${scope} · ${mode==='always'?l10n('polishAlwaysHint'):l10n('polishNeverHint')}`);path.classList.replace('feature-row','path-row');site.append(path);}box.append(site);
    const features=el('section',null,{class:'dl-more','aria-label':T.enhance});features.append(el('h2',T.enhance));
    for(const [key,name]of FEATURES){const rowName=key==='hover'?hoverRow(s,platform.coarse):ROW[key]||name;const label=switchRow(rowName,`feature-${key}`,s[key].enabled,async input=>{const enabled=input.checked;if(enabled&&platform.kind==='extension'&&featureNeedsBroad(key)&&!await requestBroad(platform.permissionAPI)){input.checked=false;showError({code:ERR.PERMISSION});return;}await persist({[key]:{enabled}});},featureDescription(key,s,platform.coarse));label.querySelector('input').setAttribute('aria-label',name);features.append(label);
      if(key==='comics'&&s.comics.enabled&&!restricted)features.append(button(EXTRA.images,async()=>{await pageMessage({type:'command',name:'translate-comics'});await refresh();},{id:'comics',class:'dl-text-button dl-subaction'}));}
    box.append(features,feedback);const pageStatus=box.querySelector('#page-status');if(restricted&&!stale)renderError(pageStatus,{code:accessError||ERR.RESTRICTED},{retry:()=>platform.reloadPage?.(),openSettings:onSettings});else if(state?.failed)renderError(pageStatus,{...state.error,code:ERR.PARTIAL,category:'partial',count:state.failed},{partial:true,retry:()=>run(async()=>{await pageMessage({type:'command',name:'retry-failed'});await refresh();}),openSettings:state.error?.action==='settings'?()=>onSettings(state.error.group):undefined});if(platform.coarse)box.append(head);
  }
  function statusText(){if(restricted)return stale?'':T.restricted;if(!state||!state.translated)return '';const done=state.done??Math.max(0,(state.units||0)-(state.pending||0)-(state.failed||0));if(!done&&!state.failed)return l10n('polishTranslating');return T.progress(done,state.pending,state.failed,state.refining);}
  async function refresh(){if(closed||refreshing||restricted)return;refreshing=true;let changed=false;try{const next=await pageMessage({type:'get-state'});if(!next){restricted=true;changed=true;}else if(JSON.stringify(next)===JSON.stringify(state))return;else {state=next;changed=true;}}catch{restricted=true;changed=true;}finally{refreshing=false;if(changed&&!closed&&device.onboarded)draw();}}
  // Focus rings belong to keyboard use. The initial programmatic focus stays silent until a key is pressed.
  box.addEventListener('keydown',e=>{box.dataset.keyboard='';if(e.key==='Escape'&&!device.onboarded){e.preventDefault();void finish(true);}});box.addEventListener('pointerdown',()=>{delete box.dataset.keyboard;});
  draw();await refresh();if(device.onboarded)box.querySelector('#toggle')?.focus();poll=setInterval(refresh,1000);
  const off=store.onChange?.(async()=>{s=await store.load();if(!closed)draw();});return {refresh,destroy(){closed=true;clearInterval(poll);off?.();box.remove();}};
}

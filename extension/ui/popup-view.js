import { t as l10n, uiLanguage } from '../shared/i18n.js';
import {confirmationCard} from '../content/confirmation.js';
import {destinationMessage} from '../shared/destinations.js';
import { LANGS,siteRuleFor,setSitePageRule } from '../shared/settings.js';
import { loadDeviceState,updateDeviceState,acknowledge,mtDestination } from '../shared/device-state.js';
import { featureNeedsBroad,requestBroad } from '../shared/permissions.js';
import { pathPattern } from '../shared/site-pattern.js';
import { FEATURES,TEXT as COMMON,element,segmented,engineSummary,featureDescription } from './components.js';
import { SHARED_CSS } from './theme.js';
import { POPUP_CSS } from './popup-theme.js';
const EXTRA = { revoked:l10n('mi4'),
  pdf:l10n('m18'), images:l10n('mi5') };
const T=Object.freeze({title:'DualLens',text:l10n('ma6'),settings:l10n('m4n'),translate:l10n('m4c'),original:l10n('m4d'),idle:l10n('mi6'),restricted:l10n('mi7'),connecting:l10n('mi8'),mode:l10n('me1'),bilingual:l10n('me2'),translation:l10n('m4f'),target:l10n('mi9'),to:l10n('mia'),engine:l10n('mib'),change:l10n('mic'),site:l10n('m4g'),demand:l10n('m4h'),always:l10n('m4i'),never:l10n('m4j'),path:l10n('mid'),pathHint:l10n('mie'),enhance:l10n('mh4'),off:l10n('mif'),skip:l10n('mig'),next:l10n('mih'),back:l10n('mii'),start:l10n('mij'),languageTitle:l10n('mik'),languageHint:l10n('mil'),browser:l10n('mim'),engineTitle:l10n('min'),engineHint:l10n('mio'),free:l10n('mip'),freeHint:l10n('miq'),ai:l10n('mir'),aiHint:l10n('mis'),ready:l10n('mit'),tips:[l10n('miu'),l10n('miv'),l10n('miw')],mobile:l10n('mix'),upgrade:l10n('miy'),understood:l10n('miz'),failure:l10n('mj0'),step:n=>l10n('mj1', [n]),progress:(done,pending,failed,refining)=>l10n('mj5', [done, refining?l10n('mj2', [refining]):'', pending?l10n('mj3', [pending]):'', failed?l10n('mj4', [failed]):''])});

export async function mountPopup(root,{store,platform,localArea=platform.localArea,url='',pageMessage,onSettings=()=>platform.openSettings(),onText=()=>platform.openTextTranslation?.(),shortcut='',restricted=false,pdfAvailable=false,onPDF}) {
  const doc=root.ownerDocument,el=(tag,text,attrs)=>element(doc,tag,text,attrs),box=el('div',null,{class:'dl-theme dl-popup',lang:uiLanguage()}),style=el('style',SHARED_CSS+POPUP_CSS);box.append(style);root.append(box);
  let s=await store.load(),device=await loadDeviceState(localArea),closed=false,step=1,ai=false,state=null,refreshing=false,feedback,poll;
  const revoked=(await localArea.get('ui.permissionsRevoked'))['ui.permissionsRevoked'];
  const revokedText=revoked?.features?.length?EXTRA.revoked:'';
  let host='';try{host=new URL(url).hostname;}catch{/* unavailable tab */}
  const say=message=>{if(feedback)feedback.textContent=message;};
  async function run(fn){try{for(let retry=0;retry<8;retry++){const result=await fn(),error=result?.error;if(error?.code!=='confirmation-required')return result;
    if(!error.destination||!await confirmationCard({message:destinationMessage(error.destination),platform:{...platform,openSettings:onSettings},root:box}))return;
    await acknowledge(localArea,error.destination.id);}}catch(error){say(error.message||T.failure);}}
  const button=(text,fn,attrs={})=>{const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',()=>run(fn));return b;};
  async function persist(patch){s=await store.save(patch);if(!closed)draw();}
  async function finish(skip=false){device=await updateDeviceState(localArea,{onboarded:true,upgradeNoticeSeen:true});if(closed)return;draw();if(ai&&!skip)onSettings('ai');}
  const languages=(value,change,id)=>{const select=el('select',null,{'aria-label':T.target,id});for(const l of LANGS)select.append(el('option',l.name,{value:l.code}));select.value=value;select.addEventListener('change',()=>run(()=>change(select.value)));return select;};
  function onboarding(){
    box.classList.add('dl-onboarding');const head=el('header');head.append(el('span',T.step(step)),el('span',[1,2,3].map(n=>n===step?'●':'○').join(''),{class:'dl-dots','aria-hidden':'true'}),button(T.skip,()=>finish(true),{class:'dl-text-button',id:'onboard-skip'}));box.append(head,el('h2',step===1?T.languageTitle:step===2?T.engineTitle:T.ready));
    if(step===1)box.append(el('p',T.languageHint),languages(s.targetLang,async value=>{s=await store.save({targetLang:value});},'onboard-language'),el('p',T.browser));
    if(step===2){box.append(el('p',T.engineHint));for(const [value,title,hint]of[['mt',T.free,T.freeHint],['ai',T.ai,T.aiHint]]){const row=el('label',null,{class:'dl-radio-card'}),input=el('input',null,{type:'radio',name:'onboard-engine',value});input.checked=(value==='ai')===ai;input.addEventListener('change',()=>{ai=value==='ai';});const content=el('span',title);content.append(el('small',hint));row.append(input,content);box.append(row);}}
    if(step===3){for(const tip of T.tips)box.append(el('p',tip));if(platform.kind!=='extension')box.append(el('p',T.mobile));}
    const actions=el('div',null,{class:'dl-actions'});if(step>1)actions.append(button(T.back,()=>{step--;draw();}));actions.append(button(step===3?T.start:T.next,async()=>{
      if(step===2&&!ai){s=await store.save({translation:{mode:'mt+llm',mt:{engine:'microsoft',fallback:true}},provider:{active:'',chain:[]}});await acknowledge(localArea,mtDestination('microsoft'));await acknowledge(localArea,mtDestination('google'));}
      if(step===3)await finish();else{step++;draw();}
    },{class:'primary',id:'onboard-next'}));box.append(actions);queueMicrotask(()=>box.querySelector('#onboard-next')?.focus());
  }
  function draw(){
    if(closed)return;box.replaceChildren(style);box.classList.remove('dl-onboarding');feedback=el('div',null,{id:'status',class:'dl-feedback dl-status dl-warn',role:'status','aria-live':'polite'});
    if(revokedText){box.append(el('p',revokedText,{class:'dl-notice',id:'permissions-revoked',role:'status'}));void localArea.remove('ui.permissionsRevoked');}
    if(!device.onboarded){onboarding();box.append(feedback);return;}
    const head=el('header');head.append(el('span','◯◯',{class:'dl-mark','aria-hidden':'true'}),el('strong',T.title),button(T.text,onText,{class:'dl-text-button',id:'text-open'}),button(T.settings,()=>onSettings('common'),{class:'dl-text-button',id:'options'}));box.append(head);
    if(pdfAvailable)box.append(button(EXTRA.pdf,onPDF,{id:'pdf-open'}));
    if(s.comics.enabled&&!restricted)box.append(button(EXTRA.images,async()=>{await pageMessage({type:'command',name:'translate-comics'});await refresh();},{id:'comics'}));
    if(!device.upgradeNoticeSeen){const note=el('div',null,{class:'dl-notice',id:'upgrade-notice'});note.append(el('p',T.upgrade),button(T.understood,async()=>{device=await updateDeviceState(localArea,{upgradeNoticeSeen:true});draw();}));box.append(note);void updateDeviceState(localArea,{upgradeNoticeSeen:true});}
    const card=el('section',null,{class:'dl-card'}),toggle=button(state?.translated?T.original:T.translate,async()=>{const result=await pageMessage({type:'command',name:'toggle-page'});if(result?.error)return result;await refresh();},{class:state?.translated?'dl-hero':'dl-hero primary',id:'toggle'});toggle.disabled=restricted||!state;if(shortcut)toggle.append(el('kbd',shortcut));card.append(toggle,el('p',statusText(),{class:'page-status dl-status',id:'page-status','aria-live':'polite'}));
    const row=el('div',null,{class:'display-row'});row.append(segmented(doc,T.mode,[['bilingual',T.bilingual],['translation-only',T.translation]],s.displayMode,value=>run(()=>persist({displayMode:value}))),el('span',T.to),languages(s.targetLang,value=>persist({targetLang:value}),'target'));card.append(row);
    const summary=engineSummary(s),engine=el('div',null,{class:'engine-row'});engine.append(el('span',T.engine),el('strong',summary.name),button(T.change,()=>onSettings(summary.group),{class:'dl-text-button'}));card.append(engine,el('p',summary.privacy,{class:'privacy',title:summary.full}));box.append(card);
    const site=el('section',null,{class:'dl-card'}),siteHead=el('div',null,{class:'site-head'}),mode=host?siteRuleFor(s,url).mode||'':'';
    const apply=async value=>{if(value==='always'&&platform.kind==='extension'&&!await requestBroad(platform.permissionAPI)){draw();say(COMMON.denied);return;}await persist({siteRules:setSitePageRule(s,box.querySelector('#site-path')?.checked?pathPattern(url):host,value)});};
    const seg=segmented(doc,T.site,[['',T.demand],['always',T.always],['never',T.never]],mode,value=>run(()=>apply(value)));if(!host)for(const input of seg.querySelectorAll('input'))input.disabled=true;siteHead.append(el('strong',T.site),seg);site.append(siteHead,el('p',host||'—',{class:'host',title:host}));
    if(mode){const path=el('label',null,{class:'path-row'}),input=el('input',null,{type:'checkbox',id:'site-path'});input.checked=!!siteRuleFor(s,url).custom?.match?.includes('/');input.addEventListener('change',()=>run(async()=>{let next={...s,siteRules:setSitePageRule(s,host,'')};next.siteRules=setSitePageRule(next,pathPattern(url),'');await persist({siteRules:setSitePageRule(next,input.checked?pathPattern(url):host,mode)});}));path.append(input,doc.createTextNode(T.path));site.append(path);}box.append(site);
    const features=el('section',null,{class:'dl-card'}),title=el('div',null,{class:'feature-heading'});title.append(el('strong',T.enhance),el('small',T.off));features.append(title);
    for(const [key,name]of FEATURES){const label=el('label',null,{class:'feature-row'}),input=el('input',null,{type:'checkbox',role:'switch','aria-label':name,id:`feature-${key}`});input.checked=s[key].enabled;input.addEventListener('change',()=>run(async()=>{const enabled=input.checked;if(enabled&&platform.kind==='extension'&&featureNeedsBroad(key)&&!await requestBroad(platform.permissionAPI)){input.checked=false;say(COMMON.denied);return;}await persist({[key]:{enabled}});}));label.append(el('span',name),el('small',featureDescription(key,s,platform.coarse)),input);features.append(label);}box.append(features,feedback);if(platform.coarse)box.append(head);
  }
  function statusText(){if(restricted)return T.restricted;if(!state)return T.connecting;if(!state.translated)return T.idle;return T.progress(state.done??Math.max(0,(state.units||0)-(state.pending||0)-(state.failed||0)),state.pending,state.failed,state.refining);}
  async function refresh(){if(closed||refreshing||restricted)return;refreshing=true;let changed=false;try{const next=await pageMessage({type:'get-state'});if(!next){restricted=true;changed=true;}else if(JSON.stringify(next)===JSON.stringify(state))return;else {state=next;changed=true;}}catch{restricted=true;changed=true;}finally{refreshing=false;if(changed&&!closed&&device.onboarded)draw();}}
  box.addEventListener('keydown',e=>{if(e.key==='Escape'&&!device.onboarded){e.preventDefault();void finish(true);}});draw();await refresh();if(device.onboarded)box.querySelector('#toggle')?.focus();poll=setInterval(refresh,1000);
  const off=store.onChange?.(async()=>{s=await store.load();if(!closed)draw();});return {refresh,destroy(){closed=true;clearInterval(poll);off?.();box.remove();}};
}

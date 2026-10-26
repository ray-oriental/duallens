import { t as l10n, uiLanguage, message, setText, setAttribute } from '../shared/i18n.js';
import { activeProfile, providerChain } from '../shared/settings.js';
import { isLocalUrl } from '../shared/device-state.js';
export const TEXT = Object.freeze({
  get showKey(){return l10n('mar');},get hideKey(){return l10n('mas');},get discard(){return l10n('mat');},
  get features() { return [['floatBall',l10n('mau'),l10n('mav')],['selection',l10n('maw'),l10n('max')],['hover',l10n('may'),l10n('maz')],['input',l10n('mb0'),l10n('mb1')],['subtitles',l10n('mao'),l10n('mb2')],['comics',l10n('mb3'),l10n('mb4')]]; },
  get denied(){return l10n('mb5');}, mt:{get microsoft(){return l10n('mb6');},get google(){return l10n('mb7');},get 'microsoft-api'(){return l10n('mb8');},deepl:'DeepL',get mock(){return l10n('mb9');}},get local(){return l10n('mba');},get none(){return l10n('mbb');},
});
export const FEATURES=TEXT.features.map(([id],i)=>Object.defineProperties([id],{1:{get:()=>TEXT.features[i][1]},2:{get:()=>TEXT.features[i][2]}}));
export function element(doc,tag,text,attrs={}) {const n=doc.createElement(tag);if(text!=null)setText(n,text);for(const [k,v] of Object.entries(attrs))setAttribute(n,k,v);return n;}
export function segmented(doc,name,values,selected,onChange) {
  const group=element(doc,'fieldset',null,{class:'dl-segment','aria-label':name});
  for(const [value,label] of values) {const row=element(doc,'label'),input=element(doc,'input',null,{type:'radio',name,value});input.checked=value===selected;input.addEventListener('change',()=>{if(input.checked)onChange(value);});row.append(input,element(doc,'span',label));group.append(row);}return group;
}
// Chinese typesetting: a word space where Han characters meet Latin letters or digits.
export function spaced(text) {return uiLanguage()==='zh-CN'?String(text).replace(/(\p{sc=Han})([A-Za-z0-9])/gu,'$1 $2').replace(/([A-Za-z0-9.%])(\p{sc=Han})/gu,'$1 $2'):String(text);}
export function engineSummary(s) {
  const p=activeProfile(s),ai=p&&(p.kind==='mock'||p.baseUrl&&p.model),mode=s.translation.mode,engine=s.translation.mt.engine,mt=TEXT.mt[engine]||engine;
  const fallback=s.translation.mt.fallback&&['microsoft','google'].includes(engine)?TEXT.mt[engine==='microsoft'?'google':'microsoft']:'';
  const hostList=[...new Set(providerChain(s).filter(c=>c.profile.kind!=='mock').map(c=>{try{return new URL(c.profile.baseUrl).host;}catch{return c.profile.name;}}))],hosts=hostList.join(l10n('listSeparator'));
  // `short` is the one-line popup form: name · recipients, the fallback stated as a condition. `full` is the sentence used in Settings.
  const line=(name,to)=>spaced(`${name} · ${to}`),join=list=>list.filter(Boolean).join(l10n('listSeparator'));
  const sentTo=(list,alt='',compact=false)=>!alt?l10n('lookSentTo',[join(list)]):compact?l10n('lookFallbackShort',[alt]):l10n('lookSentFallback',[join(list),alt]);
  if(mode==='llm') {if(!ai)return {get name(){return l10n('m5x');},privacy:TEXT.none,full:TEXT.none,get short(){return l10n('lookNoAI');},group:'ai'};const local=providerChain(s).every(c=>c.profile.kind==='mock'||isLocalUrl(c.profile.baseUrl)),name=local?l10n('mbc', [p.name]):p.name;return {name,privacy:local?TEXT.local:l10n('mbd', [hosts||p.name]),full:local?TEXT.local:l10n('mbe', [hosts||p.name]),short:line(name,local?l10n('lookLocal'):sentTo(hostList.length?hostList:[p.name])),group:'ai'};}
  const mtLine=l10n('mbh', [mt, fallback?l10n('mbf', [fallback]):'', ['deepl','microsoft-api'].includes(engine)?l10n('mbg'):'']);
  if(ai&&mode!=='mt')return {get name(){return l10n('mbi');},privacy:l10n('mbj', [mtLine]),full:l10n('mbk', [mtLine, hosts||p.name]),short:line(l10n('mbi'),sentTo([mt,...(hostList.length?hostList:[p.name])],fallback)),group:'ai'};
  const name=['microsoft','google'].includes(engine)?l10n('lookFreeMT',[mt]):mt;
  return {name:l10n('mbm', [mt, ['microsoft','google'].includes(engine)?l10n('mbl'):'']),privacy:mtLine,full:mtLine,short:line(name,sentTo([mt],fallback,uiLanguage()!=='zh-CN')),group:'common'};
}
export function featureDescription(key,s,coarse=false) {if(key==='hover')return coarse?l10n('mbn'):s.hover.modifier==='none'?l10n('mbo'):l10n('mbp', [s.hover.modifier==='Control'?'Ctrl':s.hover.modifier]);if(key==='input'&&s.input.trigger==='shortcut')return l10n('uxInputShortcut');return FEATURES.find(f=>f[0]===key)?.[2]||'';}

// One quiet line: engine and every recipient; the conditional wording stays in the tooltip.
export function engineDisclosure(doc,s,onChange) {
  const summary=engineSummary(s),box=element(doc,'div',null,{class:'engine-disclosure'}),row=element(doc,'p',null,{class:'engine-line'}),change=element(doc,'button',l10n('mic'),{type:'button',class:'dl-text-button'});
  change.onclick=()=>onChange(summary.group);row.append(element(doc,'span',summary.short,{class:'engine-text',title:summary.full}),change);box.append(row);return box;
}

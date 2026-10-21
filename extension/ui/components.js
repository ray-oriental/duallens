import { t as l10n } from '../shared/i18n.js';
import { activeProfile, providerChain } from '../shared/settings.js';
import { isLocalUrl } from '../shared/device-state.js';
export const TEXT = Object.freeze({
  showKey:l10n('mar'),hideKey:l10n('mas'),discard:l10n('mat'),
  features: [['floatBall',l10n('mau'),l10n('mav')],['selection',l10n('maw'),l10n('max')],['hover',l10n('may'),l10n('maz')],['input',l10n('mb0'),l10n('mb1')],['subtitles',l10n('mao'),l10n('mb2')],['comics',l10n('mb3'),l10n('mb4')]],
  denied:l10n('mb5'), mt:{microsoft:l10n('mb6'),google:l10n('mb7'),'microsoft-api':l10n('mb8'),deepl:'DeepL',mock:l10n('mb9')},local:l10n('mba'),none:l10n('mbb'),
});
export const FEATURES=TEXT.features;
export function element(doc,tag,text,attrs={}) {const n=doc.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;}
export function segmented(doc,name,values,selected,onChange) {
  const group=element(doc,'fieldset',null,{class:'dl-segment','aria-label':name});
  for(const [value,label] of values) {const row=element(doc,'label'),input=element(doc,'input',null,{type:'radio',name,value});input.checked=value===selected;input.addEventListener('change',()=>{if(input.checked)onChange(value);});row.append(input,element(doc,'span',label));group.append(row);}return group;
}
export function engineSummary(s) {
  const p=activeProfile(s),ai=p&&(p.kind==='mock'||p.baseUrl&&p.model),mode=s.translation.mode,engine=s.translation.mt.engine,mt=TEXT.mt[engine]||engine;
  const fallback=s.translation.mt.fallback&&['microsoft','google'].includes(engine)?TEXT.mt[engine==='microsoft'?'google':'microsoft']:'';
  const hosts=[...new Set(providerChain(s).filter(c=>c.profile.kind!=='mock').map(c=>{try{return new URL(c.profile.baseUrl).host;}catch{return c.profile.name;}}))].join(l10n('listSeparator'));
  if(mode==='llm') {if(!ai)return {name:l10n('m5x'),privacy:TEXT.none,full:TEXT.none,group:'ai'};const local=providerChain(s).every(c=>c.profile.kind==='mock'||isLocalUrl(c.profile.baseUrl));return {name:local?l10n('mbc', [p.name]):p.name,privacy:local?TEXT.local:l10n('mbd', [hosts||p.name]),full:local?TEXT.local:l10n('mbe', [hosts||p.name]),group:'ai'};}
  const mtLine=l10n('mbh', [mt, fallback?l10n('mbf', [fallback]):'', ['deepl','microsoft-api'].includes(engine)?l10n('mbg'):'']);
  if(ai&&mode!=='mt')return {name:l10n('mbi'),privacy:l10n('mbj', [mtLine]),full:l10n('mbk', [mtLine, hosts||p.name]),group:'ai'};
  return {name:l10n('mbm', [mt, ['microsoft','google'].includes(engine)?l10n('mbl'):'']),privacy:mtLine,full:mtLine,group:'common'};
}
export function featureDescription(key,s,coarse=false) {if(key==='hover')return coarse?l10n('mbn'):s.hover.modifier==='none'?l10n('mbo'):l10n('mbp', [s.hover.modifier==='Control'?'Ctrl':s.hover.modifier]);if(key==='input'&&s.input.trigger==='shortcut')return l10n('mbq');return FEATURES.find(f=>f[0]===key)?.[2]||'';}

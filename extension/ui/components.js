import { activeProfile, providerChain } from '../shared/settings.js';
import { isLocalUrl } from '../shared/device-state.js';
export const TEXT = Object.freeze({
  showKey:'显示密钥',hideKey:'隐藏密钥',discard:'有未保存的修改，要放弃这些修改吗？',
  features: [['floatBall','悬浮球','页面边缘的快捷按钮'],['selection','划词翻译','选中文字后显示翻译'],['hover','悬停翻译','按住 Shift 翻译段落'],['input','输入框翻译','连按三次空格翻译'],['subtitles','视频字幕','给视频加双语字幕'],['comics','图片文字','识别图片文字再翻译']],
  denied:'未获得网站访问权限，功能保持关闭。', mt:{microsoft:'微软',google:'谷歌','microsoft-api':'微软官方 API',deepl:'DeepL',mock:'离线测试'},local:'文字只发送到你本机的服务。',none:'未选择 AI 服务，请先在设置里添加。',
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
  const hosts=[...new Set(providerChain(s).filter(c=>c.profile.kind!=='mock').map(c=>{try{return new URL(c.profile.baseUrl).host;}catch{return c.profile.name;}}))].join('、');
  if(mode==='llm') {if(!ai)return {name:'AI 服务',privacy:TEXT.none,full:TEXT.none,group:'ai'};const local=providerChain(s).every(c=>c.profile.kind==='mock'||isLocalUrl(c.profile.baseUrl));return {name:local?`本地模型 ${p.name}`:p.name,privacy:local?TEXT.local:`文字和页面标题会发送给 ${hosts||p.name}。`,full:local?TEXT.local:`网页文字和页面标题会发送给 ${hosts||p.name}。`,group:'ai'};}
  const mtLine=`网页文字会发送给${mt}${fallback?`，失败时改用${fallback}`:''}。${['deepl','microsoft-api'].includes(engine)?'失败时直接报错，不转发到免费端点。':''}`;
  if(ai&&mode!=='mt')return {name:'机器翻译 + AI 精修',privacy:`${mtLine}文字和页面标题也会发送给所选 AI 服务。`,full:`${mtLine}网页文字和页面标题也会发送给 ${hosts||p.name}。`,group:'ai'};
  return {name:`${mt}机器翻译${['microsoft','google'].includes(engine)?'（免费）':''}`,privacy:mtLine,full:mtLine,group:'common'};
}
export function featureDescription(key,s,coarse=false) {if(key==='hover')return coarse?'长按段落翻译':s.hover.modifier==='none'?'停留片刻翻译段落':`按住 ${s.hover.modifier==='Control'?'Ctrl':s.hover.modifier} 翻译段落`;if(key==='input'&&s.input.trigger==='shortcut')return '按 Alt+I 翻译输入框';return FEATURES.find(f=>f[0]===key)?.[2]||'';}

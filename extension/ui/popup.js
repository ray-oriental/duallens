import { loadSettings, saveSettings, LANGS, STYLES, TRANSLATION_MODES, siteRuleFor, activeProfile, setSitePageRule } from '../shared/settings.js';
import { pathPattern } from '../shared/site-pattern.js';
import { MT_ENGINES } from '../background/mt.js';
import * as P from '../shared/protocol.js';
import { $, options, notice, request, errorText, busy } from './common.js';
let settings, tab, host='', state;
function draw() {
  options($('target'),LANGS,settings.targetLang); options($('style'),STYLES,settings.style);
  options($('profile'),[{id:'',name:'未配置（仅机器翻译）'},...settings.provider.profiles],settings.provider.active);
  options($('tmode'),TRANSLATION_MODES,settings.translation.mode); options($('engine'),MT_ENGINES,settings.translation.mt.engine);
  const profile=activeProfile(settings);
  $('mode').value=settings.displayMode; $('model').value=profile?.model || '';
  for(const id of ['model','load-models','test']) $(id).disabled=!profile;
  $('site').value=host ? siteRuleFor(settings,tab.url).mode || '' : ''; $('site').disabled=!host; $('site-scope').disabled=!host;
  $('subscription').hidden=!/^(claude|codex)\//.test(profile?.model || '');
}
async function pageMessage(msg) { if (!tab?.id) throw new Error('没有可翻译的标签页'); return chrome.tabs.sendMessage(tab.id,msg); }
async function refresh() {
  try {
    state=await pageMessage({type:P.MSG_GET_STATE});
    $('page-status').textContent=state.translated ? `已翻译 ${state.done ?? (state.units-state.pending-state.failed)} 段${state.refining ? ` · 精修中 ${state.refining}` : ''} · 待处理 ${state.pending} · 失败 ${state.failed}` : state.dormant ? '本页不自动翻译；仍可点击翻译当前页面。' : '已准备好，翻译靠近视口的段落。';
    $('toggle').textContent=state.translated ? '恢复原文' : '翻译当前页面'; $('toggle').disabled=false;
    $('comics').disabled=!settings.comics.enabled;
  } catch { $('page-status').textContent='此页面不能运行扩展，或扩展刚更新；请打开普通网页并刷新。'; $('toggle').disabled=true;$('comics').disabled=true; }
}
async function persist(patch) { settings=await saveSettings(patch); draw(); await refresh(); }
function activeModel() { return activeProfile(settings); }
$('target').addEventListener('change',()=>busy($('target'),()=>persist({targetLang:$('target').value})));
$('style').addEventListener('change',()=>busy($('style'),()=>persist({style:$('style').value})));
$('mode').addEventListener('change',()=>busy($('mode'),()=>persist({displayMode:$('mode').value})));
$('tmode').addEventListener('change',()=>busy($('tmode'),()=>persist({translation:{mode:$('tmode').value}})));
$('engine').addEventListener('change',()=>busy($('engine'),()=>persist({translation:{mt:{engine:$('engine').value}}})));
$('mt-test').addEventListener('click',()=>busy($('mt-test'),async()=>{
  notice('正在测试机器翻译…'); const r=await request('mt-test',{engine:settings.translation.mt.engine,region:settings.translation.mt.region});
  if (!r.ok) throw new Error(errorText(r)); notice(`机器翻译正常 · ${r.engine} · ${r.latencyMs} ms · ${r.sample||''}`);
}));
$('profile').addEventListener('change',()=>busy($('profile'),()=>persist({provider:{active:$('profile').value}})));
$('model').addEventListener('change',()=>busy($('model'),async()=>{
  const model=$('model').value.trim(); if (!model) throw new Error('请填写模型标识');
  const profiles=settings.provider.profiles.map(p=>p.id===settings.provider.active ? {...p,model,fallbackModels:/^(claude|codex)\//.test(model)?[]:p.fallbackModels}:p);
  await persist({provider:{profiles}});
}));
$('toggle').addEventListener('click',()=>busy($('toggle'),async()=>{ await pageMessage({type:P.MSG_COMMAND,name:P.COMMANDS.TOGGLE_PAGE}); await refresh(); }));
$('comics').addEventListener('click',()=>busy($('comics'),async()=>{await pageMessage({type:P.MSG_COMMAND,name:'translate-comics'});await refresh();}));
$('site').addEventListener('change',()=>busy($('site'),async()=>{
  const mode=$('site').value;
  const match=$('site-scope').value==='path' ? pathPattern(tab.url) : host;
  await persist({siteRules:setSitePageRule(settings,match,mode)});
  const applied=siteRuleFor(settings,tab.url).mode;
  notice((applied||'')!==mode?'本站仍被通配规则命中，请到全部设置修改。':'站点规则已保存');
}));
$('load-models').addEventListener('click',()=>busy($('load-models'),async()=>{
  const r=await request(P.MSG_LIST_MODELS,{profileId:settings.provider.active});
  if (!r.ok) throw new Error(errorText(r));
  options($('models'),r.models||[]); notice(`获取到 ${r.models?.length||0} 个模型，选择后生效`);
}));
$('test').addEventListener('click',()=>busy($('test'),async()=>{
  notice('正在翻译测试文本…'); const r=await request(P.MSG_PROVIDER_TEST,{profileId:settings.provider.active});
  if (!r.ok) throw new Error(errorText(r)); notice(`连接正常 · ${r.latencyMs} ms · ${r.sample||''}`);
}));
$('options').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('pdf-open').addEventListener('click',()=>busy($('pdf-open'),async()=>{
  const r=await request('pdf-open',{tabId:tab.id}); if(!r.ok) throw new Error(errorText(r)); window.close();
}));
try {
  settings=await loadSettings(); [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.url) { try { host=new URL(tab.url).hostname; } catch {} } draw(); await refresh();
  const pdf=await request('pdf-status',{tabId:tab?.id});
  $('pdf-open').hidden=!pdf.available; $('pdf-open').disabled=!pdf.available;
}
catch(e) { notice(e.message,true); }
const poll=setInterval(refresh,700); window.addEventListener('pagehide',()=>clearInterval(poll),{once:true});

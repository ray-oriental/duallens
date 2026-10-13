import { loadSettings, saveSettings, LANGS, STYLES } from '../shared/settings.js';
import * as P from '../shared/protocol.js';
import { $, options, notice, request, busy, errorText } from './common.js';
import { validateSettings, safeExport, importSettings, lines, terms } from './validation.js';
let settings, profileId;
const simple = ['targetLang','sourceLang','displayMode','style','minChars','inlineMaxChars'];
const nums = new Set(['minChars','inlineMaxChars','rootMarginPx','batchDelayMs','maxItems','maxChars','concurrency','timeoutMs','maxEntries','ttlDays']);
const bind = {
  rootMarginPx:'lazy.rootMarginPx', batchDelayMs:'lazy.batchDelayMs', hoverEnabled:'hover.enabled', hoverModifier:'hover.modifier',
  selectionEnabled:'selection.enabled', showIcon:'selection.showIcon', inputEnabled:'input.enabled', inputLang:'input.targetLang', inputTrigger:'input.trigger', prefixOverride:'input.prefixOverride',
  floatEnabled:'floatBall.enabled', floatSide:'floatBall.side', preset:'prompt.preset', customPrompt:'prompt.custom', cacheEnabled:'cache.enabled', maxEntries:'cache.maxEntries', ttlDays:'cache.ttlDays'
};
function getPath(obj,path) { return path.split('.').reduce((v,k)=>v[k],obj); }
function putPath(obj,path,value) { const ks=path.split('.'); const k=ks.pop(); let target=obj; for(const part of ks) target=target[part]; target[k]=value; }
function fill(id,value) { if($(id).type==='checkbox') $(id).checked=value; else $(id).value=value; }
function read(id) { return $(id).type==='checkbox'?$(id).checked:nums.has(id)?Number($(id).value):$(id).value; }
function profile() { return settings.provider.profiles.find(p=>p.id===profileId); }
function drawProfile() {
  const p=profile();
  for(const id of ['model','maxItems','maxChars','concurrency','timeoutMs']) fill(id,p[id]);
  fill('profileName',p.name); fill('baseUrl',p.baseUrl||''); fill('apiKey',p.apiKey||''); fill('jsonMode',p.jsonMode ?? true);
  fill('fallbackModels',(p.fallbackModels||[]).join('\n'));
  $('key-row').hidden=p.kind!=='openai'; $('baseUrl').disabled=p.kind==='mock'; $('jsonMode').disabled=p.kind==='mock';
}
function captureProfile() {
  const p=profile(); p.name=read('profileName').trim(); p.model=read('model').trim();
  for(const id of ['maxItems','maxChars','concurrency','timeoutMs']) p[id]=read(id);
  if(p.kind!=='mock') { p.baseUrl=read('baseUrl').trim(); p.jsonMode=read('jsonMode'); }
  if(p.kind==='openai') p.apiKey=read('apiKey').trim();
  p.fallbackModels=/^(claude|codex)\//.test(p.model)?[]:lines(read('fallbackModels'));
}
function draw() {
  options($('targetLang'),LANGS,settings.targetLang); options($('sourceLang'),[{code:'auto',name:'自动检测'},...LANGS],settings.sourceLang);
  options($('inputLang'),LANGS,settings.input.targetLang); options($('style'),STYLES,settings.style); options($('autoLangs'),LANGS);
  for(const o of $('autoLangs').options) o.selected=settings.autoTranslateLangs.includes(o.value);
  for(const id of simple) fill(id,settings[id]); for(const [id,path] of Object.entries(bind)) fill(id,getPath(settings,path));
  fill('glossary',settings.glossary.map(t=>`${t.src} → ${t.dst}`).join('\n')); fill('always',settings.siteRules.always.join('\n')); fill('never',settings.siteRules.never.join('\n')); fill('customRules',JSON.stringify(settings.siteRules.custom,null,2));
  options($('profile'),settings.provider.profiles,settings.provider.active); profileId=settings.provider.active; drawProfile();
}
function collect() {
  const next=structuredClone(settings);
  for(const id of simple) next[id]=read(id); for(const [id,path] of Object.entries(bind)) putPath(next,path,read(id));
  next.glossary=terms(read('glossary')); next.siteRules.always=lines(read('always')).map(x=>x.toLowerCase()); next.siteRules.never=lines(read('never')).map(x=>x.toLowerCase());
  next.autoTranslateLangs=[...$('autoLangs').selectedOptions].map(x=>x.value);
  try { next.siteRules.custom=JSON.parse(read('customRules')||'[]'); } catch { throw new Error('自定义规则不是有效JSON'); }
  if(Array.isArray(next.siteRules.custom)) for(const r of next.siteRules.custom) for(const field of ['include','exclude']) {
    for(const selector of Array.isArray(r[field])?r[field]:r[field]?[r[field]]:[]) { try { document.createDocumentFragment().querySelector(selector); } catch { throw new Error(`无效选择器：${selector}`); } }
  }
  captureProfile(); next.provider.profiles=structuredClone(settings.provider.profiles); next.provider.active=profileId;
  return validateSettings(next);
}
async function save() { const next=collect(); settings=await saveSettings(next); notice('设置已保存'); return settings; }
$('profile').addEventListener('change',()=>{ captureProfile(); profileId=$('profile').value; settings.provider.active=profileId; drawProfile(); });
$('settings-form').addEventListener('submit',e=>{ e.preventDefault(); busy($('save'),save); });
$('load-models').addEventListener('click',()=>busy($('load-models'),async()=>{ await save(); const r=await request(P.MSG_LIST_MODELS,{profileId}); if(!r.ok) throw new Error(errorText(r)); options($('models'),r.models||[]); notice(`获取到 ${r.models?.length||0} 个模型，选择模型后保存`); }));
$('test').addEventListener('click',()=>busy($('test'),async()=>{ await save(); notice('正在翻译测试文本…'); const r=await request(P.MSG_PROVIDER_TEST,{profileId}); if(!r.ok) throw new Error(errorText(r)); notice(`连接正常 · ${r.latencyMs} ms · ${r.sample||''}`); }));
async function cacheStats() { const r=await request(P.MSG_CACHE_STATS); $('cache-stats').textContent=r.ok?`已缓存 ${r.entries} 条译文`:errorText(r); }
$('cache-clear').addEventListener('click',()=>busy($('cache-clear'),async()=>{ const r=await request(P.MSG_CACHE_CLEAR); if(!r.ok) throw new Error(errorText(r)); await cacheStats(); notice('译文缓存已清空'); }));
$('export').addEventListener('click',()=>busy($('export'),async()=>{
  await save(); const blob=new Blob([JSON.stringify(safeExport(settings),null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='duallens-settings.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000); notice('已导出设置，不包含API key');
}));
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',()=>busy($('import-button'),async()=>{
  const file=$('import-file').files[0]; if(!file) return; if(file.size>1024*1024) throw new Error('设置文件最大1MB');
  const next=importSettings(JSON.parse(await file.text()),await loadSettings()); settings=await saveSettings(next); draw(); notice('设置已导入，保留本机API key'); $('import-file').value='';
}));
try { settings=await loadSettings(); draw(); await cacheStats(); notice('修改后点击保存'); } catch(e) { notice(e.message,true); }

import { element,FEATURES,segmented,TEXT as COMMON } from '../components.js';

// User-visible copy is centralized for the next localization pass.
const COPY=Object.freeze({
  s0:"常用",
  s1:"AI 服务",
  s2:"增强功能",
  s3:"网站规则",
  s4:"术语表",
  s5:"数据与隐私",
  s6:"关于",
  s7:"DualLens 设置",
  s8:"已保存",
  s9:"高级",
  s10:"靠边自动半隐藏",
  s11:"字幕显示",
  s12:"字幕位置",
  s13:"字幕字号",
  s14:"原文 + 译文",
  s15:"仅译文",
  s16:"底部",
  s17:"顶部",
  s18:"保存",
  s19:"取消",
  s20:"删除此服务",
  s21:"恢复默认",
  s22:"图书馆的悄然变革。",
  s23:"译文默认模糊，指到上面才显示。",
  s24:"待翻译的文字只发送给你选择的服务。AI 服务还会收到页面标题；网址、cookie 和密码不会发送。密钥与译文缓存只存在本机；密钥不会同步。",
  s25:"MIT 许可 · 独立开源项目",
  s26:"查看源代码",
  s27:"版本",
  s28:"只列出免费模型",
  s29:"备选顺序",
  s30:"上移",
  s31:"下移",
  s32:"移除",
  s33:"添加备选",
  s34:"本地模型",
  s35:"自定义",
  s36:"需要密钥",
  s37:"有免费模型",
  s38:"Ollama、LM Studio · 文字不出本机",
  s39:"OpenAI 兼容接口",
  s40:"本地服务",
  s41:"复制命令",
  s42:"Ollama 需要允许扩展来源；localhost 指向当前设备。",
  s43:"打开后在播放器里选择原语言字幕；支持 YouTube 和 HTML5 字幕，不做语音识别。",
  s44:"译文样式",
  s45:"配置后，翻译文字会发送给你选择的服务。密钥只保存在这台设备上，不会同步。",
  s46:"服务",
  s47:"模型",
  s48:"视频字幕",
  s49:"译文缓存",
  s50:"迁移到另一台设备"
});

export const GROUPS=Object.freeze([['common',COPY.s0],['ai',COPY.s1],['enhance',COPY.s2],['sites',COPY.s3],['glossary',COPY.s4],['data',COPY.s5],['about',COPY.s6]]);
const T=Object.freeze({brand:COPY.s7,saved:COPY.s8,advanced:COPY.s9,autoHide:COPY.s10,subtitleMode:COPY.s11,subtitlePosition:COPY.s12,subtitleSize:COPY.s13,bilingual:COPY.s14,translation:COPY.s15,bottom:COPY.s16,top:COPY.s17,save:COPY.s18,cancel:COPY.s19,delete:COPY.s20,reset:COPY.s21,preview:COPY.s22,source:'The quiet revolution of the library.',learn:COPY.s23,data:COPY.s24,about:COPY.s25,sourceLink:COPY.s26,version:COPY.s27,freeModels:COPY.s28,chain:COPY.s29,up:COPY.s30,down:COPY.s31,remove:COPY.s32,add:COPY.s33,local:COPY.s34,custom:COPY.s35,key:COPY.s36,free:COPY.s37,localHint:COPY.s38,customHint:COPY.s39,localEngine:COPY.s40,copy:COPY.s41,origin:COPY.s42,subtitles:COPY.s43});
export const SETTINGS_CSS=`
.dl-settings{max-width:1000px;margin:auto;padding:24px;color:var(--dl-text);background:var(--dl-bg);font:14px/1.5 var(--dl-font);overflow-wrap:anywhere}.dl-settings *{min-width:0}.dl-settings .settings-heading{font-size:20px;margin:0 0 24px}.dl-settings .settings-shell{display:grid;grid-template-columns:208px minmax(0,720px);gap:32px}.dl-settings nav{display:flex;flex-direction:column;gap:4px;align-self:start;position:sticky;top:24px}.dl-settings nav a{color:var(--dl-text-2);text-decoration:none;padding:10px 12px;border-radius:8px;min-height:40px}.dl-settings nav a[aria-current=page]{color:var(--dl-accent);background:var(--dl-accent-soft);font-weight:600}.dl-settings .settings-content{min-width:0}.dl-settings .group-title{font-size:20px;margin:0 0 16px}.dl-settings section{margin:0 0 16px;border:1px solid var(--dl-border);border-radius:12px;background:var(--dl-surface);padding:16px}.dl-settings section h2{font-size:16px;margin:0 0 12px}.dl-settings .grid{align-items:start;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dl-settings .wide{grid-column:1/-1}.dl-settings label{display:block}.dl-settings [hidden]{display:none!important}.dl-settings #display-segments{align-self:end}.dl-settings label>input:not([type=checkbox]),.dl-settings label>select,.dl-settings label>textarea{display:block;width:100%;margin-top:6px}.dl-settings label.check{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.dl-settings label.check input{order:2}.dl-settings .check input:not([role=switch]){min-width:20px;height:20px}.dl-settings .feature-card h2{display:none}.dl-settings .feature-top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.dl-settings .feature-top small{display:block;color:var(--dl-text-2);font-size:12px}.dl-settings .feature-top input{flex:none}.dl-settings .feature-details{padding-top:16px;border-top:1px solid var(--dl-border);margin-top:8px}.dl-settings .style-tiles,.dl-settings .preset-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dl-settings .style-tiles label{padding:8px;display:flex;align-items:flex-start}.dl-settings .style-tiles input[type=radio]{width:16px;height:16px;min-height:16px;margin:2px 0;flex:none}.dl-settings .style-sample{display:block;min-height:40px;font-size:12px;margin:6px 0}.dl-settings .style-preview{margin:12px 0;padding:16px;background:var(--dl-inset);border-radius:8px}.dl-settings .sample-translation{display:block;margin-top:.3em}.sample-translation[data-style=muted]{opacity:.78}.sample-translation[data-style=dashed]{text-decoration:underline dashed;text-underline-offset:4px}.sample-translation[data-style=highlight]{background:color-mix(in srgb,currentColor 9%,transparent)}.sample-translation[data-style=blur]{filter:blur(4px)}.sample-translation[data-style=blur]:is(:hover,:focus){filter:none}.sample-translation[data-style=quote]{border-left:1px solid var(--dl-border-strong);padding-left:.6em}.dl-settings .preset-tiles button{min-height:70px;text-align:left}.dl-settings .preset-tiles button[aria-pressed=true]{border:2px solid var(--dl-accent);background:var(--dl-accent-soft)}.dl-settings .preset-tiles small{display:block;font-size:12px;color:var(--dl-text-2)}.dl-settings .status{font-size:13px;min-height:24px;color:var(--dl-text-2)}.dl-settings .status.error{color:var(--dl-warn)}.dl-settings .saved{position:fixed;right:24px;top:16px;color:var(--dl-ok);opacity:0;pointer-events:none;transition:opacity var(--dl-dur-2)}.dl-settings .saved.show{opacity:1}.dl-settings .savebar{display:flex;align-items:center;gap:12px;margin-top:12px}.dl-settings .group-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.dl-settings .chain-row{display:flex;gap:6px;align-items:center;margin:8px 0}.dl-settings .chain-row span{flex:1}.dl-settings .chain-row button{padding:4px 8px}.dl-settings .field-error{color:var(--dl-danger);font-size:12px}.dl-settings .confirmation{border:1px solid var(--dl-border-strong);padding:16px;margin:8px 0;border-radius:12px}.dl-settings #sync-status{font-size:12px;color:var(--dl-text-3)}.dl-settings canvas{max-width:100%;height:auto}
@media(max-width:719px){.dl-settings{padding:12px;width:100%}.dl-settings .settings-heading{margin-bottom:12px}.dl-settings .settings-shell{display:block}.dl-settings nav{flex-direction:row;overflow-x:auto;position:static;gap:2px;margin:0 -4px 16px;padding:4px}.dl-settings nav a{flex:none;min-height:44px;padding:10px 12px}.dl-settings .grid{grid-template-columns:1fr}.dl-settings section{padding:12px}.dl-settings .preset-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.dl-settings .style-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.dl-settings .chain-row{flex-wrap:wrap}.dl-settings .chain-row span{flex-basis:100%}.dl-settings .saved{right:12px;top:8px}}
`;

// Move existing validated fields into seven views; retain ids as the form/controller contract.
export function organizeLayout(container,form,{field,button}) {
  const doc=container.ownerDocument,el=(tag,text,attrs)=>element(doc,tag,text,attrs),$=id=>container.querySelector('#'+id);
  const original=[...form.children];
  const shell=el('div',null,{class:'settings-shell'}),nav=el('nav',null,{'aria-label':T.brand}),content=el('div',null,{class:'settings-content'});
  container.prepend(el('h1',T.brand,{class:'settings-heading'}));form.append(shell);shell.append(nav,content);
  const groups={};for(const [id,title]of GROUPS){const link=el('a',title,{href:'#'+id,'data-group-link':id});nav.append(link);const page=el('div',null,{'data-group':id,hidden:''});page.append(el('h2',title,{class:'group-title'}));content.append(page);groups[id]=page;}
  const card=(group,title)=>{const n=el('section');if(title)n.append(el('h2',title));groups[group].append(n);return n;};
  const move=(dest,ids)=>{for(const id of ids){const n=$(id);if(n)dest.append(n.closest('label')||n);}};
  const grid=dest=>{const n=el('div',null,{class:'grid'});dest.append(n);return n;};
  const advanced=(dest,ids,title=T.advanced)=>{const d=el('details');d.append(el('summary',title));const body=grid(d);move(body,ids);dest.append(d);return body;};
  const common=card('common'),commonGrid=grid(common);move(commonGrid,['targetLang','displayMode']);
  const display=$('displayMode');display.parentElement.hidden=true;
  const displayGroup=segmented(doc,'显示方式',[['bilingual','双语对照'],['translation-only','仅译文']],'bilingual',value=>{display.value=value;display.dispatchEvent(new Event('change',{bubbles:true}));});displayGroup.id='display-segments';commonGrid.append(displayGroup);
  const styles=card('common',COPY.s44);move(styles,['style']);$('style').parentElement.hidden=true;
  const tiles=el('div',null,{class:'style-tiles',id:'style-tiles','aria-label':COPY.s44});styles.append(tiles);
  for(const option of $('style').options){const label=el('label',null,{class:'dl-radio-card'}),radio=el('input',null,{type:'radio',name:'style-tile',value:option.value});const span=el('span',option.textContent);span.append(el('span',T.preview,{class:'sample-translation style-sample','data-style':option.value}));label.append(radio,span);tiles.append(label);}
  const preview=el('div',T.source,{class:'style-preview'});preview.append(el('span',T.preview,{id:'style-preview',class:'sample-translation',tabindex:'0'}));styles.append(preview,el('p',T.learn,{class:'hint',id:'learn-hint'}));
  const translate=card('common');move(grid(translate),['translationMode','mtEngine','mtFallback','mt-key-row','mt-test']);
  translate.append(el('p','', {id:'mt-destination',class:'hint'}));advanced(card('common'),['sourceLang','translateShortText','minChars','inlineMaxChars','rootMarginPx','batchDelayMs','mtRegion']);
  const ai=card('ai');ai.append(el('p',COPY.s45));move(ai,['profile']);
  const presets=el('div',null,{id:'preset-tiles',class:'preset-tiles'});for(const [id,name,hint]of[['openai','OpenAI',T.key],['deepseek','DeepSeek',T.key],['openrouter','OpenRouter',T.free],['ollama',T.local,T.localHint],['custom',T.custom,T.customHint]]){const b=button(presets,'preset-'+id,name);b.dataset.preset=id;b.append(el('small',hint));}ai.append(presets);
  move(ai,['providerPreset','add-profile']);$('providerPreset').parentElement.hidden=true;$('add-profile').hidden=true;
  const provider=card('ai');provider.id='provider-card';move(provider,['provider-description','key-link']);
  const main=grid(provider);move(main,['key-row','model','models','load-models','test']);
  if($('apiKey')) button(main,'show-key',COMMON.showKey);
  field(main,'localEngine',T.localEngine,'select',[{id:'ollama',name:'Ollama'},{id:'lmstudio',name:'LM Studio'}]);field(main,'freeModels',T.freeModels,'checkbox');
  move(main,['baseUrl']);provider.append(el('p','',{id:'ai-destination',class:'hint'}));
  const local=el('div',null,{id:'local-help'});local.append(el('p',T.origin,{class:'hint'}));button(local,'copy-origin',T.copy);provider.append(local);
  const adv=advanced(provider,['profileName','jsonMode','maxItems','maxChars','concurrency','timeoutMs','fallbackModels']);move(adv,['providerChain']);$('providerChain').parentElement.hidden=true;adv.append(el('h3',T.chain),el('div','',{id:'chain-list'}));
  const chainControls=el('div',null,{class:'actions wide'});field(chainControls,'chain-profile',COPY.s46,'select');field(chainControls,'chain-model',COPY.s47);button(chainControls,'chain-add',T.add);adv.append(chainControls);button(provider,'delete-profile',T.delete).className='dl-danger';
  const providerActions=el('div',null,{class:'group-actions'});button(providerActions,'cancel-ai',T.cancel);move(providerActions,['save']);provider.append(providerActions);
  const prompt=card('ai');move(grid(prompt),['preset','customPrompt']);
  const featureIds={floatBall:['floatEnabled',['floatAutoHide','floatSide']],selection:['selectionEnabled',['showIcon']],hover:['hoverEnabled',['hoverModifier','hoverProfile','hoverModel']],input:['inputEnabled',['inputLang','inputTrigger','inputMode','inputOrder','prefixOverride','inputProfile','inputModel']],subtitles:['subtitlesEnabled',['subtitleMode','subtitlePosition','subtitleSize']],comics:['comicsEnabled',['comicsLanguage','comics-languages','comics-refresh','comicsSites']]};
  const extras=grid(card('enhance'));field(extras,'floatAutoHide',T.autoHide,'checkbox');field(extras,'subtitlesEnabled',COPY.s48,'checkbox');field(extras,'subtitleMode',T.subtitleMode,'select',[{id:'bilingual',name:T.bilingual},{id:'translation-only',name:T.translation}]);field(extras,'subtitlePosition',T.subtitlePosition,'select',[{id:'bottom',name:T.bottom},{id:'top',name:T.top}]);field(extras,'subtitleSize',T.subtitleSize,'range',[],{min:'16',max:'48',step:'1'});
  for(const [key,title,hint]of FEATURES){const c=card('enhance');c.className='feature-card';c.dataset.feature=key;const top=el('label',null,{class:'feature-top'}),text=el('span',title);text.append(el('small',hint));const [id,ids]=featureIds[key];const input=$(id);input.closest('label').remove();input.setAttribute('role','switch');top.append(text,input);const details=el('div',null,{class:'feature-details grid',id:'details-'+key});move(details,ids);if(key==='subtitles')details.append(el('p',T.subtitles,{class:'hint'}));c.append(top,details);}
  extras.parentElement.remove();
  const sites=card('sites');move(grid(sites),['rule-match','rule-page','rule-selection','rule-hover','rule-input','site-rule-add']);advanced(sites,['always','never','autoLangs','customRules']);
  for(const group of ['sites','glossary']){const c=group==='sites'?sites:card(group);if(group==='glossary')move(c,['glossary']);const a=el('div',null,{class:'group-actions'});button(a,'cancel-'+group,T.cancel);button(a,'save-'+group,T.save);c.append(a);}
  const data=card('data');data.append(el('p',T.data),el('p','',{id:'privacy-current',class:'hint'}));move(data,['sync-status']);
  const cache=card('data',COPY.s49);move(grid(cache),['cacheEnabled','maxEntries','ttlDays','cache-stats','cache-clear']);
  const backup=card('data',COPY.s50);move(backup,['backupPassword','backupText','export','import-button','export-phone','copy-backup','import-computer','backup-qr','import-file','import-file-button']);button(card('data'),'restore-defaults',T.reset).className='dl-danger';
  const about=card('about');about.append(el('p',T.about),el('p','',{id:'app-version'}),el('a',T.sourceLink,{href:'https://github.com/ray-oriental/duallens',target:'_blank',rel:'noopener noreferrer'}));
  const feedback=el('div',null,{class:'status',id:'form-feedback'});move(feedback,['status']);content.append(feedback);container.append(el('span',T.saved,{id:'saved-toast',class:'saved',role:'status','aria-live':'polite'}));
  // All controls have now moved; drop the obsolete long-page sections.
  for(const n of original)if(n.parentElement===form)n.remove();
}

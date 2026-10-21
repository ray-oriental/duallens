import { t as l10n } from '../../shared/i18n.js';
import { element,FEATURES,segmented,TEXT as COMMON } from '../components.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({
  s0:l10n('mh3'),
  s1:l10n('m5x'),
  s2:l10n('mh4'),
  s3:l10n('mh5'),
  s4:l10n('mh6'),
  s5:l10n('mh7'),
  s6:l10n('mh8'),
  s7:l10n('mh9'),
  s8:l10n('mda'),
  s9:l10n('mha'),
  s10:l10n('mhb'),
  s11:l10n('mhc'),
  s12:l10n('m9m'),
  s13:l10n('mhd'),
  s14:l10n('m9l'),
  s15:l10n('m4f'),
  s16:l10n('m9n'),
  s17:l10n('m9o'),
  s18:l10n('mdb'),
  s19:l10n('mdc'),
  s20:l10n('mhe'),
  s21:l10n('mhf'),
  s22:l10n('mhg'),
  s23:l10n('mhh'),
  s24:l10n('mhi'),
  s25:l10n('mhj'),
  s26:l10n('mhk'),
  s27:l10n('mdo'),
  s28:l10n('mdr'),
  s29:l10n('mhl'),
  s30:l10n('m38'),
  s31:l10n('mdi'),
  s32:l10n('mdj'),
  s33:l10n('mhm'),
  s34:l10n('mhn'),
  s35:l10n('mg4'),
  s36:l10n('mho'),
  s37:l10n('mhp'),
  s38:l10n('mhq'),
  s39:l10n('mhr'),
  s40:l10n('mhs'),
  s41:l10n('mht'),
  s42:l10n('mhu'),
  s43:l10n('mhv'),
  s44:l10n('me3'),
  s45:l10n('mhw'),
  s46:l10n('ma9'),
  s47:l10n('maa'),
  s48:l10n('mao'),
  s49:l10n('mhx'),
  s50:l10n('mhy')
});

export const GROUPS=Object.freeze([['common',COPY.s0],['ai',COPY.s1],['enhance',COPY.s2],['sites',COPY.s3],['glossary',COPY.s4],['data',COPY.s5],['about',COPY.s6]]);
const T=Object.freeze({brand:COPY.s7,saved:COPY.s8,advanced:COPY.s9,autoHide:COPY.s10,subtitleMode:COPY.s11,subtitlePosition:COPY.s12,subtitleSize:COPY.s13,bilingual:COPY.s14,translation:COPY.s15,bottom:COPY.s16,top:COPY.s17,save:COPY.s18,cancel:COPY.s19,delete:COPY.s20,reset:COPY.s21,preview:COPY.s22,source:'The quiet revolution of the library.',learn:COPY.s23,data:COPY.s24,about:COPY.s25,sourceLink:COPY.s26,version:COPY.s27,freeModels:COPY.s28,chain:COPY.s29,up:COPY.s30,down:COPY.s31,remove:COPY.s32,add:COPY.s33,local:COPY.s34,custom:COPY.s35,key:COPY.s36,free:COPY.s37,localHint:COPY.s38,customHint:COPY.s39,localEngine:COPY.s40,copy:COPY.s41,origin:COPY.s42,subtitles:COPY.s43});
export const SETTINGS_CSS=`
.dl-settings{max-width:1000px;margin:auto;padding:24px;color:var(--dl-text);background:var(--dl-bg);font:14px/1.5 var(--dl-font);overflow-wrap:anywhere}.dl-settings *{min-width:0}.dl-settings .settings-heading{font-size:20px;margin:0 0 24px}.dl-settings .settings-shell{display:grid;grid-template-columns:208px minmax(0,720px);gap:32px}.dl-settings nav{display:flex;flex-direction:column;gap:4px;align-self:start;position:sticky;top:24px}.dl-settings nav a{color:var(--dl-text-2);text-decoration:none;padding:10px 12px;border-radius:8px;min-height:40px}.dl-settings nav a[aria-current=page]{color:var(--dl-accent);background:var(--dl-accent-soft);font-weight:600}.dl-settings .settings-content{min-width:0}.dl-settings .group-title{font-size:20px;margin:0 0 16px}.dl-settings section{margin:0 0 16px;border:1px solid var(--dl-border);border-radius:12px;background:var(--dl-surface);padding:16px}.dl-settings section h2{font-size:16px;margin:0 0 12px}.dl-settings .grid{align-items:start;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dl-settings .wide{grid-column:1/-1}.dl-settings label{display:block}.dl-settings [hidden]{display:none!important}.dl-settings #display-segments{align-self:end}.dl-settings label>input:not([type=checkbox]):not([type=radio]),.dl-settings label>select,.dl-settings label>textarea{display:block;width:100%;margin-top:6px}.dl-settings label.check{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.dl-settings label.check input{order:2}.dl-settings .check input:not([role=switch]){min-width:20px;height:20px}.dl-settings .feature-card h2{display:none}.dl-settings .feature-top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.dl-settings .feature-top small{display:block;color:var(--dl-text-2);font-size:12px}.dl-settings .feature-top input{flex:none}.dl-settings .feature-details{padding-top:16px;border-top:1px solid var(--dl-border);margin-top:8px}.dl-settings .style-tiles,.dl-settings .preset-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dl-settings .style-tiles label{padding:8px;display:flex;align-items:flex-start}.dl-settings .style-tiles input[type=radio]{width:16px;height:16px;min-height:16px;margin:2px 0;flex:none}.dl-settings .style-sample{display:block;min-height:40px;font-size:12px;margin:6px 0}.dl-settings .style-preview{margin:12px 0;padding:16px;background:var(--dl-inset);border-radius:8px}.dl-settings .sample-translation{display:block;margin-top:.3em}.sample-translation[data-style=muted]{opacity:.78}.sample-translation[data-style=dashed]{text-decoration:underline dashed;text-underline-offset:4px}.sample-translation[data-style=highlight]{background:color-mix(in srgb,currentColor 9%,transparent)}.sample-translation[data-style=blur]{filter:blur(4px)}.sample-translation[data-style=blur]:is(:hover,:focus){filter:none}.sample-translation[data-style=quote]{border-left:1px solid var(--dl-border-strong);padding-left:.6em}.dl-settings .preset-tiles button{min-height:70px;text-align:left}.dl-settings .preset-tiles button[aria-pressed=true]{border:2px solid var(--dl-accent);background:var(--dl-accent-soft)}.dl-settings .preset-tiles small{display:block;font-size:12px;color:var(--dl-text-2)}.dl-settings .status{font-size:13px;min-height:24px;color:var(--dl-text-2)}.dl-settings .status.error{color:var(--dl-warn)}.dl-settings .saved{position:fixed;right:24px;top:16px;color:var(--dl-ok);opacity:0;pointer-events:none;transition:opacity var(--dl-dur-2)}.dl-settings .saved.show{opacity:1}.dl-settings .savebar{display:flex;align-items:center;gap:12px;margin-top:12px}.dl-settings .group-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.dl-settings .chain-row{display:flex;gap:6px;align-items:center;margin:8px 0}.dl-settings .chain-row span{flex:1}.dl-settings .chain-row button{padding:4px 8px}.dl-settings .field-error{color:var(--dl-danger);font-size:12px}.dl-settings .confirmation{border:1px solid var(--dl-border-strong);padding:16px;margin:8px 0;border-radius:12px}.dl-settings #sync-status{font-size:12px;color:var(--dl-text-3)}.dl-settings canvas{max-width:100%;height:auto}
@media(max-width:719px){.dl-settings{padding:12px;width:100%}.dl-settings .settings-heading{margin-bottom:12px}.dl-settings .settings-shell{display:block}.dl-settings nav{flex-direction:row;overflow-x:auto;position:static;gap:2px;margin:0 -4px 16px;padding:4px}.dl-settings nav a{flex:none;min-height:44px;padding:10px 12px}.dl-settings .grid{grid-template-columns:1fr}.dl-settings section{padding:12px}.dl-settings .preset-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.dl-settings .style-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.dl-settings .chain-row{flex-wrap:wrap}.dl-settings .chain-row span{flex-basis:100%}.dl-settings .saved{right:12px;top:8px}}

.dl-settings,.dl-settings form,.dl-settings .settings-shell,.dl-settings .settings-content,.dl-settings [data-group]{box-sizing:border-box;min-width:0;max-width:100%}.dl-settings .group-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.dl-settings .saved{position:static;font-size:13px;font-weight:400;flex:none}.dl-settings .hint{font-size:13px;color:var(--dl-text-2)}.dl-settings .frow{display:grid;grid-template-columns:128px minmax(0,1fr);gap:12px;align-items:center;margin:12px 0}.dl-settings .frow>input,.dl-settings .frow>select{margin:0!important;width:100%}.dl-settings .common-rows .frow{grid-template-columns:minmax(0,1fr) auto}.dl-settings .common-rows select{width:200px}.dl-settings #display-segments{width:max-content;height:32px}.dl-settings #display-segments span{min-height:28px}.dl-settings .field-controls{display:flex;align-items:center;gap:8px;min-width:0}.dl-settings .field-controls input{width:100%;min-width:0;flex:1}.dl-settings .field-controls button{flex:none;white-space:nowrap}.dl-settings .method-list{display:grid;gap:12px;margin:12px 0 20px}.dl-settings .method-list label{display:flex;align-items:flex-start;gap:10px}.dl-settings .method-list input{flex:none;width:16px;height:16px;min-height:16px;margin:4px 0}.dl-settings .method-list label>span{flex:1;min-width:0}.dl-settings .method-list label{min-height:44px}.dl-settings .method-list small{display:block;font-size:13px;color:var(--dl-text-2);margin-top:4px}.dl-settings .preset-tiles{margin-top:12px}.dl-settings .provider-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.dl-settings .provider-heading h2{margin:0}.dl-settings .destination::before{content:'ⓘ ';}.dl-settings .test-row{align-items:center;gap:8px;flex-wrap:wrap}.dl-settings .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.dl-settings .privacy-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}.dl-settings .privacy-table :is(th,td){text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid var(--dl-border)}.dl-settings .rule-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0}.dl-settings #site-rule-editor{margin-top:16px;padding-top:16px;border-top:1px solid var(--dl-border)}.dl-settings #site-rule-editor label{margin:12px 0}.dl-settings #site-rule-new{margin-top:8px}.dl-settings .style-tiles label{min-height:64px}.dl-settings #backupText{min-height:100px}
@media(max-width:719px){.dl-settings{padding:12px 0}.dl-settings .settings-content{padding:0 16px}.dl-settings .settings-heading{padding:0 16px}.dl-settings nav{margin:0 0 16px;max-width:100%}.dl-settings .frow{grid-template-columns:1fr;gap:6px}.dl-settings .common-rows .frow{grid-template-columns:1fr}.dl-settings .common-rows select{width:100%}.dl-settings #display-segments{max-width:100%;height:44px}.dl-settings #display-segments span{min-height:40px}.dl-settings .field-controls{flex-wrap:wrap}.dl-settings .field-controls input{flex-basis:140px}.dl-settings .privacy-table :is(th,td){padding:8px 4px}.dl-settings .style-tiles label{overflow-wrap:normal}.dl-settings .style-tiles .style-sample{min-height:28px}}
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
  const common=card('common'),commonGrid=el('div',null,{class:'common-rows'});common.append(commonGrid);move(commonGrid,['targetLang','displayMode']);
  const display=$('displayMode');display.parentElement.hidden=true;
  const displayGroup=segmented(doc,l10n('me1'),[['bilingual',l10n('me2')],['translation-only',l10n('m4f')]],'bilingual',value=>{display.value=value;display.dispatchEvent(new Event('change',{bubbles:true}));});displayGroup.id='display-segments';const displayRow=el('div',null,{class:'frow'});displayRow.append(el('span',l10n('me1')),displayGroup);commonGrid.append(displayRow);$('targetLang').parentElement.classList.add('frow');$('targetLang').parentElement.firstChild.textContent=l10n('polishTranslateInto');
  const styles=card('common',COPY.s44);move(styles,['style']);$('style').parentElement.hidden=true;
  const tiles=el('div',null,{class:'style-tiles',id:'style-tiles','aria-label':COPY.s44});styles.append(tiles);
  const shortStyles=[l10n('polishStyle0'),l10n('polishStyle1'),l10n('polishStyle2'),l10n('polishStyle3'),l10n('polishStyle4'),l10n('polishStyle5')];let styleIndex=0;for(const option of $('style').options){const label=el('label',null,{class:'dl-radio-card'}),radio=el('input',null,{type:'radio',name:'style-tile',value:option.value});label.title=option.textContent;radio.setAttribute('aria-label',option.textContent);const span=el('span',shortStyles[styleIndex++]);span.append(el('span',T.preview,{class:'sample-translation style-sample','data-style':option.value}));label.append(radio,span);tiles.append(label);}
  const preview=el('div',T.source,{class:'style-preview'});preview.append(el('span',T.preview,{id:'style-preview',class:'sample-translation',tabindex:'0'}));styles.append(preview,el('p',T.learn,{class:'hint',id:'learn-hint'}));
  const translate=card('common',l10n('me9'));move(translate,['translationMode']);$('translationMode').parentElement.hidden=true;
  const methods=el('div',null,{id:'translation-methods',class:'method-list'});for(const [value,title,hint]of[['mt+llm',l10n('polishAutomatic'),l10n('polishAutomaticHint')],['mt',l10n('polishMT'),l10n('polishMTHint')],['llm',l10n('polishAI'),l10n('polishAIHint')]]){const row=el('label'),input=el('input',null,{type:'radio',name:'translation-method',value}),copy=el('span',title);copy.append(el('small',hint));row.append(input,copy);methods.append(row);}translate.append(methods);
  const mtFields=el('div',null,{class:'mt-fields'});translate.append(mtFields);move(mtFields,['mtEngine','mtFallback','mt-key-row','mt-test']);$('mtEngine').parentElement.classList.add('frow');translate.append(el('p',l10n('polishUnofficial'),{class:'hint',id:'mt-unofficial'}));
  translate.append(el('p','', {id:'mt-destination',class:'hint'}));advanced(card('common'),['sourceLang','translateShortText','minChars','inlineMaxChars','rootMarginPx','batchDelayMs','mtRegion']);
  const ai=card('ai');ai.append(el('p',COPY.s45));move(ai,['profile']);$('profile').parentElement.classList.add('frow');$('profile').parentElement.firstChild.textContent=l10n('polishCurrent');
  const presets=el('div',null,{id:'preset-tiles',class:'preset-tiles'});for(const [id,name,hint]of[['openai','OpenAI',T.key],['deepseek','DeepSeek',T.key],['openrouter','OpenRouter',T.free],['ollama',T.local,T.localHint],['custom',T.custom,T.customHint]]){const b=button(presets,'preset-'+id,name);b.dataset.preset=id;b.append(el('small',hint));}ai.append(presets);
  move(ai,['providerPreset','add-profile']);$('providerPreset').parentElement.hidden=true;$('add-profile').hidden=true;
  ai.append(el('p',l10n('polishChoose'),{id:'provider-empty',class:'hint'}));
  const provider=card('ai');provider.id='provider-card';const providerHeading=el('div',null,{class:'provider-heading'});providerHeading.append(el('h2','',{id:'provider-name'}));move(providerHeading,['key-link']);provider.append(providerHeading);move(provider,['provider-description']);$('provider-description').hidden=true;
  const main=el('div',null,{class:'provider-fields'});provider.append(main);move(main,['key-row']);
  if($('apiKey')){const key=$('apiKey'),row=key.parentElement;row.classList.add('frow');const controls=el('span',null,{class:'field-controls'});key.after(controls);controls.append(key);button(controls,'show-key',COMMON.showKey);}
  field(main,'localEngine',T.localEngine,'select',[{id:'ollama',name:'Ollama'},{id:'lmstudio',name:'LM Studio'}]);
  move(main,['baseUrl','model','models']);$('baseUrl').parentElement.classList.add('frow');const modelRow=$('model').parentElement;modelRow.classList.add('frow');const modelControls=el('span',null,{class:'field-controls'});$('model').after(modelControls);modelControls.append($('model'));move(modelControls,['load-models']);
  field(main,'freeModels',T.freeModels,'checkbox');field(main,'localOnly',l10n('mhz'),'checkbox');
  const local=el('div',null,{id:'local-help'});local.append(el('p',l10n('mi0'),{class:'hint'}));local.append(el('p',T.origin,{class:'hint'}));button(local,'copy-origin',T.copy);main.append(local);
  provider.append(el('p','',{id:'ai-destination',class:'hint destination'}));const testRow=el('div',null,{class:'actions test-row'});move(testRow,['test']);provider.append(testRow);
  const adv=advanced(provider,['profileName','jsonMode','maxItems','maxChars','concurrency','timeoutMs','fallbackModels']);move(adv,['providerChain']);$('providerChain').parentElement.hidden=true;adv.append(el('h3',T.chain),el('div','',{id:'chain-list'}));
  const chainControls=el('div',null,{class:'actions wide'});field(chainControls,'chain-profile',COPY.s46,'select');field(chainControls,'chain-model',COPY.s47);button(chainControls,'chain-add',T.add);adv.append(chainControls);button(adv,'delete-profile',T.delete).className='dl-danger';
  const providerActions=el('div',null,{class:'group-actions'});button(providerActions,'cancel-ai',T.cancel);move(providerActions,['save']);provider.append(providerActions);
  const prompt=card('ai');prompt.id='prompt-card';move(grid(prompt),['preset','customPrompt']);
  const featureIds={floatBall:['floatEnabled',['floatAutoHide','floatSide']],selection:['selectionEnabled',['showIcon']],hover:['hoverEnabled',['hoverModifier','hoverProfile','hoverModel']],input:['inputEnabled',['inputLang','inputTrigger','inputMode','inputOrder','prefixOverride','inputProfile','inputModel']],subtitles:['subtitlesEnabled',['subtitleMode','subtitlePosition','subtitleSize']],comics:['comicsEnabled',['comicsLanguage','comics-languages','comics-refresh','comicsSites']]};
  const extras=grid(card('enhance'));field(extras,'floatAutoHide',T.autoHide,'checkbox');field(extras,'subtitlesEnabled',COPY.s48,'checkbox');field(extras,'subtitleMode',T.subtitleMode,'select',[{id:'bilingual',name:T.bilingual},{id:'translation-only',name:T.translation}]);field(extras,'subtitlePosition',T.subtitlePosition,'select',[{id:'bottom',name:T.bottom},{id:'top',name:T.top}]);field(extras,'subtitleSize',T.subtitleSize,'range',[],{min:'16',max:'48',step:'1'});
  for(const [key,title,hint]of FEATURES){const c=card('enhance');c.className='feature-card';c.dataset.feature=key;const top=el('label',null,{class:'feature-top'}),text=el('span',title);text.append(el('small',hint));const [id,ids]=featureIds[key];const input=$(id);input.closest('label').remove();input.setAttribute('role','switch');top.append(text,input);const details=el('div',null,{class:'feature-details grid',id:'details-'+key});move(details,ids);if(key==='subtitles')details.append(el('p',T.subtitles,{class:'hint'}));c.append(top,details);}
  extras.parentElement.remove();
  const sites=card('sites');const list=el('div',null,{id:'site-rule-list'});sites.append(list);button(sites,'site-rule-new',l10n('polishAddRule'));
  const editor=el('div',null,{id:'site-rule-editor',hidden:''});sites.append(editor);move(editor,['rule-match','rule-page','rule-selection','rule-hover','rule-input']);const siteActions=el('div',null,{class:'group-actions',id:'site-actions',hidden:''});sites.append(siteActions);button(siteActions,'cancel-sites',T.cancel);move(siteActions,['site-rule-add']);$('site-rule-add').textContent=T.save;
  advanced(sites,['always','never','autoLangs','customRules']);const legacyActions=el('div',null,{class:'group-actions',id:'site-advanced-actions',hidden:''});button(legacyActions,'save-sites',T.save);sites.querySelector('details').append(legacyActions);
  const glossary=card('glossary');move(glossary,['glossary']);glossary.append(el('p',l10n('polishGlossaryHint'),{class:'hint'}));const glossaryActions=el('div',null,{class:'group-actions'});button(glossaryActions,'cancel-glossary',T.cancel);button(glossaryActions,'save-glossary',T.save);glossary.append(glossaryActions);
  const data=card('data');data.append(el('p',T.data),el('p','',{id:'privacy-current',class:'hint'}));move(data,['sync-status']);const table=el('table',null,{class:'privacy-table'}),thead=el('thead'),tr=el('tr');for(const title of [l10n('polishWho'),l10n('polishWhat'),l10n('polishWhen')])tr.append(el('th',title));thead.append(tr);table.append(thead,el('tbody',null,{id:'privacy-rows'}));data.append(table);
  const cache=card('data',COPY.s49);move(cache,['cacheEnabled','cache-stats','cache-clear']);advanced(cache,['maxEntries','ttlDays']);
  const backup=card('data',COPY.s50);backup.append(el('p',l10n('polishTransferSteps'),{class:'hint'}));move(backup,['backupPassword','backupText','export','import-button','export-phone','copy-backup','import-computer','backup-qr','import-file','import-file-button']);$('export-phone').textContent=l10n('polishTransfer');const backupActions=el('div',null,{class:'actions'});for(const id of ['export','import-button','export-phone','copy-backup','import-computer','import-file-button'])if($(id))backupActions.append($(id));backup.append(backupActions);button(card('data'),'restore-defaults',T.reset).className='dl-danger';
  const about=card('about');about.append(el('p',T.about),el('p','',{id:'app-version'}),el('a',T.sourceLink,{href:'https://github.com/ray-oriental/duallens',target:'_blank',rel:'noopener noreferrer'}));
  for(const [title,url]of[[l10n('polishPrivacy'),'https://github.com/ray-oriental/duallens/blob/main/docs/PRIVACY.md'],[l10n('polishFeedback'),'https://github.com/ray-oriental/duallens/issues'],[l10n('polishLicenses'),'https://github.com/ray-oriental/duallens/tree/main/extension/vendor']]){const row=el('p');row.append(el('a',title,{href:url,target:'_blank',rel:'noopener noreferrer'}));about.append(row);}about.append(el('p',l10n('polishComponents')),el('h3',l10n('polishShortcuts')),el('p',l10n('polishShortcutHint')));
  for(const input of container.querySelectorAll('input[type=checkbox]'))input.setAttribute('role','switch');
  const feedback=el('div',null,{class:'status',id:'form-feedback'});move(feedback,['status']);content.append(feedback);content.querySelector('.group-title').append(el('span',T.saved,{id:'saved-toast',class:'saved',role:'status','aria-live':'polite'}));
  // All controls have now moved; drop the obsolete long-page sections.
  for(const n of original)if(n.parentElement===form)n.remove();
}

import { message as l10n, setText } from '../../shared/i18n.js';
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
// Monochrome settings: no cards; white space and hairlines group the rows (docs/DESIGN.md section 12).
export const SETTINGS_CSS=`
.dl-settings{box-sizing:border-box;width:100%;max-width:924px;margin:0 auto;padding:40px 32px 64px;color:var(--dl-text);background:var(--dl-bg);font:400 14px/1.6 var(--dl-font);overflow-wrap:anywhere}
.dl-settings *{min-width:0}
.dl-settings :is(form,.settings-shell,.settings-content,[data-group]){box-sizing:border-box;min-width:0;max-width:100%}
.dl-settings [hidden]{display:none!important}
.dl-settings p{margin:0}
.dl-settings .settings-shell{display:grid;grid-template-columns:168px minmax(0,640px);column-gap:52px}
.dl-settings .settings-side{position:sticky;top:40px;align-self:start}
.dl-settings .settings-heading{margin:0 0 16px;padding-left:14px;font-size:13px;font-weight:600;line-height:28px}
.dl-settings nav{display:flex;flex-direction:column;border-left:1px solid var(--dl-border)}
.dl-settings nav a{display:block;margin-left:-1px;padding:5px 12px;border-left:2px solid transparent;color:var(--dl-text-2);font-size:13px;line-height:20px;text-decoration:none}
.dl-settings nav a:hover{color:var(--dl-text)}
.dl-settings nav a[aria-current=page]{border-left-color:var(--dl-text);color:var(--dl-text);font-weight:600}
.dl-settings .group-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 8px;font-size:18px;font-weight:600;line-height:28px}
.dl-settings .saved{flex:none;color:var(--dl-text-3);font-size:12.5px;font-weight:400;opacity:0;pointer-events:none;transition:opacity 360ms var(--dl-ease)}
.dl-settings .saved.show{opacity:1;transition-duration:var(--dl-dur-1)}
.dl-settings section{margin:28px 0 0}
.dl-settings .group-title+section{margin-top:4px}
.dl-settings section>h2,.dl-settings h3{margin:0 0 4px;font-size:13px;font-weight:600;line-height:20px}
.dl-settings h3{margin-top:20px}
.dl-settings .lead{margin:0 0 12px;color:var(--dl-text-2);font-size:13px}
.dl-settings .hint{margin-top:8px;color:var(--dl-text-3);font-size:12.5px;line-height:1.55}
.dl-settings .grid{display:flex;flex-direction:column}
.dl-settings .field,.dl-settings .frow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,240px);align-items:center;column-gap:24px;min-height:48px;padding:8px 0;border-top:1px solid var(--dl-border)}
.dl-settings :is(section,.grid,.common-rows,.mt-fields,.provider-fields,.feature-details,#site-rule-editor,#key-row)>:is(.field,.frow,.rule-row,.chain-row):first-child,.dl-settings :is(h2,h3,summary,.lead)+:is(.field,.frow,.rule-row,.chain-row){border-top:0}
.dl-settings .field>:is(input:not([type=checkbox]),select,textarea),.dl-settings .frow>:is(input:not([type=checkbox]),select,textarea,.field-controls,.dl-segment){width:100%;margin:0}
.dl-settings .field>input[type=number]{justify-self:end;width:120px}
.dl-settings .field>input[type=range]{justify-self:stretch;accent-color:var(--dl-accent)}
.dl-settings .field-label{color:var(--dl-text)}
.dl-settings .field.check{display:flex;align-items:center;justify-content:space-between;gap:24px;cursor:pointer}
.dl-settings .field.check>input{order:2;flex:none}
.dl-settings :is(.field.wide,div#key-row,div#mt-key-row){display:block;padding:12px 0}
.dl-settings .provider-fields .frow{grid-template-columns:120px minmax(0,1fr)}
.dl-settings .provider-fields>[hidden]:first-child+*{border-top:0}
.dl-settings .field.wide>:is(input,textarea,select,.field-controls){display:flex;width:100%;margin-top:8px}
.dl-settings .field.wide>textarea{display:block}
.dl-settings select[multiple]{min-height:120px}
.dl-settings .field-controls{display:flex;align-items:center;gap:8px}
.dl-settings .field-controls>input{flex:1;min-width:0}
.dl-settings .field-controls>button{flex:none;white-space:nowrap}
.dl-settings .field-error{grid-column:1/-1;margin-top:4px;color:var(--dl-danger);font-size:12.5px}
.dl-settings #display-segments{justify-self:end;width:auto}
.dl-settings .style-list,.dl-settings .method-list{display:flex;flex-direction:column;gap:2px;margin:4px -10px 0}
.dl-settings .style-row{display:grid;grid-template-columns:16px 88px minmax(0,1fr);align-items:center;column-gap:12px;min-height:40px;padding:8px 10px;border-radius:var(--dl-r-sm);cursor:pointer}
.dl-settings :is(.style-row,.dl-choice):has(input:checked){background:var(--dl-inset)}
.dl-settings .style-name{color:var(--dl-text)}
.dl-settings .style-sample{color:var(--dl-text);font-size:13px;line-height:1.5;justify-self:start}
.dl-settings .style-preview{margin-top:12px;padding:14px 16px;border:1px solid var(--dl-border);border-radius:var(--dl-r-sm);font-size:14px;line-height:1.6}
.dl-settings .style-preview .sample-translation{display:block;width:fit-content;margin-top:4px}
.sample-translation[data-style=muted]{opacity:.72}
.sample-translation[data-style=dashed]{text-decoration:underline dashed;text-decoration-color:color-mix(in srgb,currentColor 48%,transparent);text-underline-offset:4px}
.sample-translation[data-style=highlight]{background:color-mix(in srgb,currentColor 9%,transparent)}
.sample-translation[data-style=blur]{filter:blur(4px)}
.sample-translation[data-style=blur]:is(:hover,:focus){filter:none}
.sample-translation[data-style=quote]{border-left:1px solid color-mix(in srgb,currentColor 48%,transparent);padding-left:.6em}
.dl-settings .dl-choice{min-height:40px}
.dl-settings .dl-choice small{font-size:12.5px}
.dl-settings .mt-fields{margin-top:12px;border-top:1px solid var(--dl-border)}
.dl-settings .mt-fields>.field:first-child{border-top:0}
.dl-settings .mt-fields>button,.dl-settings .test-row{margin:4px 0 0}
.dl-settings .preset-list{display:flex;flex-direction:column;gap:2px;margin:8px -10px 0}
.dl-settings .preset-list>button{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;justify-content:stretch;column-gap:12px;min-height:52px;padding:8px 10px;border:0;border-radius:var(--dl-r-sm);background:transparent;color:var(--dl-text);font-size:14px;font-weight:400;line-height:1.45;text-align:left}
.dl-settings .preset-list>button small{grid-column:1;color:var(--dl-text-3);font-size:12.5px}
.dl-settings .preset-list>button::after{content:'\\203A';grid-column:2;grid-row:1/span 2;color:var(--dl-text-3);font-size:18px;line-height:1;transition:transform var(--dl-dur-1) var(--dl-ease)}
.dl-settings .preset-list>button[aria-pressed=true]{background:var(--dl-inset)}
.dl-settings .preset-list>button[aria-pressed=true]::after{transform:rotate(90deg)}
.dl-settings #provider-card{margin:4px 10px 16px}
.dl-settings .provider-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:0}
.dl-settings #provider-hint{margin:0}
.dl-settings #key-link{margin-left:auto}
.dl-settings .provider-heading h2{display:none}
.dl-settings .provider-heading a{font-size:12.5px}
.dl-settings #ai-destination{margin-top:12px}
.dl-settings #local-help{padding:4px 0 8px}
.dl-settings #local-help button{margin-top:8px}
.dl-settings #prompt-card{margin-top:20px}
.dl-settings details{margin-top:12px}
.dl-settings details>.grid{margin-top:4px}
.dl-settings .actions{margin-top:12px}
.dl-settings .group-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.dl-settings .feature-card{margin:0;border-top:1px solid var(--dl-border)}
.dl-settings .group-title+.feature-card{border-top:0}
.dl-settings .feature-top{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:64px;padding:12px 0;cursor:pointer}
.dl-settings .feature-top>span{color:var(--dl-text)}
.dl-settings .feature-top small{display:block;margin-top:2px;color:var(--dl-text-3);font-size:12.5px}
.dl-settings .feature-top>input{flex:none}
.dl-settings .feature-details{margin:-4px 0 0 16px;padding-bottom:12px}
.dl-settings .feature-details>.field{min-height:44px}
.dl-settings .feature-details .field-label{color:var(--dl-text-2);font-size:13px}
.dl-settings .feature-details>button{width:fit-content;margin:8px 0 4px}
.dl-settings #comics-languages:not(:empty){padding:8px 0;color:var(--dl-text-2);font-size:13px;border-top:1px solid var(--dl-border)}
.dl-settings #comics-languages p{margin:0}
.dl-settings .rule-row,.dl-settings .chain-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;border-top:1px solid var(--dl-border)}
.dl-settings .rule-row>span,.dl-settings .chain-row>span{flex:1;font-family:var(--dl-font-mono);font-size:13px}
.dl-settings :is(.rule-row,.chain-row) button{min-height:28px;padding:0 4px;border-color:transparent;background:transparent;color:var(--dl-text-2);font-weight:400}
.dl-settings :is(.rule-row,.chain-row) button:hover:not(:disabled){background:transparent;color:var(--dl-text);text-decoration:underline;text-underline-offset:3px}
.dl-settings #site-rule-list .hint{margin:0;padding:4px 0 8px}
.dl-settings #site-rule-new{margin-top:8px}
.dl-settings #site-rule-editor{margin-top:16px}
.dl-settings .privacy-table{width:100%;margin-top:16px;border-collapse:collapse;table-layout:fixed;font-size:13px}
.dl-settings .privacy-table :is(th,td){padding:8px 12px 8px 0;border-bottom:1px solid var(--dl-border);text-align:left;vertical-align:top}
.dl-settings .privacy-table th{color:var(--dl-text-3);font-size:12.5px;font-weight:400}
.dl-settings #privacy-current{margin-top:12px;color:var(--dl-text-2);font-size:13px}
.dl-settings #sync-status{margin-top:4px;color:var(--dl-text-3);font-size:12.5px}
.dl-settings #cache-stats:not(:empty){padding:0 0 8px;color:var(--dl-text-3);font-size:12.5px}
.dl-settings #backupText{min-height:96px;font-family:var(--dl-font-mono);font-size:12px}
.dl-settings canvas{display:block;max-width:100%;height:auto;margin-top:12px}
.dl-settings .about-links{display:flex;flex-direction:column;gap:6px;margin-top:16px}
.dl-settings #app-version{color:var(--dl-text-3);font-size:12.5px}
.dl-settings [data-group=about] section>p:not(.lead){margin-top:12px;color:var(--dl-text-2);font-size:13px}
.dl-settings .status{min-height:20px;margin-top:16px;color:var(--dl-text-2);font-size:13px}
.dl-settings .status.error{color:var(--dl-danger)}
.dl-settings .status:empty{min-height:0}
.dl-settings [id^=result-]{margin-left:12px;font-size:12.5px}
.dl-settings .confirmation{margin:0 0 20px;padding:14px 16px;border:1px solid var(--dl-border);border-radius:var(--dl-r-md);background:var(--dl-surface);box-shadow:var(--dl-shadow-2)}
.dl-settings .confirmation p{margin:0 0 12px}
.dl-settings .confirmation .actions{justify-content:flex-end;margin:0}
.dl-settings .confirmation .actions button:last-child{background:var(--dl-accent);border-color:var(--dl-accent);color:var(--dl-on-accent)}
@media(max-width:719px){
.dl-settings{padding:12px 0 40px}
.dl-settings .settings-shell{display:block}
.dl-settings .settings-side{position:static;margin:0 0 20px;border-bottom:1px solid var(--dl-border)}
.dl-settings .settings-heading{margin:0;padding:0 16px}
.dl-settings nav{flex-direction:row;gap:20px;padding:0 16px;border-left:0;overflow-x:auto;scrollbar-width:none}
.dl-settings nav a{display:flex;flex:none;align-items:center;min-height:44px;margin:0 0 -1px;padding:0;border-left:0;border-bottom:2px solid transparent;font-size:14px;white-space:nowrap}
.dl-settings nav a[aria-current=page]{border-bottom-color:var(--dl-text)}
.dl-settings .settings-content{padding:0 16px}
.dl-settings .field,.dl-settings .frow{grid-template-columns:minmax(0,1fr) minmax(0,52%);column-gap:16px}
.dl-settings :is(.field:has(>input:not([type=number]):not([type=range]):not([type=checkbox])),.frow:has(>.field-controls)){display:block;padding:12px 0}
.dl-settings .field>input:not([type=number]):not([type=range]):not([type=checkbox]){display:block;width:100%;margin-top:8px}
.dl-settings .frow>.field-controls{display:flex;margin-top:8px}
.dl-settings .field:has(>#profile){display:block;padding:12px 0}
.dl-settings .field>#profile{margin-top:8px}
.dl-settings .style-row{grid-template-columns:16px 72px minmax(0,1fr)}
.dl-settings #provider-card{margin:4px 0 16px}
.dl-settings .feature-details{margin-left:12px}
.dl-settings .privacy-table :is(th,td){padding-right:8px}
.dl-settings :is(.rule-row,.chain-row) button{min-height:44px}
}
`;

// Move existing validated fields into seven views; retain ids as the form/controller contract.
export function organizeLayout(container,form,{field,button}) {
  const doc=container.ownerDocument,el=(tag,text,attrs)=>element(doc,tag,text,attrs),$=id=>container.querySelector('#'+id);
  const original=[...form.children];
  const shell=el('div',null,{class:'settings-shell'}),side=el('div',null,{class:'settings-side'}),nav=el('nav',null,{'aria-label':T.brand}),content=el('div',null,{class:'settings-content'});
  side.append(el('h1',T.brand,{class:'settings-heading'}),nav);form.append(shell);shell.append(side,content);
  const groups={};for(const [id,title]of GROUPS){const link=el('a',title,{href:'#'+id,'data-group-link':id});nav.append(link);const page=el('div',null,{'data-group':id,hidden:''});page.append(el('h2',title,{class:'group-title'}));content.append(page);groups[id]=page;}
  const card=(group,title)=>{const n=el('section');if(title)n.append(el('h2',title));groups[group].append(n);return n;};
  const move=(dest,ids)=>{for(const id of ids){const n=$(id);if(n)dest.append(n.closest('label')||n);}};
  const grid=dest=>{const n=el('div',null,{class:'grid'});dest.append(n);return n;};
  const advanced=(dest,ids,title=T.advanced)=>{const d=el('details');d.append(el('summary',title));const body=grid(d);move(body,ids);dest.append(d);return body;};
  const common=card('common'),commonGrid=el('div',null,{class:'common-rows'});common.append(commonGrid);move(commonGrid,['uiLanguage','targetLang','displayMode']);
  const display=$('displayMode');display.parentElement.hidden=true;
  const displayGroup=segmented(doc,l10n('me1'),[['bilingual',l10n('me2')],['translation-only',l10n('m4f')]],'bilingual',value=>{display.value=value;display.dispatchEvent(new Event('change',{bubbles:true}));});displayGroup.id='display-segments';const displayRow=el('div',null,{class:'frow'});displayRow.append(el('span',l10n('me1'),{class:'field-label'}),displayGroup);commonGrid.append(displayRow);setText($('targetLang').parentElement.firstChild,l10n('polishTranslateInto'));
  const styles=card('common',COPY.s44);move(styles,['style']);$('style').parentElement.hidden=true;
  const tiles=el('div',null,{class:'style-list',id:'style-tiles',role:'radiogroup','aria-label':COPY.s44});styles.append(tiles);
  const shortStyles=[l10n('polishStyle0'),l10n('polishStyle1'),l10n('polishStyle2'),l10n('polishStyle3'),l10n('polishStyle4'),l10n('polishStyle5')];let styleIndex=0;for(const option of $('style').options){const label=el('label',null,{class:'style-row'}),radio=el('input',null,{type:'radio',name:'style-tile',value:option.value});label.title=option.textContent;radio.setAttribute('aria-label',option.textContent);label.append(radio,el('span',shortStyles[styleIndex++],{class:'style-name'}),el('span',T.preview,{class:'sample-translation style-sample','data-style':option.value}));tiles.append(label);}
  const preview=el('div',T.source,{class:'style-preview'});preview.append(el('span',T.preview,{id:'style-preview',class:'sample-translation',tabindex:'0'}));styles.append(preview,el('p',T.learn,{class:'hint',id:'learn-hint'}));
  const translate=card('common',l10n('me9'));move(translate,['translationMode']);$('translationMode').parentElement.hidden=true;
  const methods=el('div',null,{id:'translation-methods',class:'method-list',role:'radiogroup','aria-label':l10n('me9')});for(const [value,title,hint]of[['mt+llm',l10n('polishAutomatic'),l10n('polishAutomaticHint')],['mt',l10n('polishMT'),l10n('polishMTHint')],['llm',l10n('polishAI'),l10n('polishAIHint')]]){const row=el('label',null,{class:'dl-choice'}),input=el('input',null,{type:'radio',name:'translation-method',value}),copy=el('span',title);copy.append(el('small',hint));row.append(input,copy);methods.append(row);}translate.append(methods);
  const mtFields=el('div',null,{class:'mt-fields'});translate.append(mtFields);move(mtFields,['mtEngine','mtFallback','mt-key-row','mt-test']);translate.append(el('p',l10n('polishUnofficial'),{class:'hint',id:'mt-unofficial'}));
  translate.append(el('p','', {id:'mt-destination',class:'hint'}));advanced(card('common'),['sourceLang','translateShortText','minChars','inlineMaxChars','rootMarginPx','batchDelayMs','mtRegion']);
  const ai=card('ai');ai.append(el('p',COPY.s45,{class:'lead'}));move(ai,['profile']);setText($('profile').parentElement.firstChild,l10n('polishCurrent'));
  const presets=el('div',null,{id:'preset-tiles',class:'preset-list'});for(const [id,name,hint]of[['openai','OpenAI',T.key],['deepseek','DeepSeek',T.key],['openrouter','OpenRouter',T.free],['ollama',T.local,T.localHint],['custom',T.custom,T.customHint]]){const b=button(presets,'preset-'+id,name);b.dataset.preset=id;b.append(el('small',hint));}ai.append(presets);
  move(ai,['providerPreset','add-profile']);$('providerPreset').parentElement.hidden=true;$('add-profile').hidden=true;
  ai.append(el('p',l10n('polishChoose'),{id:'provider-empty',class:'hint'}));
  const provider=card('ai');provider.id='provider-card';const providerHeading=el('div',null,{class:'provider-heading'});providerHeading.append(el('h2','',{id:'provider-name'}),el('p','',{id:'provider-hint',class:'hint',hidden:''}));move(providerHeading,['key-link']);provider.append(providerHeading);move(provider,['provider-description']);$('provider-description').hidden=true;
  const main=el('div',null,{class:'provider-fields'});provider.append(main);move(main,['key-row']);
  if($('apiKey')){const key=$('apiKey'),row=key.parentElement;row.classList.replace('wide','frow');const controls=el('span',null,{class:'field-controls'});key.after(controls);controls.append(key);button(controls,'show-key',COMMON.showKey);}
  field(main,'localEngine',T.localEngine,'select',[{id:'ollama',name:'Ollama'},{id:'lmstudio',name:'LM Studio'}]);
  move(main,['baseUrl','model','models']);$('baseUrl').parentElement.classList.replace('wide','frow');const modelRow=$('model').parentElement;modelRow.classList.add('frow');const modelControls=el('span',null,{class:'field-controls'});$('model').after(modelControls);modelControls.append($('model'));move(modelControls,['load-models']);
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
  const editor=el('div',null,{id:'site-rule-editor',hidden:''});sites.append(editor);move(editor,['rule-match','rule-page','rule-selection','rule-hover','rule-input']);const siteActions=el('div',null,{class:'group-actions',id:'site-actions',hidden:''});sites.append(siteActions);button(siteActions,'cancel-sites',T.cancel);move(siteActions,['site-rule-add']);setText($('site-rule-add'),T.save);$('site-rule-add').className='primary';
  advanced(sites,['always','never','autoLangs','customRules']);const legacyActions=el('div',null,{class:'group-actions',id:'site-advanced-actions',hidden:''});button(legacyActions,'save-sites',T.save).className='primary';sites.querySelector('details').append(legacyActions);
  const glossary=card('glossary');move(glossary,['glossary']);glossary.append(el('p',l10n('polishGlossaryHint'),{class:'hint'}));const glossaryActions=el('div',null,{class:'group-actions'});button(glossaryActions,'cancel-glossary',T.cancel);button(glossaryActions,'save-glossary',T.save).className='primary';glossary.append(glossaryActions);
  const data=card('data');data.append(el('p',T.data,{class:'lead'}),el('p','',{id:'privacy-current'}));move(data,['sync-status']);const table=el('table',null,{class:'privacy-table'}),thead=el('thead'),tr=el('tr');for(const title of [l10n('polishWho'),l10n('polishWhat'),l10n('polishWhen')])tr.append(el('th',title));thead.append(tr);table.append(thead,el('tbody',null,{id:'privacy-rows'}));data.append(table);
  const cache=card('data',COPY.s49);move(cache,['cacheEnabled','cache-stats','cache-clear']);advanced(cache,['maxEntries','ttlDays']);
  const backup=card('data',COPY.s50);backup.append(el('p',l10n('polishTransferSteps'),{class:'lead'}));move(backup,['backupPassword','backupText','export','import-button','export-phone','copy-backup','import-computer','backup-qr','import-file','import-file-button']);$('export-phone').textContent=l10n('polishTransfer');const backupActions=el('div',null,{class:'actions'});for(const id of ['export','import-button','export-phone','copy-backup','import-computer','import-file-button'])if($(id))backupActions.append($(id));backup.append(backupActions);button(card('data'),'restore-defaults',T.reset).className='dl-danger';
  const about=card('about');about.append(el('p',T.about,{class:'lead'}),el('p','',{id:'app-version'}));const links=el('div',null,{class:'about-links'});about.append(links);
  for(const [title,url]of[[T.sourceLink,'https://github.com/ray-oriental/duallens'],[l10n('polishPrivacy'),'https://github.com/ray-oriental/duallens/blob/main/docs/PRIVACY.md'],[l10n('polishFeedback'),'https://github.com/ray-oriental/duallens/issues'],[l10n('polishLicenses'),'https://github.com/ray-oriental/duallens/tree/main/extension/vendor']]){const row=el('p');row.append(el('a',title,{href:url,target:'_blank',rel:'noopener noreferrer'}));links.append(row);}about.append(el('p',l10n('polishComponents')),el('h3',l10n('polishShortcuts')),el('p',l10n('polishShortcutHint')));
  for(const input of container.querySelectorAll('input[type=checkbox]'))input.setAttribute('role','switch');
  const feedback=el('div',null,{class:'status',id:'form-feedback'});move(feedback,['status']);content.append(feedback);content.querySelector('.group-title').append(el('span',T.saved,{id:'saved-toast',class:'saved',role:'status','aria-live':'polite'}));
  // All controls have now moved; drop the obsolete long-page sections.
  for(const n of original)if(n.parentElement===form)n.remove();
}

import { t as l10n, message, setText, localize, setUiLanguage } from '../shared/i18n.js';
import { engineDisclosure } from '../ui/components.js';
import { LANGS, providerChain } from '../shared/settings.js';
import { SHARED_CSS } from '../ui/theme.js';
import { withSendConfirmation, confirmationCard } from '../content/confirmation.js';
import { createFeedback } from '../ui/forms/feedback.js';
import { CANCELLED, detectedSource, swappedLanguages, untilAborted } from './text-state.js';

export const MEDIA_CSS = SHARED_CSS + `
.dl-text,.dl-subtitle-settings{color:var(--dl-text);font:400 14px/1.6 var(--dl-font)}
.dl-text *,.dl-subtitle-settings *{box-sizing:border-box}
.dl-media-page{margin-top:16px}
.dl-text h2,.dl-subtitle-settings h2{margin:0 0 12px;font-size:13px;font-weight:600;line-height:20px}
.dl-text h2:first-child{display:none}
.dl-text label,.dl-subtitle-settings label{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;color:var(--dl-text-2);font-size:12.5px}
.dl-text :is(input,select,textarea),.dl-subtitle-settings :is(input,select){width:100%;min-width:0;max-width:100%;color:var(--dl-text);font-size:14px}
.dl-text .language-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dl-text .language-pair label{min-width:0}
.dl-text textarea{min-height:160px;resize:vertical;line-height:1.6}
.dl-text button[type=submit]{min-width:96px;background:var(--dl-accent);border-color:var(--dl-accent);color:var(--dl-on-accent)}
.dl-text button[type=submit]:hover:not(:disabled){background:var(--dl-accent);opacity:.9}
.dl-text .text-status,.dl-subtitle-settings p{margin:8px 0 0;color:var(--dl-text-3);font-size:12.5px;overflow-wrap:anywhere}
.dl-text .text-status:empty{display:none}
.dl-text h2:not(:first-child){margin-top:24px;padding-top:16px;border-top:1px solid var(--dl-border);color:var(--dl-text-2);font-weight:500;font-size:12.5px}
.dl-text output{display:block;min-height:72px;padding:0 0 4px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.7}
.dl-text .actions{display:flex;gap:4px;margin:4px 0 0 -4px}
.dl-text .actions button{min-height:28px;padding:0 4px;border-color:transparent;background:transparent;color:var(--dl-text-2);font-weight:400}
.dl-text .actions button:hover:not(:disabled){background:transparent;color:var(--dl-text);text-decoration:underline;text-underline-offset:3px}
.dl-text .service-choices{margin:0 0 12px}
.dl-text .service-choices>summary{color:var(--dl-text-2);font-size:13px}
.dl-text .service-choices label{margin-top:8px}
.dl-text .service-choices .actions{margin:0 0 4px}
.dl-text .engine-disclosure{margin-top:20px;padding-top:12px;border-top:1px solid var(--dl-border)}
.dl-text .engine-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0;color:var(--dl-text-3);font-size:12px}
.dl-text .engine-line .dl-text-button{flex:none;margin-right:-4px;font-size:12px}
.dl-subtitle-settings>button{margin:12px 8px 0 0}
.dl-subtitle-settings>button:first-of-type{background:var(--dl-accent);border-color:var(--dl-accent);color:var(--dl-on-accent)}
.dl-subtitle-settings>button:first-of-type:hover:not(:disabled){background:var(--dl-accent);opacity:.9}
.dl-subtitle-settings .subtitle-file-status{margin-top:12px;color:var(--dl-text-2)}
.dl-subtitle-settings .subtitle-file-status:empty,.dl-subtitle-settings .subtitle-preview:empty{display:none}
.dl-subtitle-settings .subtitle-preview{max-height:320px;overflow:auto;margin:12px 0 0;padding:12px 14px;border:1px solid var(--dl-border);border-radius:var(--dl-r-sm);font:12px/1.6 var(--dl-font-mono)}
.dl-media-page[hidden]{display:none!important}
@media(pointer:fine){.dl-text :is(input,select,textarea),.dl-subtitle-settings :is(input,select){font-size:13px}.dl-text :is(input,select),.dl-subtitle-settings :is(input,select){min-height:32px}.dl-text :where(button),.dl-subtitle-settings :where(button){min-height:32px}.dl-segment span{min-height:26px}}
@media(pointer:coarse){.dl-text .engine-line .dl-text-button,.dl-text .actions button{min-height:44px}}
`;

export function element(tag, text) {
  const node = document.createElement(tag); if (text !== undefined) setText(node, text); return node;
}
export function field(parent, label, control) {
  const node = element('label', label); node.append(control); parent.append(node); return control;
}
export function selectOptions(select, options, value) {
  select.replaceChildren(...options.map(([key, label]) => { const option = element('option', label); option.value = key; return option; }));
  if ([...select.options].some(o => o.value === value)) select.value = value;
}

export async function mountTextForm(root, { platform }) {
  let settings = await platform.settingsStore.load();
  setUiLanguage(settings.uiLanguage);
  platform = withSendConfirmation(platform, () => settings, {prompt:opts=>confirmationCard({...opts,root})});
  const style = element('style', MEDIA_CSS); root.append(style);
  const service = platform.translator();
  const form = element('form'); form.className = 'dl-text';
  const heading = element('h2', message('ma6')); form.append(heading);
  const pair=element('div');pair.className='language-pair';form.append(pair);
  const from = field(pair, message('ma7'), element('select')); from.name = 'text-from';
  const to = field(pair, message('ma8'), element('select')); to.name = 'text-to';
  const languageActions=element('div');languageActions.className='actions';
  const swap=element('button',message('uxTextSwap')),clear=element('button',message('uxTextClear'));
  swap.type=clear.type='button';swap.name='text-swap';clear.name='text-clear';languageActions.append(swap,clear);form.append(languageActions);
  const swapHint=element('p');swapHint.className='dl-hint';swapHint.id='text-swap-hint';swap.setAttribute('aria-describedby',swapHint.id);form.append(swapHint);
  const choicesPanel=element('details');choicesPanel.className='service-choices';choicesPanel.append(element('summary',message('polishService')));form.append(choicesPanel);
  const profiles = field(choicesPanel, message('ma9'), element('select')); profiles.name = 'text-profile';
  const models = field(choicesPanel, message('maa'), element('select')); models.name = 'text-model';
  const load = element('button', message('mab')); load.type = 'button'; load.className = 'text-load-models';
  const configure = element('button', message('mac')); configure.type = 'button'; configure.addEventListener('click', () => platform.openSettings());
  const choices = element('div'); choices.className = 'actions'; choices.append(load, configure); choicesPanel.append(choices);
  const input = field(form, message('mad'), element('textarea')); input.name = 'text-input'; input.maxLength = 20000; input.required = true;
  const empty=element('p',message('uxTextEmpty'));empty.className='dl-hint';form.append(empty);
  const translate = element('button', message('m6v')); translate.type = 'submit';translate.name='text-translate'; form.append(translate);
  const status = element('p'); status.id='status';status.className = 'text-status'; status.setAttribute('role', 'status'); form.append(status);
  form.append(element('h2', message('m53')));
  const output = element('output'); output.name = 'text-result'; output.setAttribute('aria-live', 'polite'); output.dir = 'auto'; form.append(output);
  const actions = element('div'); actions.className = 'actions';
  const copy = element('button', message('m5g')), speak = element('button', message('m5i'));
  copy.name='text-copy';
  copy.type = speak.type = 'button'; copy.disabled = speak.disabled = true; actions.append(copy, speak); form.append(actions);
  const disclosure=element('div');form.append(disclosure);root.append(form);
  const feedback=createFeedback(form);
  let disposed = false, sequence = 0, modelSequence = 0, utterance = null, pending,detected='',detectedText='',initialized=false;
  const stopSpeech = () => { if (utterance) { globalThis.speechSynthesis?.cancel(); utterance = null; } };
  function drawControls() {
    if(disposed)return;
    const source=detectedText===input.value?detected:'';
    swap.disabled=!swappedLanguages(from.value,to.value,source);
    swapHint.hidden=from.value!=='auto';
    setText(swapHint,source?message('uxTextDetected',[LANGS.find(lang=>lang.code===source)?.name||source]):message('uxTextSwapUnknown'));
    empty.hidden=!!input.value.trim();clear.disabled=!input.value&&!output.textContent&&!pending;
    translate.disabled=!input.value.trim()||feedback.pending.has(translate);
    copy.disabled=!output.textContent||feedback.pending.has(copy);
    speak.disabled=!output.textContent||!globalThis.speechSynthesis;
    setText(translate,message(feedback.pending.has(translate)?'m4x':'m6v'));
    setText(copy,message(feedback.pending.has(copy)?'actionWorking':'m5g'));
  }
  const reset = (forgetDetected=false) => {
    pending?.abort(); pending = null;
    sequence++; output.textContent = '';form.removeAttribute('aria-busy');
    if(forgetDetected){detected='';detectedText='';}
    stopSpeech();feedback.notice('');drawControls();
  };
  clear.addEventListener('click',()=>{input.value='';reset(true);feedback.notice(l10n('uxTextCleared'));input.focus();});
  swap.addEventListener('click',()=>{
    const next=swappedLanguages(from.value,to.value,detectedText===input.value?detected:'');if(!next)return;
    const result=output.textContent;reset(true);from.value=next.from;to.value=next.to;
    if(result)input.value=result;drawControls();
  });
  const onEscape=event=>{
    if(event.key!=='Escape')return;
    if(!pending){if(platform.kind==='extension')event.preventDefault();return;}
    event.preventDefault();event.stopImmediatePropagation();reset();feedback.notice(l10n('uxTextCancelled'));
  };
  root.ownerDocument.addEventListener('keydown',onEscape,true);
  function drawDisclosure() {
    const profile=settings.provider.profiles.find(p=>p.id===profiles.value);
    const current=profile?{...settings,provider:{...settings.provider,active:profile.id,
      chain:[{profileId:profile.id,model:models.value||profile.model},...providerChain(settings).map(c=>({profileId:c.profile.id,model:c.model}))]}}:settings;
    disclosure.replaceChildren(engineDisclosure(root.ownerDocument,current,group=>platform.openSettings(group)));
  }
  function profileModels() {
    modelSequence++;
    const profile = settings?.provider.profiles.find(p => p.id === profiles.value);
    const values = [...new Set([profile?.model, ...(profile?.fallbackModels || []),
      ...(settings?.provider.chain || []).filter(c => c.profileId === profiles.value).map(c => c.model)].filter(Boolean))];
    selectOptions(models, values.map(v => [v, v]), profile?.model);
    models.disabled = !profile; load.disabled = !profile;
    drawDisclosure();
  }
  profiles.addEventListener('change', () => { reset(); profileModels(); });
  models.addEventListener('change',drawDisclosure);
  for (const control of [from, to, models, input]) control.addEventListener('input',()=>reset(control===input));
  load.addEventListener('click', async () => {
    const token = ++modelSequence, profileId = profiles.value;
    load.disabled = true; feedback.notice(l10n('mae'));
    try {
      const result = await service.listModels(profileId);
      if (disposed || token !== modelSequence || profileId !== profiles.value) return;
      if (!result.ok) { feedback.notice(result.error?.message || l10n('maf'),true); return; }
      const value = models.value;
      const values = new Map([...models.options].map(o => [o.value, o.textContent]));
      for (const model of result.models || []) if (typeof model.id === 'string') values.set(model.id, model.label || model.id);
      selectOptions(models, [...values], value);
      drawDisclosure();
      feedback.notice(l10n('mag', [result.models?.length || 0]));
    } catch { if (!disposed && token === modelSequence) feedback.notice(l10n('maf'),true); }
    finally { if (!disposed && token === modelSequence) load.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value.trim()||feedback.pending.has(translate)) return;
    reset(); const token = sequence;
    const controller=new AbortController(),text=input.value,source=from.value,target=to.value;
    pending=controller;form.setAttribute('aria-busy','true');
    await feedback.run(translate,async report=>{
      report(l10n('m4x'));
      try {
        if(source==='auto'&&platform.detectLanguage&&detectedText!==text){
          const language=await untilAborted(()=>platform.detectLanguage(text),controller.signal).catch(()=>null);
          if(disposed||token!==sequence||language===CANCELLED)return;
          detected=detectedSource(language);detectedText=text;drawControls();
        }
        const result=await untilAborted(()=>service.translateText({text,from:source,to:target,purpose:'text',signal:controller.signal,
          ...(profiles.value?{profileId:profiles.value,model:models.value}:{})}),controller.signal);
        if(disposed||token!==sequence||result===CANCELLED)return;
        if(!result.ok){report(result.error?.message||l10n('mah'),true);return;}
        output.textContent=result.text||'';report(l10n('mai'));
      }catch{if(!disposed&&token===sequence)report(l10n('maj'),true);}
      finally{if(token===sequence){pending=null;form.removeAttribute('aria-busy');}}
    },{busy:l10n('m4x')});
    drawControls();
  });
  copy.addEventListener('click', async () => {
    const token=sequence,text=output.textContent;
    await feedback.run(copy,async report=>{
      try{await navigator.clipboard.writeText(text);if(!disposed&&token===sequence)report(l10n('m55'));}
      catch{if(!disposed&&token===sequence)report(l10n('mak'),true);}
    });drawControls();
  });
  speak.addEventListener('click', () => {
    try {
      stopSpeech(); utterance = new SpeechSynthesisUtterance(output.textContent); utterance.lang = to.value;
      globalThis.speechSynthesis.speak(utterance);
    } catch { feedback.notice(l10n('mal'),true); }
  });
  let settingsSequence = 0;
  async function reload() {
    const token = ++settingsSequence;
    const next = await platform.settingsStore.load();
    if (disposed || token !== settingsSequence) return;
    const localeOnly=JSON.stringify({...settings,uiLanguage:null})===JSON.stringify({...next,uiLanguage:null});
    settings = next; setUiLanguage(settings.uiLanguage); localize(form); if(!localeOnly)reset();choicesPanel.hidden=settings.provider.profiles.filter(p=>p.kind!=='mock'&&p.baseUrl&&p.model).length<2;
    selectOptions(from, [['auto', l10n('m5e')], ...LANGS.map(l => [l.code, l.name])], initialized&&localeOnly?from.value:settings.sourceLang);
    selectOptions(to, LANGS.map(l => [l.code, l.name]), initialized&&localeOnly?to.value:settings.targetLang);
    selectOptions(profiles, [['', l10n('mam')], ...settings.provider.profiles.map(p => [p.id, p.name || p.id])], profiles.value);
    profileModels();initialized=true;drawControls();
  }
  const off = platform.settingsStore.onChange(() => { void reload().catch(() => { feedback.notice(l10n('ma5'),true); }); });
  try { await reload(); }
  catch { feedback.notice(l10n('ma5'),true); }
  return { destroy() { disposed = true; pending?.abort(); sequence++;feedback.destroy();root.ownerDocument.removeEventListener('keydown',onEscape,true);off(); stopSpeech(); service.dispose?.(); form.remove(); style.remove(); } };
}

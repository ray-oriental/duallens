import { t as l10n } from '../shared/i18n.js';
import { engineDisclosure } from '../ui/components.js';
import { LANGS, providerChain } from '../shared/settings.js';
import { SHARED_CSS } from '../ui/theme.js';
import { withSendConfirmation, confirmationCard } from '../content/confirmation.js';

export const MEDIA_CSS = SHARED_CSS + `
.dl-text,.dl-subtitle-settings { color:var(--dl-text,#1f2328); font:16px/1.5 var(--dl-font,system-ui); }
.dl-text *, .dl-subtitle-settings * { box-sizing:border-box; }
.dl-text label,.dl-subtitle-settings label { display:flex;flex-direction:column;gap:6px;margin:12px 0; }
.dl-text input,.dl-text select,.dl-text textarea,.dl-subtitle-settings select,.dl-subtitle-settings input {
  width:100%;min-height:44px;padding:8px;font:inherit;color:var(--dl-text,#1f2328);background:var(--dl-inset,#f6f8fa);
  border:1px solid var(--dl-border-strong,#d1d9e0);border-radius:8px; }
.dl-text .language-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dl-text .service-choices{margin:8px 0}.dl-text .engine-row{display:flex;align-items:center;gap:8px;font-size:13px;border-top:1px solid var(--dl-border);padding-top:12px}.dl-text .engine-row strong{flex:1;font-weight:400}.dl-text .privacy{font-size:12px;color:var(--dl-text-2)}.dl-text .engine-row button{padding:0 4px;border:0;background:none;font-size:13px;min-height:32px}.dl-text h2{font-size:16px}.dl-text .language-pair label{min-width:0}.dl-text select{max-width:100%;min-width:0}
@media(pointer:coarse){.dl-text .engine-row button{min-height:44px}}
.dl-text textarea { min-height:160px;resize:vertical; }
.dl-text button,.dl-subtitle-settings button,.dl-media-tabs button { min-height:44px;min-width:44px;padding:8px 12px;
  font:inherit;border:1px solid var(--dl-border-strong,#d1d9e0);border-radius:8px;color:var(--dl-text,#1f2328);background:var(--dl-inset,#f6f8fa);cursor:pointer; }
.dl-text .actions,.dl-media-tabs { display:flex;gap:8px;flex-wrap:wrap; }
.dl-text output { display:block;white-space:pre-wrap;overflow-wrap:anywhere;min-height:100px;padding:12px 0; }
.dl-text .text-status,.dl-subtitle-settings p { color:var(--dl-text-2,#59636e);overflow-wrap:anywhere; }
.dl-text h2,.dl-subtitle-settings h2 { font-size:18px;margin:14px 0; }
.dl-text button[type=submit],.dl-media-tabs button[aria-selected=true] { background:var(--dl-accent,#4263eb);color:var(--dl-on-accent,#fff); }
.dl-media-tabs { margin:12px 0;border-bottom:1px solid var(--dl-border-strong,#d1d9e0);padding-bottom:12px; }
.dl-media-page[hidden] { display:none!important; }
`;

export function element(tag, text) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
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
  platform = withSendConfirmation(platform, () => settings, {prompt:opts=>confirmationCard({...opts,root})});
  const style = element('style', MEDIA_CSS); root.append(style);
  const service = platform.translator();
  const form = element('form'); form.className = 'dl-text';
  const heading = element('h2', l10n('ma6')); form.append(heading);
  const pair=element('div');pair.className='language-pair';form.append(pair);
  const from = field(pair, l10n('ma7'), element('select')); from.name = 'text-from';
  const to = field(pair, l10n('ma8'), element('select')); to.name = 'text-to';
  const choicesPanel=element('details');choicesPanel.className='service-choices';choicesPanel.append(element('summary',l10n('polishService')));form.append(choicesPanel);
  const profiles = field(choicesPanel, l10n('ma9'), element('select')); profiles.name = 'text-profile';
  const models = field(choicesPanel, l10n('maa'), element('select')); models.name = 'text-model';
  const load = element('button', l10n('mab')); load.type = 'button'; load.className = 'text-load-models';
  const configure = element('button', l10n('mac')); configure.type = 'button'; configure.addEventListener('click', () => platform.openSettings());
  const choices = element('div'); choices.className = 'actions'; choices.append(load, configure); choicesPanel.append(choices);
  const input = field(form, l10n('mad'), element('textarea')); input.name = 'text-input'; input.maxLength = 20000; input.required = true;
  const translate = element('button', l10n('m6v')); translate.type = 'submit'; form.append(translate);
  const status = element('p'); status.className = 'text-status'; status.setAttribute('role', 'status'); form.append(status);
  form.append(element('h2', l10n('m53')));
  const output = element('output'); output.name = 'text-result'; output.setAttribute('aria-live', 'polite'); output.dir = 'auto'; form.append(output);
  const actions = element('div'); actions.className = 'actions';
  const copy = element('button', l10n('m5g')), speak = element('button', l10n('m5i'));
  copy.type = speak.type = 'button'; copy.disabled = speak.disabled = true; actions.append(copy, speak); form.append(actions);
  const disclosure=element('div');form.append(disclosure);root.append(form);
  let disposed = false, sequence = 0, modelSequence = 0, utterance = null, pending;
  const stopSpeech = () => { if (utterance) { globalThis.speechSynthesis?.cancel(); utterance = null; } };
  const reset = () => {
    pending?.abort(); pending = null;
    sequence++; output.textContent = ''; copy.disabled = speak.disabled = true; translate.disabled = false;
    stopSpeech(); status.textContent = '';
  };
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
  for (const control of [from, to, models, input]) control.addEventListener('input', reset);
  load.addEventListener('click', async () => {
    const token = ++modelSequence, profileId = profiles.value;
    load.disabled = true; status.textContent = l10n('mae');
    try {
      const result = await service.listModels(profileId);
      if (disposed || token !== modelSequence || profileId !== profiles.value) return;
      if (!result.ok) { status.textContent = result.error?.message || l10n('maf'); return; }
      const value = models.value;
      const values = new Map([...models.options].map(o => [o.value, o.textContent]));
      for (const model of result.models || []) if (typeof model.id === 'string') values.set(model.id, model.label || model.id);
      selectOptions(models, [...values], value);
      drawDisclosure();
      status.textContent = l10n('mag', [result.models?.length || 0]);
    } catch { if (!disposed && token === modelSequence) status.textContent = l10n('maf'); }
    finally { if (!disposed && token === modelSequence) load.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    reset(); const token = sequence;
    pending = new AbortController();
    translate.disabled = true; status.textContent = l10n('m4x');
    try {
      const result = await service.translateText({ text: input.value, from: from.value, to: to.value, purpose: 'text', signal:pending.signal,
        ...(profiles.value ? { profileId: profiles.value, model: models.value } : {}) });
      if (disposed || token !== sequence) return;
      if (!result.ok) { status.textContent = result.error?.message || l10n('mah'); return; }
      output.textContent = result.text || ''; copy.disabled = !output.textContent;
      speak.disabled = !output.textContent || !globalThis.speechSynthesis;
      status.textContent = l10n('mai');
    } catch { if (!disposed && token === sequence) status.textContent = l10n('maj'); }
    finally { if (!disposed && token === sequence) translate.disabled = false; }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(output.textContent); status.textContent = l10n('m55'); }
    catch { status.textContent = l10n('mak'); }
  });
  speak.addEventListener('click', () => {
    try {
      stopSpeech(); utterance = new SpeechSynthesisUtterance(output.textContent); utterance.lang = to.value;
      globalThis.speechSynthesis.speak(utterance);
    } catch { status.textContent = l10n('mal'); }
  });
  let settingsSequence = 0;
  async function reload() {
    const token = ++settingsSequence;
    const next = await platform.settingsStore.load();
    if (disposed || token !== settingsSequence) return;
    settings = next; reset();choicesPanel.hidden=settings.provider.profiles.filter(p=>p.kind!=='mock'&&p.baseUrl&&p.model).length<2;
    selectOptions(from, [['auto', l10n('m5e')], ...LANGS.map(l => [l.code, l.name])], settings.sourceLang);
    selectOptions(to, LANGS.map(l => [l.code, l.name]), settings.targetLang);
    selectOptions(profiles, [['', l10n('mam')], ...settings.provider.profiles.map(p => [p.id, p.name || p.id])], profiles.value);
    profileModels();
  }
  const off = platform.settingsStore.onChange(() => { void reload().catch(() => { status.textContent = l10n('ma5'); }); });
  try { await reload(); }
  catch { status.textContent = l10n('ma5'); }
  return { destroy() { disposed = true; pending?.abort(); sequence++; off(); stopSpeech(); service.dispose?.(); form.remove(); style.remove(); } };
}

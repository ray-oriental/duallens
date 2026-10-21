import { LANGS } from '../shared/settings.js';
import { SHARED_CSS } from '../ui/theme.js';

export const MEDIA_CSS = SHARED_CSS + `
.dl-text,.dl-subtitle-settings { color:var(--dl-text,#1f2328); font:16px/1.5 var(--dl-font,system-ui); }
.dl-text *, .dl-subtitle-settings * { box-sizing:border-box; }
.dl-text label,.dl-subtitle-settings label { display:flex;flex-direction:column;gap:6px;margin:12px 0; }
.dl-text input,.dl-text select,.dl-text textarea,.dl-subtitle-settings select,.dl-subtitle-settings input {
  width:100%;min-height:44px;padding:8px;font:inherit;color:var(--dl-text,#1f2328);background:var(--dl-inset,#f6f8fa);
  border:1px solid var(--dl-border-strong,#d1d9e0);border-radius:8px; }
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
  const style = element('style', MEDIA_CSS); root.append(style);
  const service = platform.translator();
  const form = element('form'); form.className = 'dl-text';
  const heading = element('h2', '文本翻译'); form.append(heading);
  const from = field(form, '源语言', element('select')); from.name = 'text-from';
  const to = field(form, '目标语言', element('select')); to.name = 'text-to';
  const profiles = field(form, '服务', element('select')); profiles.name = 'text-profile';
  const models = field(form, '模型', element('select')); models.name = 'text-model';
  const load = element('button', '获取模型'); load.type = 'button'; load.className = 'text-load-models';
  const configure = element('button', '配置服务'); configure.type = 'button'; configure.addEventListener('click', () => platform.openSettings());
  const choices = element('div'); choices.className = 'actions'; choices.append(load, configure); form.append(choices);
  const input = field(form, '待翻译文本', element('textarea')); input.name = 'text-input'; input.maxLength = 20000; input.required = true;
  const translate = element('button', '翻译'); translate.type = 'submit'; form.append(translate);
  const status = element('p'); status.className = 'text-status'; status.setAttribute('role', 'status'); form.append(status);
  form.append(element('h2', '译文'));
  const output = element('output'); output.name = 'text-result'; output.setAttribute('aria-live', 'polite'); output.dir = 'auto'; form.append(output);
  const actions = element('div'); actions.className = 'actions';
  const copy = element('button', '复制'), speak = element('button', '朗读');
  copy.type = speak.type = 'button'; copy.disabled = speak.disabled = true; actions.append(copy, speak); form.append(actions);
  root.append(form);
  let settings, disposed = false, sequence = 0, modelSequence = 0, utterance = null;
  const stopSpeech = () => { if (utterance) { globalThis.speechSynthesis?.cancel(); utterance = null; } };
  const reset = () => {
    sequence++; output.textContent = ''; copy.disabled = speak.disabled = true; translate.disabled = false;
    stopSpeech(); status.textContent = '';
  };
  function profileModels() {
    modelSequence++;
    const profile = settings?.provider.profiles.find(p => p.id === profiles.value);
    const values = [...new Set([profile?.model, ...(profile?.fallbackModels || []),
      ...(settings?.provider.chain || []).filter(c => c.profileId === profiles.value).map(c => c.model)].filter(Boolean))];
    selectOptions(models, values.map(v => [v, v]), profile?.model);
    models.disabled = !profile; load.disabled = !profile;
  }
  profiles.addEventListener('change', () => { reset(); profileModels(); });
  for (const control of [from, to, models, input]) control.addEventListener('input', reset);
  load.addEventListener('click', async () => {
    const token = ++modelSequence, profileId = profiles.value;
    load.disabled = true; status.textContent = '正在获取模型…';
    try {
      const result = await service.listModels(profileId);
      if (disposed || token !== modelSequence || profileId !== profiles.value) return;
      if (!result.ok) { status.textContent = result.error?.message || '模型获取失败'; return; }
      const value = models.value;
      const values = new Map([...models.options].map(o => [o.value, o.textContent]));
      for (const model of result.models || []) if (typeof model.id === 'string') values.set(model.id, model.label || model.id);
      selectOptions(models, [...values], value);
      status.textContent = `获取到 ${result.models?.length || 0} 个模型`;
    } catch { if (!disposed && token === modelSequence) status.textContent = '模型获取失败'; }
    finally { if (!disposed && token === modelSequence) load.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    reset(); const token = sequence;
    translate.disabled = true; status.textContent = '正在翻译…';
    try {
      const result = await service.translateText({ text: input.value, from: from.value, to: to.value, purpose: 'text',
        ...(profiles.value ? { profileId: profiles.value, model: models.value } : {}) });
      if (disposed || token !== sequence) return;
      if (!result.ok) { status.textContent = result.error?.message || '翻译失败'; return; }
      output.textContent = result.text || ''; copy.disabled = !output.textContent;
      speak.disabled = !output.textContent || !globalThis.speechSynthesis;
      status.textContent = '翻译完成';
    } catch { if (!disposed && token === sequence) status.textContent = '翻译失败，请重试'; }
    finally { if (!disposed && token === sequence) translate.disabled = false; }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(output.textContent); status.textContent = '已复制'; }
    catch { status.textContent = '无法访问剪贴板，请选中译文复制'; }
  });
  speak.addEventListener('click', () => {
    try {
      stopSpeech(); utterance = new SpeechSynthesisUtterance(output.textContent); utterance.lang = to.value;
      globalThis.speechSynthesis.speak(utterance);
    } catch { status.textContent = '此设备无法朗读'; }
  });
  let settingsSequence = 0;
  async function reload() {
    const token = ++settingsSequence;
    const next = await platform.settingsStore.load();
    if (disposed || token !== settingsSequence) return;
    settings = next; reset();
    selectOptions(from, [['auto', '自动检测'], ...LANGS.map(l => [l.code, l.name])], settings.sourceLang);
    selectOptions(to, LANGS.map(l => [l.code, l.name]), settings.targetLang);
    selectOptions(profiles, [['', '当前备选链（默认）'], ...settings.provider.profiles.map(p => [p.id, p.name || p.id])], profiles.value);
    profileModels();
  }
  const off = platform.settingsStore.onChange(() => { void reload().catch(() => { status.textContent = '设置读取失败'; }); });
  try { await reload(); }
  catch { status.textContent = '设置读取失败'; }
  return { destroy() { disposed = true; sequence++; off(); stopSpeech(); service.dispose?.(); form.remove(); style.remove(); } };
}

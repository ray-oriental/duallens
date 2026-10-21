import { t as l10n } from '../shared/i18n.js';
import { element, field, selectOptions, MEDIA_CSS } from './text-form.js';
import { MAX_SUBTITLE_BYTES, parseSubtitles, serializeSubtitles } from '../content/subtitles/files.js';
import { SubtitleScheduler } from '../content/subtitles/scheduler.js';
import { withSendConfirmation, confirmationCard } from '../content/confirmation.js';

export async function mountSubtitleForm(root, { platform }) {
  let currentSettings = await platform.settingsStore.load();
  platform = withSendConfirmation(platform, () => currentSettings, {prompt:opts=>confirmationCard({...opts,root})});
  const style = element('style', MEDIA_CSS); const form = element('form'); form.className = 'dl-subtitle-settings';
  const status=element('p');status.setAttribute('role','status');root.append(style,form);
  let disposed = false, version = 0;
  form.append(element('h2', l10n('m9s')));
  const file = field(form, l10n('m9t'), element('input')); file.type = 'file'; file.accept = '.srt,.vtt'; file.name = 'subtitle-file';
  form.append(element('p', l10n('m9u')));
  const translate = element('button', l10n('m9v')), cancel = element('button', l10n('m9w'));
  translate.type = cancel.type = 'button'; translate.disabled = true; cancel.disabled = true;
  form.append(translate, cancel);
  const fileStatus = element('p'); fileStatus.setAttribute('role', 'status'); fileStatus.className = 'subtitle-file-status'; form.append(fileStatus);
  const preview = element('pre'); preview.className = 'subtitle-preview'; preview.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; form.append(preview);
  const exports = ['srt', 'vtt'].map(format => {
    const button = element('button', l10n('m9x', [format.toUpperCase()])); button.type = 'button'; button.disabled = true;
    button.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([serializeSubtitles(cues, format)], { type: 'text/plain;charset=utf-8' }));
      const link = element('a'); link.href = url; link.download = `duallens-bilingual.${format}`; form.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); downloads.set(url, timer);
    }); form.append(button); return button;
  });
  let cues = [], scheduler, service, epoch = 0; const downloads = new Map();
  function stop() { epoch++; scheduler?.stop(); scheduler = null; service?.dispose?.(); service = null; cancel.disabled = true; }
  function show() {
    const count = cues.filter(c => c.translation !== null).length;
    fileStatus.textContent = l10n('m9z', [count, cues.length, scheduler?.failed.size ? l10n('m9y') : '']);
    preview.textContent = serializeSubtitles(cues.slice(0, 20), 'srt');
    for (const button of exports) button.disabled = !cues.length || count !== cues.length;
    if (count + (scheduler?.failed.size || 0) === cues.length) { cancel.disabled = true; translate.disabled = false; }
  }
  file.addEventListener('change', async () => {
    stop(); cues = []; translate.disabled = true; preview.textContent = ''; exports.forEach(b => { b.disabled = true; });
    const selected = file.files[0], token = epoch;
    if (!selected) { fileStatus.textContent = ''; return; }
    try {
      if (selected.size > MAX_SUBTITLE_BYTES) throw new Error(l10n('m5z'));
      const format = selected.name.toLowerCase().match(/\.(srt|vtt)$/)?.[1];
      if (!format) throw new Error(l10n('ma0'));
      const text = await selected.text(); if (disposed || token !== epoch) return;
      cues = parseSubtitles(text, format); show(); translate.disabled = false;
    } catch (error) { if (!disposed && token === epoch) fileStatus.textContent = error.message; }
  });
  translate.addEventListener('click', async () => {
    stop(); const token = epoch; translate.disabled = true;
    try {
      const settings = await platform.settingsStore.load(); if (disposed || token !== epoch) return;
      currentSettings = settings;
      service = platform.translator(); cancel.disabled = false;
      scheduler = new SubtitleScheduler({ service, cues, request: { to: settings.targetLang, from: settings.sourceLang }, onUpdate: show });
      scheduler.seek(0);
    } catch { if (!disposed && token === epoch) { stop(); translate.disabled = false; fileStatus.textContent = l10n('ma1'); } }
  });
  cancel.addEventListener('click', () => { stop(); translate.disabled = !cues.length; fileStatus.textContent = l10n('ma2'); });
  let translationKey;
  async function reload() {
    const token = ++version, settings = await platform.settingsStore.load();
    if (disposed || token !== version) return;
    currentSettings = settings;
    const key = JSON.stringify(['targetLang', 'sourceLang', 'translation', 'provider', 'prompt', 'glossary'].map(k => settings[k]));
    if (translationKey && translationKey !== key) { stop(); for (const cue of cues) cue.translation = null; show(); translate.disabled = !cues.length; }
    translationKey = key;
  }
  const off = platform.settingsStore.onChange(() => { void reload().catch(() => {}); });
  form.addEventListener('submit',event=>event.preventDefault());
  try { await reload(); } catch { status.textContent = l10n('ma5'); }
  return { destroy() { disposed = true; version++; off(); stop(); for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } form.remove(); style.remove(); } };
}

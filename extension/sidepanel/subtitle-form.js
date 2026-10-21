import { element, field, selectOptions, MEDIA_CSS } from './text-form.js';
import { subtitleOptions } from '../content/subtitles/track.js';
import { MAX_SUBTITLE_BYTES, parseSubtitles, serializeSubtitles } from '../content/subtitles/files.js';
import { SubtitleScheduler } from '../content/subtitles/scheduler.js';
import { withSendConfirmation, confirmationCard } from '../content/confirmation.js';

export async function mountSubtitleForm(root, { platform }) {
  let currentSettings = await platform.settingsStore.load();
  platform = withSendConfirmation(platform, () => currentSettings, {prompt:opts=>confirmationCard({...opts,root})});
  const style = element('style', MEDIA_CSS); const form = element('form'); form.className = 'dl-subtitle-settings';
  form.append(element('h2', '视频双语字幕'));
  const enabled = field(form, '字幕翻译', element('select')); enabled.name = 'subtitle-enabled';
  selectOptions(enabled, [['off', '关闭 / 恢复原字幕'], ['on', '启用']], 'off');
  const mode = field(form, '显示模式', element('select')); mode.name = 'subtitle-mode';
  selectOptions(mode, [['bilingual', '原文 + 译文'], ['translation-only', '仅译文']], 'bilingual');
  const position = field(form, '字幕位置', element('select')); position.name = 'subtitle-position';
  selectOptions(position, [['bottom', '底部'], ['top', '顶部']], 'bottom');
  const size = field(form, '字号（16–48 px）', element('input')); size.name = 'subtitle-size'; size.type = 'number'; size.min = '16'; size.max = '48'; size.step = '1'; size.required = true;
  form.append(element('p', '启用后请打开播放器字幕，选择原始轨道。支持 YouTube 和 HTML5 标准字幕，不做语音识别；使用已配置的翻译服务。关闭后恢复原字幕。'));
  const save = element('button', '应用字幕设置'); save.type = 'submit'; form.append(save);
  const status = element('p'); status.setAttribute('role', 'status'); form.append(status); root.append(style, form);
  let disposed = false, version = 0;
  form.append(element('h2', '本地字幕文件'));
  const file = field(form, '导入 SRT / VTT（最大 2 MB）', element('input')); file.type = 'file'; file.accept = '.srt,.vtt'; file.name = 'subtitle-file';
  form.append(element('p', '文件解析、预览和导出在本机完成。点击翻译后，仅字幕文字发送至当前配置的翻译服务；文件名和时间轴不发送。'));
  const translate = element('button', '翻译字幕文件'), cancel = element('button', '取消文件翻译');
  translate.type = cancel.type = 'button'; translate.disabled = true; cancel.disabled = true;
  form.append(translate, cancel);
  const fileStatus = element('p'); fileStatus.setAttribute('role', 'status'); fileStatus.className = 'subtitle-file-status'; form.append(fileStatus);
  const preview = element('pre'); preview.className = 'subtitle-preview'; preview.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; form.append(preview);
  const exports = ['srt', 'vtt'].map(format => {
    const button = element('button', `导出双语 ${format.toUpperCase()}`); button.type = 'button'; button.disabled = true;
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
    fileStatus.textContent = `${count} / ${cues.length} 条已翻译${scheduler?.failed.size ? '；部分失败，可重新翻译' : ''}；预览前 20 条`;
    preview.textContent = serializeSubtitles(cues.slice(0, 20), 'srt');
    for (const button of exports) button.disabled = !cues.length || count !== cues.length;
    if (count + (scheduler?.failed.size || 0) === cues.length) { cancel.disabled = true; translate.disabled = false; }
  }
  file.addEventListener('change', async () => {
    stop(); cues = []; translate.disabled = true; preview.textContent = ''; exports.forEach(b => { b.disabled = true; });
    const selected = file.files[0], token = epoch;
    if (!selected) { fileStatus.textContent = ''; return; }
    try {
      if (selected.size > MAX_SUBTITLE_BYTES) throw new Error('字幕文件不能超过 2 MB');
      const format = selected.name.toLowerCase().match(/\.(srt|vtt)$/)?.[1];
      if (!format) throw new Error('请选择 .srt 或 .vtt 字幕文件');
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
    } catch { if (!disposed && token === epoch) { stop(); translate.disabled = false; fileStatus.textContent = '字幕翻译失败，请检查翻译服务配置'; } }
  });
  cancel.addEventListener('click', () => { stop(); translate.disabled = !cues.length; fileStatus.textContent = '已取消；可继续翻译'; });
  let translationKey;
  async function reload() {
    const token = ++version, settings = await platform.settingsStore.load(), options = subtitleOptions(settings);
    if (disposed || token !== version) return;
    currentSettings = settings;
    const key = JSON.stringify(['targetLang', 'sourceLang', 'translation', 'provider', 'prompt', 'glossary'].map(k => settings[k]));
    if (translationKey && translationKey !== key) { stop(); for (const cue of cues) cue.translation = null; show(); translate.disabled = !cues.length; }
    translationKey = key;
    enabled.value = options.enabled ? 'on' : 'off'; mode.value = options.mode; position.value = options.position; size.value = options.fontSize;
  }
  const off = platform.settingsStore.onChange(() => { void reload().catch(() => {}); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true;
    try {
      await platform.settingsStore.save({ subtitles: subtitleOptions({ subtitles: { enabled: enabled.value === 'on', mode: mode.value, position: position.value, fontSize: size.value } }) });
      if (!disposed) status.textContent = '字幕设置已应用';
    } catch { if (!disposed) status.textContent = '设置保存失败，请重试'; }
    finally { if (!disposed) save.disabled = false; }
  });
  try { await reload(); } catch { status.textContent = '设置读取失败'; }
  return { destroy() { disposed = true; version++; off(); stop(); for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } form.remove(); style.remove(); } };
}

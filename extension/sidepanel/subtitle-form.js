import { element, field, selectOptions, MEDIA_CSS } from './text-form.js';
import { subtitleOptions } from '../content/subtitles/track.js';

export async function mountSubtitleForm(root, { platform }) {
  const style = element('style', MEDIA_CSS); const form = element('form'); form.className = 'dl-subtitle-settings';
  form.append(element('h2', 'YouTube 双语字幕'));
  const enabled = field(form, '字幕翻译', element('select')); enabled.name = 'subtitle-enabled';
  selectOptions(enabled, [['off', '关闭 / 恢复原字幕'], ['on', '启用']], 'off');
  const mode = field(form, '显示模式', element('select')); mode.name = 'subtitle-mode';
  selectOptions(mode, [['bilingual', '原文 + 译文'], ['translation-only', '仅译文']], 'bilingual');
  const position = field(form, '字幕位置', element('select')); position.name = 'subtitle-position';
  selectOptions(position, [['bottom', '底部'], ['top', '顶部']], 'bottom');
  const size = field(form, '字号（16–48 px）', element('input')); size.name = 'subtitle-size'; size.type = 'number'; size.min = '16'; size.max = '48'; size.step = '1'; size.required = true;
  form.append(element('p', '启用后请打开 YouTube 播放器的字幕（CC）以选择原始轨道。仅支持已有字幕；使用已配置的翻译服务与备选链。关闭后恢复原字幕。'));
  const save = element('button', '应用字幕设置'); save.type = 'submit'; form.append(save);
  const status = element('p'); status.setAttribute('role', 'status'); form.append(status); root.append(style, form);
  let disposed = false, version = 0;
  async function reload() {
    const token = ++version, options = subtitleOptions(await platform.settingsStore.load());
    if (disposed || token !== version) return;
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
  return { destroy() { disposed = true; version++; off(); form.remove(); style.remove(); } };
}

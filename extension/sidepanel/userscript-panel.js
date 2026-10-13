import { createSettingsPanel } from '../userscript/panel.js';
import { mountSettingsForm } from '../ui/forms/index.js';
import { element, MEDIA_CSS, mountTextForm } from './text-form.js';
import { mountSubtitleForm } from './subtitle-form.js';

// Reuse the existing dialog and its destroy/race/focus handling without editing
// the shared settings form or the other contributor's userscript entry point.
export function createUserscriptMediaPanel(platform) {
  let selected = 'settings', showTab = null;
  const panel = createSettingsPanel({ store: platform.settingsStore, platform, mountForm: async root => {
    const style = element('style', MEDIA_CSS), tabs = element('div'); tabs.className = 'dl-media-tabs'; tabs.setAttribute('role', 'tablist');
    root.append(style, tabs);
    const pages = [], mounted = new Map(); let disposed = false;
    for (const [id, label, mount] of [['settings', '设置', mountSettingsForm], ['text', '文本翻译', mountTextForm], ['subtitles', '视频字幕', mountSubtitleForm]]) {
      const button = element('button', label); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.tab = id;
      const page = element('section'); page.className = 'dl-media-page'; page.setAttribute('role', 'tabpanel'); page.hidden = true;
      const tabId = `dl-media-tab-${id}`, pageId = `dl-media-page-${id}`;
      button.id = tabId; page.id = pageId; button.setAttribute('aria-controls', pageId); page.setAttribute('aria-labelledby', tabId);
      tabs.append(button); root.append(page); pages.push({ id, button, page, mount });
      button.addEventListener('click', () => { void select(id); });
    }
    async function select(id) {
      if (disposed) return;
      selected = id;
      for (const entry of pages) {
        entry.page.hidden = entry.id !== id; entry.button.setAttribute('aria-selected', String(entry.id === id));
      }
      const entry = pages.find(p => p.id === id);
      if (!entry || mounted.has(id)) return;
      mounted.set(id, null);
      try {
        const result = await entry.mount(entry.page, { store: platform.settingsStore, platform });
        if (disposed) result?.destroy?.(); else mounted.set(id, result);
      } catch { if (!disposed) entry.page.textContent = '页面加载失败，请关闭后重试'; }
    }
    showTab = select; await select(selected);
    return { destroy() { disposed = true; showTab = null; for (const result of mounted.values()) result?.destroy?.(); root.replaceChildren(); } };
  } });
  return { open(tab = 'settings') { selected = tab; if (showTab) return showTab(tab); return panel.open(); }, close: panel.close };
}

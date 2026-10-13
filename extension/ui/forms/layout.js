import { LANGS, STYLES } from '../../shared/settings.js';
import { PROVIDER_PRESETS } from '../../shared/presets.js';

export const FORM_CSS = `
.dl-settings { color-scheme:light dark; --bg:#f5f7fb; --panel:#fff; --fg:#182339; --muted:#58677d; --line:#d9e0ec; --accent:#365edd; color:var(--fg); background:var(--bg); font:14px/1.6 system-ui,sans-serif; padding:16px; max-width:960px; margin:auto; overflow-wrap:anywhere; }
.dl-settings * { box-sizing:border-box; min-width:0; }
.dl-settings section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px; margin:14px 0; }
.dl-settings h2 { font-size:18px; margin:0 0 12px; }
.dl-settings p { margin:8px 0; }
.dl-settings .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.dl-settings .wide { grid-column:1/-1; }
.dl-settings label { display:block; color:var(--muted); }
.dl-settings input,.dl-settings select,.dl-settings textarea,.dl-settings button { font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:8px; min-height:44px; max-width:100%; padding:9px; }
.dl-settings input,.dl-settings select,.dl-settings textarea { display:block; width:100%; margin-top:5px; }
.dl-settings textarea { min-height:90px; resize:vertical; }
.dl-settings input[type=checkbox] { display:inline-block; width:20px; min-height:20px; margin:0 8px 0 0; }
.dl-settings .check { display:flex; align-items:center; min-height:44px; }
.dl-settings .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
.dl-settings button { cursor:pointer; background:var(--panel); }
.dl-settings button:disabled { opacity:.6; cursor:wait; }
.dl-settings .primary { background:var(--accent); color:#fff; }
.dl-settings .hint { color:var(--muted); font-size:13px; }
.dl-settings a { color:var(--accent); }
.dl-settings .status { min-height:24px; }
.dl-settings .error { color:#ba2440; }
.dl-settings .savebar { position:sticky; bottom:0; background:var(--panel); padding:12px; display:flex; gap:12px; align-items:center; justify-content:space-between; border:1px solid var(--line); border-radius:12px; }
.dl-settings [hidden] { display:none!important; }
.dl-settings :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
@media(prefers-color-scheme:dark) { .dl-settings { --bg:#111821; --panel:#1a2432; --fg:#e7edf6; --muted:#a0afc4; --line:#34435a; --accent:#365edd; } .dl-settings a { color:#aac0ff; } .dl-settings .error { color:#ff94a3; } }
@media(max-width:599px) { .dl-settings { padding:8px; width:100%; } .dl-settings .grid { grid-template-columns:1fr; } .dl-settings section { padding:12px; } .dl-settings .savebar { padding:8px; } }
`;

export function drawLayout(root, { secretDialog = false } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, text, attrs = {}) => {
    const n = doc.createElement(tag); if (text) n.textContent = text;
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    return n;
  };
  const container = el('div', '', { class: 'dl-settings' });
  const style = el('style', FORM_CSS); container.append(style);
  const form = el('form', '', { id: 'settings-form' }); container.append(form);
  const section = title => {
    const box = el('section'); box.append(el('h2', title));
    const grid = el('div', '', { class: 'grid' }); box.append(grid); form.append(box); return { box, grid };
  };
  const field = (parent, id, title, type = 'text', choices = [], attrs = {}) => {
    const label = el('label', '', { class: ['textarea', 'url', 'password'].includes(type) ? 'wide' : type === 'checkbox' ? 'check' : '' });
    const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', '', { id, ...attrs });
    if (!['textarea', 'select'].includes(type)) input.type = type;
    if (type === 'checkbox') label.append(input, doc.createTextNode(title));
    else { label.append(doc.createTextNode(title), input); }
    for (const c of choices) input.append(el('option', c.name || c.label || c.id || c.code, { value: c.id ?? c.code }));
    parent.append(label); return input;
  };
  const button = (parent, id, title) => { const b = el('button', title, { id, type: 'button' }); parent.append(b); return b; };
  const pairs = values => values.map(([id, name]) => ({ id, name }));

  const wizard = el('section', '', { id: 'wizard' });
  wizard.append(el('h2', '首次使用向导'), el('p', '推荐 OpenRouter 免费模型，也可选择你自己的服务。'),
    el('p', '1 选预设 → 2 填 key → 3 获取模型 → 4 测试连接 → 5 保存'),
    el('p', '免费模型有每分钟和每日限额；自动备选不能绕过账号限额。未点击获取或测试前不会联网。', { class: 'hint' }));
  form.append(wizard);
  const sync = el('p', '', { id: 'sync-status', role: 'status' }); form.append(sync);
  const r = section('阅读');
  field(r.grid, 'targetLang', '目标语言', 'select', LANGS);
  field(r.grid, 'sourceLang', '源语言', 'select', [{ code: 'auto', name: '自动检测' }, ...LANGS]);
  field(r.grid, 'displayMode', '显示方式', 'select', pairs([['bilingual', '双语对照'], ['translation-only', '仅译文']]));
  field(r.grid, 'style', '译文样式', 'select', STYLES);
  for (const [id, title] of [['minChars', '最短段落字符数'], ['inlineMaxChars', '行内译文阈值'], ['rootMarginPx', '预加载距离（px）'], ['batchDelayMs', '合批等待（ms）']]) field(r.grid, id, title, 'number');

  const p = section('模型服务');
  field(p.grid, 'profile', '编辑 / 切换服务', 'select');
  field(p.grid, 'providerPreset', '新增服务预设', 'select', [{ id: '', name: '请选择（推荐 OpenRouter）' }, ...PROVIDER_PRESETS]);
  button(p.grid, 'add-profile', '添加所选服务');
  p.grid.append(el('p', '', { id: 'provider-description', class: 'hint wide' }), el('a', '服务商说明 / 获取 key', { id: 'key-link', class: 'wide', target: '_blank', rel: 'noopener noreferrer' }));
  field(p.grid, 'profileName', '服务名称');
  field(p.grid, 'baseUrl', '兼容 API 基础地址', 'url');
  if (secretDialog) {
    const row = el('div', '', { id: 'key-row', class: 'wide' });
    row.append(el('p', 'API key（仅存本机）'), el('p', '未设置', { id: 'key-status', role: 'status' }));
    const controls = el('div', '', { class: 'actions' }); row.append(controls);
    button(controls, 'set-key', '设置 key'); button(controls, 'clear-key', '清除 key');
    row.append(el('p', '在浏览器原生对话框中输入；修改后点击保存。', { class: 'hint' }));
    p.grid.append(row);
  } else {
    const key = field(p.grid, 'apiKey', 'API key（仅存本机）', 'password', [], { autocomplete: 'off', spellcheck: 'false' });
    key.parentElement.id = 'key-row';
  }
  field(p.grid, 'model', '模型标识', 'text', [], { list: 'models', autocomplete: 'off' });
  p.grid.append(el('datalist', '', { id: 'models' }));
  const actions = el('div', '', { class: 'actions wide' }); p.grid.append(actions);
  button(actions, 'load-models', '获取模型列表'); button(actions, 'test', '测试连接');
  field(p.grid, 'fallbackModels', '同服务备选模型（每行一个）', 'textarea');
  for (const [id, title] of [['maxItems', '每批段落上限'], ['maxChars', '每批字符上限'], ['concurrency', '并发数'], ['timeoutMs', '超时（ms）']]) field(p.grid, id, title, 'number');
  field(p.grid, 'jsonMode', '使用 JSON 响应模式', 'checkbox');
  field(p.grid, 'providerChain', '跨服务备选链（JSON：profileId + model，按顺序）', 'textarea');
  p.box.append(el('p', '选择 OpenRouter 免费模型后会建议 2–3 家厂商的备选链，可自行修改。网页正文只发送到这条链中的服务。订阅模型只能手动选择。', { class: 'hint' }));

  const i = section('交互');
  for (const [id, title] of [['hoverEnabled', '悬停 / 触屏长按翻译'], ['selectionEnabled', '划词翻译'], ['showIcon', '显示划词按钮'], ['inputEnabled', '输入框翻译'], ['prefixOverride', '允许 /ja 等语言前缀'], ['floatEnabled', '显示悬浮球']]) field(i.grid, id, title, 'checkbox');
  field(i.grid, 'hoverModifier', '悬停修饰键', 'select', pairs([['Shift', 'Shift'], ['Alt', 'Alt'], ['Control', 'Ctrl'], ['none', '停留 500ms']]));
  field(i.grid, 'inputLang', '输入框目标语言', 'select', LANGS);
  field(i.grid, 'inputTrigger', '输入触发', 'select', pairs([['triple-space', '三次空格或快捷键'], ['shortcut', '仅快捷键']]));
  field(i.grid, 'floatSide', '悬浮球侧边', 'select', pairs([['right', '右侧'], ['left', '左侧']]));
  const comics = section('漫画');
  field(comics.grid,'comicsEnabled','启用漫画本地 OCR','checkbox');
  field(comics.grid,'comicsLanguage','漫画源语言','select',pairs([['jpn','日文横排'],['jpn_vert','日文竖排'],['kor','韩文'],['eng','英文']]));
  field(comics.grid,'comicsSites','canvas 还原站点（域名或 *.example.com，每行一个）','textarea');
  comics.box.append(el('p','仅名单站点安装 canvas 来源钩子；增删后刷新网页生效。原图本地识别，仅 OCR 文字发给模型。',{class:'hint'}));
  comics.box.append(el('div','',{id:'comics-languages',role:'status'}));
  button(comics.box,'comics-refresh','查看已下载语言包');
  const pr = section('提示词与术语');
  field(pr.grid, 'preset', '翻译风格', 'select', pairs([['general', '通用'], ['tech', '技术'], ['academic', '学术'], ['news', '新闻'], ['social', '口语'], ['custom', '自定义']]));
  field(pr.grid, 'customPrompt', '自定义风格要求', 'textarea'); field(pr.grid, 'glossary', '术语表（每行 原词 → 译词）', 'textarea');
  const sites = section('站点规则');
  field(sites.grid, 'always', '总是翻译（域名，每行一个）', 'textarea'); field(sites.grid, 'never', '从不翻译（域名，每行一个）', 'textarea');
  field(sites.grid, 'autoLangs', '这些源语言自动翻译', 'select', LANGS, { multiple: '', size: '5' });
  field(sites.grid, 'customRules', '自定义选择器规则（JSON 数组）', 'textarea');
  const backup = section('本机缓存与配置备份');
  field(backup.grid, 'cacheEnabled', '缓存译文', 'checkbox');
  field(backup.grid, 'maxEntries', '缓存条数上限', 'number'); field(backup.grid, 'ttlDays', '缓存有效天数', 'number');
  backup.box.append(el('p', '', { id: 'cache-stats' })); button(backup.box, 'cache-clear', '清空译文缓存');
  if (secretDialog) backup.box.append(el('p', '导出或导入加密配置时，浏览器原生对话框会询问口令；导出口令留空则生成不含 key 的明文。', { class: 'hint' }));
  else field(backup.grid, 'backupPassword', '备份口令（留空则导出不含 key 的明文）', 'password', [], { autocomplete: 'new-password' });
  field(backup.grid, 'backupText', '配置文本（加密文件可在设备之间搬运）', 'textarea');
  const ba = el('div', '', { class: 'actions' }); backup.box.append(ba);
  button(ba, 'export', '导出配置'); button(ba, 'import-button', '导入配置文本');
  const file = el('input', '', { id: 'import-file', type: 'file', accept: '.json,.txt,application/json,text/plain', hidden: '' }); ba.append(file);
  button(ba, 'import-file-button', '选择配置文件');
  backup.box.append(el('p', '加密备份含所填 key，请妥善保管。口令不会保存。明文导入保留本机 key。译文缓存不会导出。', { class: 'hint' }));
  const bar = el('div', '', { class: 'savebar' });
  bar.append(el('div', '', { id: 'status', class: 'status', role: 'status', 'aria-live': 'polite' }));
  const save = button(bar, 'save', '保存设置'); save.type = 'submit'; save.className = 'primary'; form.append(bar);
  root.append(container);
  return container;
}

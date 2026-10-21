import { SHARED_CSS } from '../theme.js';
import { organizeLayout, SETTINGS_CSS } from './navigation.js';
import { LANGS, STYLES, TRANSLATION_MODES } from '../../shared/settings.js';
import { PROVIDER_PRESETS } from '../../shared/presets.js';
import { MT_ENGINES } from '../../background/mt.js';

// User-visible copy is centralized for the next localization pass.
const COPY=Object.freeze({
  s0:"首次使用向导",
  s1:"现在就能翻译：默认用机器翻译（Microsoft 免费接口，无需 密钥），译文秒出。",
  s2:"想要更好的译文？再添加一个大模型服务，它会在后台把机翻结果无感替换成精修译文。推荐 OpenRouter 免费模型，也可选择你自己的服务。",
  s3:"1 选预设 → 2 填 密钥 → 3 获取模型 → 4 测试连接 → 5 保存",
  s4:"免费模型有每分钟和每日限额；自动备选不能绕过账号限额。未点击获取或测试前不会联网。",
  s5:"阅读",
  s6:"目标语言",
  s7:"源语言",
  s8:"自动检测",
  s9:"显示方式",
  s10:"双语对照",
  s11:"仅译文",
  s12:"译文样式",
  s13:"最短段落字符数",
  s14:"行内译文阈值",
  s15:"预加载距离（px）",
  s16:"合批等待（ms）",
  s17:"翻译短文本（按钮、标签、导航项）",
  s18:"翻译方式",
  s19:"机器翻译引擎",
  s20:"失败时自动换另一家免费引擎",
  s21:"Microsoft Translator 区域（官方接口可选，例如 eastasia）",
  s22:"官方机器翻译 密钥（Microsoft Translator 或 DeepL；仅存本机）",
  s23:"未设置",
  s24:"设置 密钥",
  s25:"清除 密钥",
  s26:"测试机器翻译",
  s27:"机翻先显示，大模型随后原位精修；失败保留机翻。划词、悬停、输入框优先机翻，划词可「精修」。",
  s28:"免费 Microsoft/Google 为非官方接口，无可用性保证，会收到待译文字。可改用「只用大模型」或带 密钥 的官方引擎。",
  s29:"模型服务",
  s30:"编辑 / 切换服务",
  s31:"新增服务预设",
  s32:"请选择（推荐 OpenRouter）",
  s33:"添加所选服务",
  s34:"服务商说明 / 获取 密钥",
  s35:"服务名称",
  s36:"兼容 API 基础地址",
  s37:"API 密钥（仅存本机）",
  s38:"在浏览器原生对话框中输入；修改后点击保存。",
  s39:"模型标识",
  s40:"获取模型列表",
  s41:"测试连接",
  s42:"同服务备选模型（每行一个）",
  s43:"每批段落上限",
  s44:"每批字符上限",
  s45:"并发数",
  s46:"超时（ms）",
  s47:"使用 JSON 响应模式",
  s48:"跨服务备选链（JSON：profileId + model，按顺序）",
  s49:"选择 OpenRouter 免费模型后会建议 2–3 家厂商的备选链，可自行修改。网页正文只发送到这条链中的服务。",
  s50:"交互",
  s51:"悬停 / 触屏长按翻译",
  s52:"划词翻译",
  s53:"显示划词按钮",
  s54:"输入框翻译",
  s55:"允许 /ja 等语言前缀",
  s56:"显示悬浮球",
  s57:"悬停修饰键",
  s58:"停留 500ms",
  s59:"输入框目标语言",
  s60:"输入触发",
  s61:"三次空格或快捷键",
  s62:"仅快捷键",
  s63:"输入框写回",
  s64:"替换原文",
  s65:"双语（保留原文）",
  s66:"双语顺序",
  s67:"原文在前",
  s68:"译文在前",
  s69:"悬停 / 长按",
  s70:"输入框",
  s71:"服务",
  s72:"模型（留空使用服务默认模型）",
  s73:"继承网页翻译时沿用网页翻译方式与备选链；指定服务时使用其大模型，仅影响该交互。双语输入以换行分隔，单行输入框以空格分隔。",
  s74:"悬浮球侧边",
  s75:"右侧",
  s76:"左侧",
  s77:"漫画",
  s78:"启用漫画本地 OCR",
  s79:"漫画源语言",
  s80:"日文横排",
  s81:"日文竖排",
  s82:"韩文",
  s83:"英文",
  s84:"漫画站点（域名、*.example.com 或 JSON 对象，每行一个）",
  s85:"仅名单站点安装 canvas 来源钩子；增删后刷新网页生效。原图本地识别，仅 OCR 文字发给模型。",
  s86:"查看已下载语言包",
  s87:"提示词与术语",
  s88:"翻译风格",
  s89:"通用",
  s90:"技术",
  s91:"学术",
  s92:"新闻",
  s93:"口语",
  s94:"自定义",
  s95:"自定义风格要求",
  s96:"术语表（每行 原词 → 译词）",
  s97:"站点规则",
  s98:"自动翻译模式（每行一个）",
  s99:"从不自动翻译模式（每行一个）",
  s100:"这些源语言自动翻译",
  s101:"* 匹配任意路径字符，区分大小写；忽略查询串/片段。最具体规则优先。「从不」允许手动，但隐藏悬浮球；功能默认沿用全局。",
  s102:"新增 / 编辑路径模式",
  s103:"网页翻译",
  s104:"默认",
  s105:"自动",
  s106:"从不（允许手动）",
  s107:"划词",
  s108:"开",
  s109:"关",
  s110:"添加 / 更新此规则",
  s111:"规则列表（JSON，可修改或删除）",
  s112:"本机缓存与配置备份",
  s113:"缓存译文",
  s114:"缓存条数上限",
  s115:"缓存有效天数",
  s116:"清空译文缓存",
  s117:"导出或导入加密配置时，浏览器原生对话框会询问口令；加密导出口令至少 8 个字符；留空则生成不含 密钥 的明文。",
  s118:"备份口令（留空则导出不含 密钥 的明文）",
  s119:"配置文本（加密文件可在设备之间搬运）",
  s120:"导出配置",
  s121:"导入配置文本",
  s122:"导出到手机",
  s123:"复制配置文本",
  s124:"从电脑导入",
  s125:"加密配置二维码",
  s126:"选择配置文件",
  s127:"加密备份含所填 密钥，请妥善保管。口令不会保存。明文导入保留本机 密钥。译文缓存不会导出。",
  s128:"保存设置"
});

export const FORM_CSS = SHARED_CSS + SETTINGS_CSS;

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
    for (const c of choices) {const option=el('option', c.name || c.label || c.id || c.code, { value: c.id ?? c.code });option.hidden=c.id==='mock';input.append(option);}
    parent.append(label); return input;
  };
  const button = (parent, id, title) => { const b = el('button', title, { id, type: 'button' }); parent.append(b); return b; };
  const pairs = values => values.map(([id, name]) => ({ id, name }));

  const wizard = el('section', '', { id: 'wizard' });
  wizard.append(el('h2', COPY.s0), el('p', COPY.s1),
    el('p', COPY.s2),
    el('p', COPY.s3),
    el('p', COPY.s4, { class: 'hint' }));
  form.append(wizard);
  const sync = el('p', '', { id: 'sync-status', role: 'status' }); form.append(sync);
  const r = section(COPY.s5);
  field(r.grid, 'targetLang', COPY.s6, 'select', LANGS);
  field(r.grid, 'sourceLang', COPY.s7, 'select', [{ code: 'auto', name: COPY.s8 }, ...LANGS]);
  field(r.grid, 'displayMode', COPY.s9, 'select', pairs([['bilingual', COPY.s10], ['translation-only', COPY.s11]]));
  field(r.grid, 'style', COPY.s12, 'select', STYLES);
  for (const [id, title] of [['minChars', COPY.s13], ['inlineMaxChars', COPY.s14], ['rootMarginPx', COPY.s15], ['batchDelayMs', COPY.s16]]) field(r.grid, id, title, 'number');
  field(r.grid, 'translateShortText', COPY.s17, 'checkbox');

  const t = section(COPY.s18);
  field(t.grid, 'translationMode', COPY.s18, 'select', TRANSLATION_MODES);
  field(t.grid, 'mtEngine', COPY.s19, 'select', MT_ENGINES);
  field(t.grid, 'mtFallback', COPY.s20, 'checkbox');
  field(t.grid, 'mtRegion', COPY.s21);
  if (secretDialog) {
    const row = el('div', '', { id: 'mt-key-row', class: 'wide' });
    row.append(el('p', COPY.s22), el('p', COPY.s23, { id: 'mt-key-status', role: 'status' }));
    const controls = el('div', '', { class: 'actions' }); row.append(controls);
    button(controls, 'mt-set-key', COPY.s24); button(controls, 'mt-clear-key', COPY.s25);
    t.grid.append(row);
  } else {
    const key = field(t.grid, 'mtKey', COPY.s22, 'password', [], { autocomplete: 'off', spellcheck: 'false' });
    key.parentElement.id = 'mt-key-row';
  }
  const mtActions = el('div', '', { class: 'actions wide' }); t.grid.append(mtActions);
  button(mtActions, 'mt-test', COPY.s26);
  t.box.append(el('p', COPY.s27, { class: 'hint' }),
    el('p', COPY.s28, { class: 'hint' }));

  const p = section(COPY.s29);
  field(p.grid, 'profile', COPY.s30, 'select');
  field(p.grid, 'providerPreset', COPY.s31, 'select', [{ id: '', name: COPY.s32 }, ...PROVIDER_PRESETS]);
  button(p.grid, 'add-profile', COPY.s33);
  p.grid.append(el('p', '', { id: 'provider-description', class: 'hint wide' }), el('a', COPY.s34, { id: 'key-link', class: 'wide', target: '_blank', rel: 'noopener noreferrer' }));
  field(p.grid, 'profileName', COPY.s35);
  field(p.grid, 'baseUrl', COPY.s36, 'url');
  if (secretDialog) {
    const row = el('div', '', { id: 'key-row', class: 'wide' });
    row.append(el('p', COPY.s37, { id: 'credential-label' }), el('p', COPY.s23, { id: 'key-status', role: 'status' }));
    const controls = el('div', '', { class: 'actions' }); row.append(controls);
    button(controls, 'set-key', COPY.s24); button(controls, 'clear-key', COPY.s25);
    row.append(el('p', COPY.s38, { class: 'hint' }));
    p.grid.append(row);
  } else {
    const key = field(p.grid, 'apiKey', COPY.s37, 'password', [], { autocomplete: 'off', spellcheck: 'false' });
    key.parentElement.id = 'key-row';
    const title = el('span', COPY.s37, { id: 'credential-label' });
    key.parentElement.firstChild.replaceWith(title);
  }
  field(p.grid, 'model', COPY.s39, 'text', [], { list: 'models', autocomplete: 'off' });
  p.grid.append(el('datalist', '', { id: 'models' }));
  const actions = el('div', '', { class: 'actions wide' }); p.grid.append(actions);
  button(actions, 'load-models', COPY.s40); button(actions, 'test', COPY.s41);
  field(p.grid, 'fallbackModels', COPY.s42, 'textarea');
  for (const [id, title] of [['maxItems', COPY.s43], ['maxChars', COPY.s44], ['concurrency', COPY.s45], ['timeoutMs', COPY.s46]]) field(p.grid, id, title, 'number');
  field(p.grid, 'jsonMode', COPY.s47, 'checkbox');
  field(p.grid, 'providerChain', COPY.s48, 'textarea');
  p.box.append(el('p', COPY.s49, { class: 'hint' }));

  const i = section(COPY.s50);
  for (const [id, title] of [['hoverEnabled', COPY.s51], ['selectionEnabled', COPY.s52], ['showIcon', COPY.s53], ['inputEnabled', COPY.s54], ['prefixOverride', COPY.s55], ['floatEnabled', COPY.s56]]) field(i.grid, id, title, 'checkbox');
  field(i.grid, 'hoverModifier', COPY.s57, 'select', pairs([['Shift', 'Shift'], ['Alt', 'Alt'], ['Control', 'Ctrl'], ['none', COPY.s58]]));
  field(i.grid, 'inputLang', COPY.s59, 'select', LANGS);
  field(i.grid, 'inputTrigger', COPY.s60, 'select', pairs([['triple-space', COPY.s61], ['shortcut', COPY.s62]]));
  field(i.grid, 'inputMode', COPY.s63, 'select', pairs([['replace', COPY.s64], ['bilingual', COPY.s65]]));
  field(i.grid, 'inputOrder', COPY.s66, 'select', pairs([['source-first', COPY.s67], ['translation-first', COPY.s68]]));
  for (const [name, title] of [['hover', COPY.s69], ['input', COPY.s70]]) {
    field(i.grid, name + 'Profile', title + COPY.s71, 'select');
    field(i.grid, name + 'Model', title + COPY.s72, 'text', [], { maxlength: '256' });
  }
  i.box.append(el('p', COPY.s73, { class: 'hint' }));
  field(i.grid, 'floatSide', COPY.s74, 'select', pairs([['right', COPY.s75], ['left', COPY.s76]]));
  const comics = section(COPY.s77);
  field(comics.grid,'comicsEnabled',COPY.s78,'checkbox');
  field(comics.grid,'comicsLanguage',COPY.s79,'select',pairs([['jpn',COPY.s80],['jpn_vert',COPY.s81],['kor',COPY.s82],['eng',COPY.s83]]));
    field(comics.grid,'comicsSites',COPY.s84,'textarea');
  comics.box.append(el('p',COPY.s85,{class:'hint'}));
  comics.box.append(el('div','',{id:'comics-languages',role:'status'}));
  button(comics.box,'comics-refresh',COPY.s86);
  const pr = section(COPY.s87);
  field(pr.grid, 'preset', COPY.s88, 'select', pairs([['general', COPY.s89], ['tech', COPY.s90], ['academic', COPY.s91], ['news', COPY.s92], ['social', COPY.s93], ['custom', COPY.s94]]));
  field(pr.grid, 'customPrompt', COPY.s95, 'textarea'); field(pr.grid, 'glossary', COPY.s96, 'textarea');
  const sites = section(COPY.s97);
  field(sites.grid, 'always', COPY.s98, 'textarea'); field(sites.grid, 'never', COPY.s99, 'textarea');
  field(sites.grid, 'autoLangs', COPY.s100, 'select', LANGS, { multiple: '', size: '5' });
  sites.box.append(el('p', COPY.s101, { class: 'hint' }));
  field(sites.grid, 'rule-match', COPY.s102);
  field(sites.grid, 'rule-page', COPY.s103, 'select', pairs([['default',COPY.s104],['always',COPY.s105],['never',COPY.s106]]));
  for (const [id, title] of [['selection',COPY.s107],['hover',COPY.s69],['input',COPY.s70]]) field(sites.grid, 'rule-' + id, title, 'select', pairs([['default',COPY.s104],['on',COPY.s108],['off',COPY.s109]]));
  button(sites.box, 'site-rule-add', COPY.s110);
  field(sites.grid, 'customRules', COPY.s111, 'textarea');
  const backup = section(COPY.s112);
  field(backup.grid, 'cacheEnabled', COPY.s113, 'checkbox');
  field(backup.grid, 'maxEntries', COPY.s114, 'number'); field(backup.grid, 'ttlDays', COPY.s115, 'number');
  backup.box.append(el('p', '', { id: 'cache-stats' })); button(backup.box, 'cache-clear', COPY.s116);
  if (secretDialog) backup.box.append(el('p', COPY.s117, { class: 'hint' }));
  else field(backup.grid, 'backupPassword', COPY.s118, 'password', [], { autocomplete: 'new-password' });
  field(backup.grid, 'backupText', COPY.s119, 'textarea');
  const ba = el('div', '', { class: 'actions' }); backup.box.append(ba);
  button(ba, 'export', COPY.s120); button(ba, 'import-button', COPY.s121);
  button(ba, 'export-phone', COPY.s122); button(ba, 'copy-backup', COPY.s123);
  if (secretDialog) button(ba, 'import-computer', COPY.s124);
  backup.box.append(el('canvas', '', { id: 'backup-qr', hidden: '', 'aria-label': COPY.s125 }));
  const file = el('input', '', { id: 'import-file', type: 'file', accept: '.json,.txt,application/json,text/plain', hidden: '' }); ba.append(file);
  button(ba, 'import-file-button', COPY.s126);
  backup.box.append(el('p', COPY.s127, { class: 'hint' }));
  const bar = el('div', '', { class: 'savebar' });
  bar.append(el('div', '', { id: 'status', class: 'status', role: 'status', 'aria-live': 'polite' }));
  const save = button(bar, 'save', COPY.s128); save.type = 'submit'; save.className = 'primary'; form.append(bar);
  organizeLayout(container, form, {field, button});
  root.append(container);
  return container;
}

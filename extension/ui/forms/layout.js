import { message as l10n, uiLanguage, setText, setAttribute } from '../../shared/i18n.js';
import { SHARED_CSS } from '../theme.js';
import { organizeLayout, SETTINGS_CSS } from './navigation.js';
import { LANGS, STYLES, TRANSLATION_MODES } from '../../shared/settings.js';
import { PROVIDER_PRESETS } from '../../shared/presets.js';
import { MT_ENGINES } from '../../background/mt.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({
  s0:l10n('mdv'),
  s1:l10n('mdw'),
  s2:l10n('mdx'),
  s3:l10n('mdy'),
  s4:l10n('mdz'),
  s5:l10n('me0'),
  s6:l10n('ma8'),
  s7:l10n('ma7'),
  s8:l10n('m5e'),
  s9:l10n('me1'),
  s10:l10n('me2'),
  s11:l10n('m4f'),
  s12:l10n('me3'),
  s13:l10n('me4'),
  s14:l10n('me5'),
  s15:l10n('me6'),
  s16:l10n('me7'),
  s17:l10n('me8'),
  s18:l10n('me9'),
  s19:l10n('mea'),
  s20:l10n('meb'),
  s21:l10n('mec'),
  s22:l10n('med'),
  s23:l10n('mbs'),
  s24:l10n('mee'),
  s25:l10n('mef'),
  s26:l10n('meg'),
  s27:l10n('meh'),
  s28:l10n('mei'),
  s29:l10n('mej'),
  s30:l10n('mek'),
  s31:l10n('mel'),
  s32:l10n('mem'),
  s33:l10n('men'),
  s34:l10n('meo'),
  s35:l10n('mep'),
  s36:l10n('meq'),
  s37:l10n('mbv'),
  s38:l10n('mer'),
  s39:l10n('mes'),
  s40:l10n('met'),
  s41:l10n('meu'),
  s42:l10n('mev'),
  s43:l10n('mew'),
  s44:l10n('mex'),
  s45:l10n('mey'),
  s46:l10n('mez'),
  s47:l10n('mf0'),
  s48:l10n('mf1'),
  s49:l10n('mf2'),
  s50:l10n('mf3'),
  s51:l10n('mf4'),
  s52:l10n('maw'),
  s53:l10n('mf5'),
  s54:l10n('mb0'),
  s55:l10n('mf6'),
  s56:l10n('mf7'),
  s57:l10n('mf8'),
  s58:l10n('mf9'),
  s59:l10n('mfa'),
  s60:l10n('mfb'),
  s61:l10n('mfc'),
  s62:l10n('mfd'),
  s63:l10n('mfe'),
  s64:l10n('mff'),
  s65:l10n('mfg'),
  s66:l10n('mfh'),
  s67:l10n('mfi'),
  s68:l10n('mfj'),
  s69:l10n('mfk'),
  s70:l10n('mfl'),
  s71:l10n('ma9'),
  s72:l10n('mfm'),
  s73:l10n('mfn'),
  s74:l10n('mfo'),
  s75:l10n('mfp'),
  s76:l10n('mfq'),
  s77:l10n('mfr'),
  s78:l10n('mfs'),
  s79:l10n('mft'),
  s80:l10n('m2s'),
  s81:l10n('m2t'),
  s82:l10n('m2u'),
  s83:l10n('m2v'),
  s84:l10n('mfu'),
  s85:l10n('mfv'),
  s86:l10n('mfw'),
  s87:l10n('mfx'),
  s88:l10n('mfy'),
  s89:l10n('mfz'),
  s90:l10n('mg0'),
  s91:l10n('mg1'),
  s92:l10n('mg2'),
  s93:l10n('mg3'),
  s94:l10n('mg4'),
  s95:l10n('mg5'),
  s96:l10n('mg6'),
  s97:l10n('mg7'),
  s98:l10n('mg8'),
  s99:l10n('mg9'),
  s100:l10n('mga'),
  s101:l10n('mgb'),
  s102:l10n('mgc'),
  s103:l10n('mgd'),
  s104:l10n('mge'),
  s105:l10n('mgf'),
  s106:l10n('mgg'),
  s107:l10n('mgh'),
  s108:l10n('mgi'),
  s109:l10n('mgj'),
  s110:l10n('mgk'),
  s111:l10n('mgl'),
  s112:l10n('mgm'),
  s113:l10n('mgn'),
  s114:l10n('mgo'),
  s115:l10n('mgp'),
  s116:l10n('mgq'),
  s117:l10n('mgr'),
  s118:l10n('mgs'),
  s119:l10n('mgt'),
  s120:l10n('mgu'),
  s121:l10n('mgv'),
  s122:l10n('mgw'),
  s123:l10n('mgx'),
  s124:l10n('mgy'),
  s125:l10n('mgz'),
  s126:l10n('mh0'),
  s127:l10n('mh1'),
  s128:l10n('mh2')
});

export const FORM_CSS = SHARED_CSS + SETTINGS_CSS;

export function drawLayout(root, { secretDialog = false } = {}) {
  const doc = root.ownerDocument;
  const el = (tag, text, attrs = {}) => {
    const n = doc.createElement(tag); if (text) setText(n, text);
    for (const [key, value] of Object.entries(attrs)) setAttribute(n, key, value);
    return n;
  };
  const container = el('div', '', { class: 'dl-settings', lang:uiLanguage() });
  const style = el('style', FORM_CSS); container.append(style);
  const form = el('form', '', { id: 'settings-form' }); container.append(form);
  const section = title => {
    const box = el('section'); box.append(el('h2', title));
    const grid = el('div', '', { class: 'grid' }); box.append(grid); form.append(box); return { box, grid };
  };
  const field = (parent, id, title, type = 'text', choices = [], attrs = {}) => {
    const label = el('label', '', { class: ['textarea', 'url', 'password'].includes(type) ? 'field wide' : type === 'checkbox' ? 'field check' : 'field' });
    const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', '', { id, ...attrs });
    if (!['textarea', 'select'].includes(type)) input.type = type;
    const text = el('span', title, { class: 'field-label' });
    if (type === 'checkbox') label.append(input, text);
    else { label.append(text, input); }
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
  field(r.grid, 'uiLanguage', l10n('uiLanguageLabel'), 'select', pairs([['zh-CN',l10n('uiLanguageChinese')],['en',l10n('uiLanguageEnglish')],['auto',l10n('uiLanguageAuto')]]));
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
    const title = el('span', COPY.s37, { id: 'credential-label', class: 'field-label' });
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
    field(i.grid, name + 'Profile', l10n('polishFeatureService',[name==='hover'?l10n('polishHoverShort'):l10n('polishInputShort')]), 'select');
    field(i.grid, name + 'Model', l10n('polishFeatureModel',[name==='hover'?l10n('polishHoverShort'):l10n('polishInputShort')]), 'text', [], { maxlength: '256' });
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

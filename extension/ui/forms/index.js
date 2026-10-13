import { providerChain } from '../../shared/settings.js';
import { getPreset, profileFromPreset, recommendedFreeChain } from '../../shared/presets.js';
import { exportConfig, importConfig } from '../../shared/configcrypto.js';
import { createProviders, profileProblem } from '../../background/providers.js';
import { buildMessages, parseSegments } from '../../shared/prompt.js';
import { stripMarkup } from '../../shared/markup.js';
import { validateSettings, importSettings, lines, terms } from '../validation.js';
import { drawLayout } from './layout.js';

// Shared by options and the platform's page panel. No browser globals or implicit storage.
export async function mountSettingsForm(root, { store, platform }) {
  const container = drawLayout(root);
  const $ = id => container.querySelector('#' + id);
  let settings, profileId = '', dirty = false, saving = false, destroyed = false, drawToken = 0, drawingProfile = false;
  const discovered = new Map();
  const draftSecrets = new Map();
  const modifiedSecrets = new Set();
  const listeners = [];
  const service = () => platform.translator?.();
  const providers = platform.http && createProviders({
    fetchImpl: async (url, init) => {
      const res = await platform.http({ url, ...init });
      return { status: res.status, headers: res.headers, text: async () => typeof res.text === 'function' ? res.text() : res.text };
    },
    getSecret: async id => modifiedSecrets.has(id) ? draftSecrets.get(id) : store.getSecret(id),
  });
  const simple = ['targetLang', 'sourceLang', 'displayMode', 'style', 'minChars', 'inlineMaxChars'];
  const nums = new Set(['minChars', 'inlineMaxChars', 'rootMarginPx', 'batchDelayMs', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs', 'maxEntries', 'ttlDays']);
  const bind = {
    rootMarginPx: 'lazy.rootMarginPx', batchDelayMs: 'lazy.batchDelayMs', hoverEnabled: 'hover.enabled', hoverModifier: 'hover.modifier',
    selectionEnabled: 'selection.enabled', showIcon: 'selection.showIcon', inputEnabled: 'input.enabled', inputLang: 'input.targetLang',
    inputTrigger: 'input.trigger', prefixOverride: 'input.prefixOverride', floatEnabled: 'floatBall.enabled', floatSide: 'floatBall.side',
    preset: 'prompt.preset', customPrompt: 'prompt.custom', cacheEnabled: 'cache.enabled', maxEntries: 'cache.maxEntries', ttlDays: 'cache.ttlDays',
  };
  const notice = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const fill = (id, value) => { if ($(id).type === 'checkbox') $(id).checked = !!value; else $(id).value = value ?? ''; };
  const read = id => $(id).type === 'checkbox' ? $(id).checked : nums.has(id) ? Number($(id).value) : $(id).value;
  const profile = () => settings.provider.profiles.find(p => p.id === profileId);
  function choices(select, values, selected) {
    select.replaceChildren();
    for (const value of values) {
      const o = root.ownerDocument.createElement('option'); o.value = value.id; o.textContent = value.name || value.label || value.id;
      select.append(o);
    }
    if (selected !== undefined) select.value = selected;
  }
  const on = (id, event, fn) => { $(id).addEventListener(event, fn); listeners.push(() => $(id).removeEventListener(event, fn)); };
  function action(id, fn) {
    on(id, 'click', async () => {
      $(id).disabled = true;
      try { await fn(); } catch (e) { notice(e.message || '操作失败', true); }
      finally { if (!destroyed) $(id).disabled = false; }
    });
  }
  function showSync() {
    $('sync-status').textContent = store.syncStatus?.synced ? '设置已同步；API key 仅存此设备。' : '此设备未同步；配置与 API key 保存在本机。';
  }
  async function showWizard() {
    const chain = providerChain(settings);
    const usable = await Promise.all(chain.map(async c => {
      const apiKey = c.profile.kind === 'openai' ? await store.getSecret(c.profile.id) : '';
      return !profileProblem({ ...c.profile, model: c.model, apiKey }) && (!c.profile.requiresKey || !!apiKey);
    }));
    if (!destroyed) $('wizard').hidden = usable.some(Boolean);
  }
  async function drawProfile() {
    const token = ++drawToken, p = profile();
    drawingProfile = true;
    const ids = ['profileName', 'baseUrl', 'apiKey', 'model', 'fallbackModels', 'jsonMode', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs'];
    for (const id of ids) $(id).disabled = !p;
    $('load-models').disabled = !p; $('test').disabled = !p;
    if (!p) { ids.forEach(id => fill(id, '')); drawingProfile = false; return; }
    for (const id of ['model', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs']) fill(id, p[id]);
    fill('profileName', p.name); fill('baseUrl', p.baseUrl); fill('jsonMode', p.jsonMode ?? false);
    fill('fallbackModels', (p.fallbackModels || []).join('\n'));
    fill('apiKey', '');
    $('apiKey').disabled = true;
    $('key-row').hidden = p.kind !== 'openai'; $('baseUrl').disabled = p.kind === 'mock'; $('jsonMode').disabled = p.kind === 'mock';
    const preset = getPreset(p.preset);
    $('provider-description').textContent = preset?.description || '使用自己的模型服务；不会自动联网。';
    $('key-link').hidden = !preset?.keyUrl;
    if (preset?.keyUrl) $('key-link').href = preset.keyUrl;
    const secret = modifiedSecrets.has(p.id) ? draftSecrets.get(p.id) : await store.getSecret(p.id);
    if (destroyed || token !== drawToken) return;
    fill('apiKey', secret); draftSecrets.set(p.id, secret);
    $('apiKey').disabled = p.kind !== 'openai'; drawingProfile = false;
  }
  function captureProfile() {
    const p = profile(); if (!p || drawingProfile) return;
    p.name = read('profileName').trim(); p.model = read('model').trim();
    for (const id of ['maxItems', 'maxChars', 'concurrency', 'timeoutMs']) p[id] = read(id);
    if (p.kind !== 'mock') { p.baseUrl = read('baseUrl').trim(); p.jsonMode = read('jsonMode'); }
    if (p.kind === 'openai') draftSecrets.set(p.id, read('apiKey').trim());
    p.fallbackModels = /^(claude|codex)\//.test(p.model) ? [] : lines(read('fallbackModels'));
  }
  function setSelectedChain() {
    const p = profile();
    const chain = p ? [p.model, ...(p.fallbackModels || [])].filter(Boolean).map(model => ({ profileId: p.id, model })) : [];
    fill('providerChain', JSON.stringify(chain, null, 2));
  }
  async function draw() {
    for (const id of simple) fill(id, settings[id]);
    for (const [id, path] of Object.entries(bind)) fill(id, path.split('.').reduce((v, k) => v[k], settings));
    fill('glossary', settings.glossary.map(t => `${t.src} → ${t.dst}`).join('\n'));
    fill('always', settings.siteRules.always.join('\n')); fill('never', settings.siteRules.never.join('\n'));
    fill('customRules', JSON.stringify(settings.siteRules.custom, null, 2));
    for (const o of $('autoLangs').options) o.selected = settings.autoTranslateLangs.includes(o.value);
    profileId = settings.provider.active;
    choices($('profile'), [{ id: '', name: '选择一个服务' }, ...settings.provider.profiles], profileId);
    fill('providerChain', JSON.stringify(settings.provider.chain, null, 2));
    await drawProfile(); showSync(); await showWizard();
  }
  function collect() {
    captureProfile();
    const next = structuredClone(settings);
    for (const id of simple) next[id] = read(id);
    for (const [id, path] of Object.entries(bind)) {
      const parts = path.split('.'); next[parts[0]][parts[1]] = read(id);
    }
    next.provider.active = profileId;
    next.provider.chain = JSON.parse(read('providerChain') || '[]');
    if (/^(claude|codex)\//.test(profile()?.model || '')) next.provider.chain = [{ profileId, model: profile().model }];
    next.glossary = terms(read('glossary'));
    next.siteRules.always = lines(read('always')).map(s => s.toLowerCase());
    next.siteRules.never = lines(read('never')).map(s => s.toLowerCase());
    next.autoTranslateLangs = [...$('autoLangs').selectedOptions].map(o => o.value);
    next.siteRules.custom = JSON.parse(read('customRules') || '[]');
    if (Array.isArray(next.siteRules.custom)) for (const r of next.siteRules.custom) for (const field of ['include', 'exclude']) {
      for (const selector of Array.isArray(r[field]) ? r[field] : r[field] ? [r[field]] : []) root.ownerDocument.createDocumentFragment().querySelector(selector);
    }
    return validateSettings(next);
  }
  async function save() {
    if (drawingProfile) throw new Error('正在读取本机密钥，请稍后保存');
    const next = collect(); saving = true;
    try {
      settings = await store.save(next);
      for (const id of modifiedSecrets) await store.setSecret(id, draftSecrets.get(id));
      modifiedSecrets.clear();
      dirty = false; showSync(); await showWizard(); notice('设置已保存');
    } finally { saving = false; }
    return settings;
  }
  on('settings-form', 'input', event => {
    dirty = true;
    if (event.target === $('apiKey') && profileId) modifiedSecrets.add(profileId);
  });
  on('settings-form', 'submit', async e => {
    e.preventDefault(); $('save').disabled = true;
    try { await save(); } catch (error) { notice(error.message, true); }
    finally { if (!destroyed) $('save').disabled = false; }
  });
  on('profile', 'change', async () => {
    captureProfile(); profileId = read('profile'); settings.provider.active = profileId; dirty = true;
    await drawProfile(); setSelectedChain();
  });
  on('model', 'change', () => {
    captureProfile(); const p = profile(), models = discovered.get(profileId);
    if (p?.preset === 'openrouter' && models?.some(m => m.id === p.model)) {
      const primary = models.find(m => m.id === p.model);
      const ordered = [primary, ...models.filter(m => m.id !== primary.id)];
      fill('providerChain', JSON.stringify(recommendedFreeChain(ordered, profileId), null, 2));
      p.jsonMode = primary.jsonMode; fill('jsonMode', p.jsonMode);
    } else setSelectedChain();
  });
  on('fallbackModels', 'change', () => { captureProfile(); setSelectedChain(); });
  action('add-profile', async () => {
    const preset = read('providerPreset'); if (!preset) throw new Error('先选择一个服务预设');
    captureProfile();
    let id = preset, count = 2; while (settings.provider.profiles.some(p => p.id === id)) id = preset + '-' + count++;
    const p = profileFromPreset(preset, id); settings.provider.profiles.push(p); settings.provider.active = id; profileId = id; dirty = true;
    choices($('profile'), [{ id: '', name: '选择一个服务' }, ...settings.provider.profiles], id);
    await drawProfile(); setSelectedChain(); notice('填写 key，获取模型并测试；最后保存。');
  });
  action('load-models', async () => {
    captureProfile(); const p = profile(); notice('正在获取模型列表…');
    let models;
    if (providers) models = await providers.listModels(p);
    else {
      if (dirty) throw new Error('此平台需提供 http 才能在保存前获取模型');
      const r = await service().listModels(profileId); if (!r.ok) throw new Error(r.error?.message || '获取失败'); models = r.models;
    }
    choices($('models'), models || []);
    discovered.set(p.id, models || []);
    if (p.preset === 'openrouter' && models?.length && !p.model) {
      const chain = recommendedFreeChain(models, p.id); p.model = chain[0].model;
      p.jsonMode = !!models.find(m => m.id === p.model)?.jsonMode;
      fill('model', p.model); fill('jsonMode', p.jsonMode); fill('providerChain', JSON.stringify(chain, null, 2));
    }
    notice(`获取到 ${models?.length || 0} 个模型，选择后测试连接并保存。`);
  });
  action('test', async () => {
    captureProfile(); const p = profile(); notice('正在翻译测试文本…');
    if (providers) {
      const { messages, idMap } = buildMessages({ items: [{ id: 1, text: 'Hello, world.' }], to: 'zh-CN', from: 'en', context: {}, preset: 'general', custom: '', glossary: [] });
      const start = Date.now(); const content = await providers.chat({ profile: p, model: p.model, messages });
      const sample = parseSegments(content, idMap).results.get(1);
      if (!sample) throw new Error('接口没有返回有效的翻译 JSON');
      notice(`连接正常 · ${Date.now() - start} ms · ${stripMarkup(sample).slice(0, 200)}`);
    } else {
      if (dirty) throw new Error('此平台需提供 http 才能在保存前测试');
      const r = await service().testProvider(profileId); if (!r.ok) throw new Error(r.error?.message || '测试失败');
      notice(`连接正常 · ${r.latencyMs} ms · ${r.sample || ''}`);
    }
  });
  action('export', async () => {
    await save(); const secrets = {};
    if (read('backupPassword')) for (const p of settings.provider.profiles) {
      const apiKey = await store.getSecret(p.id); if (apiKey) secrets[p.id] = { apiKey };
    }
    const text = await exportConfig(settings, { password: read('backupPassword'), secrets });
    fill('backupText', text);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = root.ownerDocument.createElement('a'); a.href = url; a.download = read('backupPassword') ? 'duallens-config.encrypted.txt' : 'duallens-config.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    fill('backupPassword', ''); notice('已导出；明文配置不含 key，加密配置包含 key。');
  });
  async function importText(text) {
    const parsed = await importConfig(text, read('backupPassword'));
    const next = importSettings(parsed.settings, await store.load()); // validate everything before writes
    saving = true;
    try {
      settings = await store.save(next);
      for (const [id, secret] of Object.entries(parsed.secrets || {})) if (next.provider.profiles.some(p => p.id === id)) await store.setSecret(id, secret.apiKey);
      draftSecrets.clear(); modifiedSecrets.clear(); dirty = false; fill('backupPassword', ''); fill('backupText', ''); await draw(); notice('设置已导入');
    } finally { saving = false; }
  }
  action('import-button', () => importText(read('backupText')));
  action('import-file-button', async () => $('import-file').click());
  on('import-file', 'change', async () => {
    try {
      const file = $('import-file').files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('配置文件过大');
      await importText(await file.text());
    } catch (e) { notice(e.message, true); }
    finally { $('import-file').value = ''; }
  });
  action('cache-clear', async () => {
    if (!platform.clearCache) throw new Error('此平台未提供清理缓存操作');
    await platform.clearCache(); $('cache-stats').textContent = '译文缓存已清空'; notice('译文缓存已清空');
  });
  settings = await store.load(); await draw(); notice('修改后点击保存；获取模型与测试连接由你手动发起。');
  const off = store.onChange?.(async () => {
    if (saving || destroyed) return;
    if (dirty) { showSync(); return; }
    try { settings = await store.load(); if (!destroyed) await draw(); } catch { notice('读取更新后的配置失败', true); }
  });
  return {
    refresh: async () => { settings = await store.load(); draftSecrets.clear(); modifiedSecrets.clear(); dirty = false; await draw(); },
    destroy() { destroyed = true; drawToken++; off?.(); listeners.forEach(fn => fn()); container.remove(); draftSecrets.clear(); modifiedSecrets.clear(); },
  };
}

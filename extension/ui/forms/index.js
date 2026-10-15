import { providerChain } from '../../shared/settings.js';
import { getPreset, profileFromPreset, recommendedFreeChain } from '../../shared/presets.js';
import { exportConfig, importConfig } from '../../shared/configcrypto.js';
import { createProviders, profileProblem } from '../../background/providers.js';
import { buildMessages, parseSegments } from '../../shared/prompt.js';
import { stripMarkup } from '../../shared/markup.js';
import { validateSettings, importSettings, lines, terms } from './validation.js';
import { drawLayout } from './layout.js';
import { parsePairing, gatewayProfile, gatewayChain, discoverGateway, compactConfig } from './gateway.js';

// Shared by options and the platform's page panel. No browser globals or implicit storage.
export async function mountSettingsForm(root, { store, platform }) {
  // Extension settings have their own origin and retain the ordinary password field.
  const secretDialog = platform.kind !== 'extension';
  const container = drawLayout(root, { secretDialog });
  const $ = id => container.querySelector('#' + id);
  $('save').disabled=true;
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
    comicsEnabled:'comics.enabled',comicsLanguage:'comics.language',
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
      const apiKey = ['openai', 'gateway'].includes(c.profile.kind) ? await store.getSecret(c.profile.id) : '';
      return !profileProblem({ ...c.profile, model: c.model, apiKey }) && (!c.profile.requiresKey || !!apiKey);
    }));
    if (!destroyed) $('wizard').hidden = usable.some(Boolean);
  }
  async function drawProfile() {
    const token = ++drawToken, p = profile();
    drawingProfile = true;
    const ids = ['profileName', 'baseUrl', ...(secretDialog ? ['set-key', 'clear-key'] : ['apiKey']), 'model', 'fallbackModels', 'jsonMode', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs'];
    for (const id of ids) $(id).disabled = !p;
    $('load-models').disabled = !p; $('test').disabled = !p;
    if (!p) { ids.filter(id => !['set-key', 'clear-key'].includes(id)).forEach(id => fill(id, '')); $('key-row').hidden = true; drawingProfile = false; return; }
    for (const id of ['model', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs']) fill(id, p[id]);
    fill('profileName', p.name); fill('baseUrl', p.baseUrl); fill('jsonMode', p.jsonMode ?? false);
    fill('fallbackModels', (p.fallbackModels || []).join('\n'));
    if (!secretDialog) { fill('apiKey', ''); $('apiKey').disabled = true; }
    else { $('set-key').disabled = $('clear-key').disabled = true; $('key-status').textContent = '未设置'; }
    $('key-row').hidden = p.kind === 'mock'; $('baseUrl').disabled = p.kind === 'mock'; $('jsonMode').disabled = p.kind === 'mock';
    $('credential-label').textContent = p.kind === 'gateway' ? '配对令牌（可选；仅存本机）' : 'API key（仅存本机）';
    const preset = getPreset(p.preset);
    $('provider-description').textContent = preset?.description || '使用自己的模型服务；不会自动联网。';
    $('key-link').hidden = !preset?.keyUrl;
    if (preset?.keyUrl) $('key-link').href = preset.keyUrl;
    const secret = modifiedSecrets.has(p.id) ? draftSecrets.get(p.id) : await store.getSecret(p.id);
    if (destroyed || token !== drawToken) return;
    draftSecrets.set(p.id, secret);
    if (secretDialog) {
      $('key-status').textContent = secret ? '已设置' : '未设置';
      $('set-key').disabled = $('clear-key').disabled = p.kind === 'mock';
    } else { fill('apiKey', secret); $('apiKey').disabled = p.kind === 'mock'; }
    drawingProfile = false;
  }
  function captureProfile() {
    const p = profile(); if (!p || drawingProfile) return;
    p.name = read('profileName').trim(); p.model = read('model').trim();
    for (const id of ['maxItems', 'maxChars', 'concurrency', 'timeoutMs']) p[id] = read(id);
    if (p.kind !== 'mock') { p.baseUrl = read('baseUrl').trim(); p.jsonMode = read('jsonMode'); }
    if (p.kind !== 'mock' && !secretDialog) draftSecrets.set(p.id, read('apiKey').trim());
    p.fallbackModels = /^(claude|codex)\//.test(p.model) ? [] : lines(read('fallbackModels'));
  }
  function setSelectedChain() {
    const p = profile();
    const chain = p ? [p.model, ...(p.fallbackModels || [])].filter(Boolean).map(model => ({ profileId: p.id, model })) : [];
    fill('providerChain', JSON.stringify(chain, null, 2));
  }
  async function draw() {
    fill('comicsSites',settings.comics.canvasSites.map(site=>typeof site==='string'?site:JSON.stringify(site)).join('\n'));
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
    if(platform.comics) await showLanguages();
  }
  function collect() {
    captureProfile();
    const next = structuredClone(settings);
    next.comics.canvasSites=lines(read('comicsSites')).map(site=>site.startsWith('{')?JSON.parse(site):site);
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
    const next = collect();
    for (const p of next.provider.profiles) if (p.kind === 'gateway' && modifiedSecrets.has(p.id)) {
      const key = draftSecrets.get(p.id);
      if (key && !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('配对令牌格式无效；请导入完整配对串');
    }
    saving = true;
    try {
      settings = await store.save(next);
      const registration=await platform.comics?.syncSites?.();
      if(registration && !registration.ok) throw new Error(registration.error?.message || '漫画站点钩子注册失败');
      for (const id of modifiedSecrets) await store.setSecret(id, draftSecrets.get(id));
      modifiedSecrets.clear();
      dirty = false; showSync(); await showWizard(); notice('设置已保存');
    } finally { saving = false; }
    return settings;
  }
  on('settings-form', 'input', event => {
    dirty = true;
    if (event.target === $('backupText')) $('backup-qr').hidden = true;
    if (event.target === $('apiKey') && profileId) modifiedSecrets.add(profileId);
  });
  async function showLanguages() {
    const output=$('comics-languages');output.replaceChildren();
    const result=await platform.comics?.languages();
    if(!result?.ok) {output.textContent=result?.error?.message || '此平台不能查看语言包';return;}
    if(!result.languages.length) output.textContent='尚未下载语言包';
    for(const pack of result.languages) {
      const row=root.ownerDocument.createElement('p');row.textContent=`${pack.lang} · ${(pack.bytes/1048576).toFixed(2)} MiB `;
      const button=root.ownerDocument.createElement('button');button.type='button';button.textContent='删除';
      button.addEventListener('click',async()=> {
        button.disabled=true;
        try {const deleted=await platform.comics.languages(pack.lang);if(!deleted.ok)throw new Error('语言包删除失败');row.remove();}
        catch(error){notice(error.message,true);button.disabled=false;}
      });
      row.append(button);output.append(row);
    }
  }
  action('comics-refresh',showLanguages);
  if (secretDialog) {
    action('set-key', async () => {
      const id = profileId;
      if (!id || drawingProfile) return;
      const key = await platform.promptSecret(profile()?.kind === 'gateway' ? '输入网关配对令牌（留空清除；取消保留原值）' : '输入此服务的 API key（留空清除；取消保留原值）');
      if (key === null || destroyed || profileId !== id) return;
      if (typeof key !== 'string' || /[^\x20-\x7e]/.test(key.trim())) throw new Error('API key 含有非法字符');
      draftSecrets.set(id, key.trim()); modifiedSecrets.add(id); dirty = true;
      $('key-status').textContent = key.trim() ? '已设置' : '未设置';
      notice('密钥修改尚未保存；点击保存设置。');
    });
    action('clear-key', async () => {
      if (!profileId || drawingProfile) return;
      draftSecrets.set(profileId, ''); modifiedSecrets.add(profileId); dirty = true;
      $('key-status').textContent = '未设置'; notice('密钥清除尚未保存；点击保存设置。');
    });
  }
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
  function upsert(p) {
    const index = settings.provider.profiles.findIndex(old => old.id === p.id);
    if (index < 0) settings.provider.profiles.push(p); else settings.provider.profiles[index] = p;
  }
  async function selectGateway(id, chain) {
    profileId = id; settings.provider.active = id; settings.provider.chain = chain; dirty = true;
    choices($('profile'), [{ id: '', name: '选择一个服务' }, ...settings.provider.profiles], id);
    fill('providerChain', JSON.stringify(chain, null, 2)); await drawProfile();
  }
  action('connect-gateway', async () => {
    if (!platform.http) throw new Error('此平台未提供网关探测');
    captureProfile();
    const models = await discoverGateway(platform.http);
    if (destroyed) return;
    const p = gatewayProfile('gateway-local', '本机网关', 'http://127.0.0.1:18790/v1');
    const chain = gatewayChain(models, p.id);
    p.model = chain[0]?.model || ''; p.fallbackModels = chain.slice(1).map(c => c.model);
    upsert(p); discovered.set(p.id, models); choices($('models'), models);
    await selectGateway(p.id, chain);
    notice(chain.length ? (chain[0].model === 'auto' ? '已选用网关 auto；点击保存。' : '已建立网关备选链；点击保存。') : '没有可用模型；请检查网关配置。');
  });
  action('import-pairing', async () => {
    const text = secretDialog ? await platform.promptSecret('粘贴完整网关配对串（视同密钥；取消停止导入）') : read('pairingText');
    if (!secretDialog) fill('pairingText', '');
    if (text === null || destroyed) return;
    const paired = parsePairing(text.trim()); captureProfile();
    const profiles = [gatewayProfile('gateway-usb', '电脑网关（USB）', paired.usb)];
    if (paired.tailscale) profiles.unshift(gatewayProfile('gateway-tailscale', '电脑网关（Tailscale）', paired.tailscale));
    for (const p of profiles) { upsert(p); draftSecrets.set(p.id, paired.token); modifiedSecrets.add(p.id); }
    await selectGateway(profiles[0].id, [{ profileId: profiles[0].id, model: profiles[0].model }]);
    notice('已导入网关地址与令牌草稿；点击保存。没有 Tailscale 地址时只建立 USB 服务。');
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
    const password = secretDialog ? await platform.promptSecret('配置导出口令（留空导出不含 key 的明文；取消停止导出）') : read('backupPassword');
    if (password === null || destroyed) { if (!destroyed) notice('已取消导出'); return; }
    await save(); const secrets = {};
    if (password) for (const p of settings.provider.profiles) {
      const apiKey = await store.getSecret(p.id); if (apiKey) secrets[p.id] = { apiKey };
    }
    const text = await exportConfig(settings, { password, secrets });
    $('backup-qr').hidden = true;
    fill('backupText', text);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = root.ownerDocument.createElement('a'); a.href = url; a.download = password ? 'duallens-config.encrypted.txt' : 'duallens-config.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!secretDialog) fill('backupPassword', ''); notice('已导出；明文配置不含 key，加密配置包含 key。');
  });
  action('export-phone', async () => {
    const password = secretDialog ? await platform.promptSecret('设置手机配置导出口令（不能为空；取消停止）') : read('backupPassword');
    if (password === null || destroyed) return;
    if (!password) throw new Error('导出到手机必须设置加密口令');
    await save(); const secrets = {};
    for (const p of settings.provider.profiles) { const apiKey = await store.getSecret(p.id); if (apiKey) secrets[p.id] = { apiKey }; }
    const text = await exportConfig(compactConfig(settings), { password, secrets });
    if (destroyed) return;
    fill('backupText', text); $('backup-qr').hidden = true;
    if (!secretDialog) fill('backupPassword', '');
    if (typeof platform.renderQr !== 'function') {
      notice('加密配置已生成；请复制文本并在另一设备导入。口令通过其他安全方式传递。');
      return;
    }
    try { await platform.renderQr($('backup-qr'), text); if (destroyed) return; $('backup-qr').hidden = false; notice('加密配置已生成；手机扫码或复制文本，然后从电脑导入。口令通过其他安全方式传递。'); }
    catch (error) { notice(error.message); }
  });
  action('copy-backup', async () => {
    const text = read('backupText'); if (!text) throw new Error('先生成配置文本');
    const clipboard = root.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard) { $('backupText').select(); notice('已选中配置文本，请用系统复制。'); return; }
    try { await clipboard.writeText(text); notice('配置文本已复制'); }
    catch { $('backupText').select(); notice('浏览器未允许复制；文本已选中，请用系统复制。'); }
  });
  async function importText(text) {
    const password = secretDialog ? (text.startsWith('duallens-config:v1:') ? await platform.promptSecret('输入配置导入口令（取消停止导入）') : '') : read('backupPassword');
    if (password === null || destroyed) { if (!destroyed) notice('已取消导入'); return; }
    const parsed = await importConfig(text, password);
    const next = importSettings(parsed.settings, await store.load()); // validate everything before writes
    saving = true;
    try {
      settings = await store.save(next);
      for (const [id, secret] of Object.entries(parsed.secrets || {})) if (next.provider.profiles.some(p => p.id === id)) await store.setSecret(id, secret.apiKey);
      draftSecrets.clear(); modifiedSecrets.clear(); dirty = false; if (!secretDialog) fill('backupPassword', ''); fill('backupText', ''); $('backup-qr').hidden = true; await draw(); notice('设置已导入');
    } finally { saving = false; }
  }
  action('import-button', () => importText(read('backupText')));
  if (secretDialog) action('import-computer', () => {
    const text = read('backupText').trim();
    if (!text.startsWith('duallens-config:v1:')) throw new Error('请粘贴电脑生成的加密配置串');
    return importText(text);
  });
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
  settings = await store.load(); await draw(); notice('修改后点击保存；获取模型与测试连接由你手动发起。');$('save').disabled=false;
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

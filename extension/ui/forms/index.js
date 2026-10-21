import { providerChain } from '../../shared/settings.js';
import { getPreset, profileFromPreset, recommendedFreeChain } from '../../shared/presets.js';
import { exportConfig, importConfig } from '../../shared/configcrypto.js';
import { createProviders, profileProblem } from '../../background/providers.js';
import { createMT, MT_ENGINES, MT_SECRET_IDS } from '../../background/mt.js';
import { buildMessages, parseSegments } from '../../shared/prompt.js';
import { stripMarkup } from '../../shared/markup.js';
import { validateSettings, importSettings, lines, terms } from './validation.js';
import { drawLayout } from './layout.js';
import { mountSiteRules } from './site-rules.js';
import { compactConfig } from '../../shared/configcrypto.js';

// Shared by options and the platform's page panel. No browser globals or implicit storage.
export async function mountSettingsForm(root, { store, platform }) {
  // Extension settings have their own origin and retain the ordinary password field.
  const dialog = platform.kind !== 'extension';
  const ui = drawLayout(root, { secretDialog:dialog });
  mountSiteRules(ui);
  const $ = id => ui.querySelector('#' + id);
  $('save').disabled=true;
  let s, pid = '', dirty = false, saving = false, closed = false, drawToken = 0, loadingKey = false;
  const discovered = new Map();
  const drafts = new Map();
  const edited = new Set();
  const unbind = [];
  const service = () => platform.translator?.();
  const providers = platform.http && createProviders({
    fetchImpl: async (url, init) => {
      const res = await platform.http({ url, ...init });
      return { status: res.status, headers: res.headers, text: async () => typeof res.text === 'function' ? res.text() : res.text };
    },
    getSecret: async id => edited.has(id) ? drafts.get(id) : store.getSecret(id),
  });
  const mtFetch = async (url, init) => {
    const res = await platform.http({ url, ...init });
    return { status: res.status, headers: res.headers, text: async () => typeof res.text === 'function' ? res.text() : res.text };
  };
  // Machine-translation probe: unsaved key drafts are honoured, exactly like the model test.
  const mtProbe = platform.http && createMT({ fetchImpl: mtFetch,
    getSecret: async id => edited.has(id) ? drafts.get(id) : store.getSecret(id) });
  const mtSecretId = () => MT_ENGINES.find(e => e.id === $('mtEngine').value)?.secretId;
  let mtKeyToken = 0;
  async function drawMtKey() {
    const id = mtSecretId(), token = ++mtKeyToken;
    $('mt-key-row').hidden = !id;
    $('mtRegion').parentElement.hidden = $('mtEngine').value !== 'microsoft-api';
    if (!id) return;
    const secret = edited.has(id) ? drafts.get(id) : await store.getSecret(id);
    if (closed || token !== mtKeyToken) return;
    drafts.set(id, secret);
    if (dialog) $('mt-key-status').textContent = secret ? '已设置' : '未设置'; else $('mtKey').value = secret;
  }
  const simple = ['targetLang', 'sourceLang', 'displayMode', 'style', 'minChars', 'inlineMaxChars', 'translateShortText'];
  const nums = new Set(['minChars', 'inlineMaxChars', 'rootMarginPx', 'batchDelayMs', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs', 'maxEntries', 'ttlDays']);
  const bind = {
    rootMarginPx: 'lazy.rootMarginPx', batchDelayMs: 'lazy.batchDelayMs', hoverEnabled: 'hover.enabled', hoverModifier: 'hover.modifier',
    selectionEnabled: 'selection.enabled', showIcon: 'selection.showIcon', inputEnabled: 'input.enabled', inputLang: 'input.targetLang',
    inputTrigger: 'input.trigger', prefixOverride: 'input.prefixOverride', floatEnabled: 'floatBall.enabled', floatSide: 'floatBall.side',
    inputMode: 'input.mode', inputOrder: 'input.order', hoverProfile: 'hover.profileId', hoverModel: 'hover.model',
    inputProfile: 'input.profileId', inputModel: 'input.model',
    preset: 'prompt.preset', customPrompt: 'prompt.custom', cacheEnabled: 'cache.enabled', maxEntries: 'cache.maxEntries', ttlDays: 'cache.ttlDays',
    comicsEnabled:'comics.enabled',comicsLanguage:'comics.language',
  };
  const notice = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const fill = (id, value) => { if ($(id).type === 'checkbox') $(id).checked = !!value; else $(id).value = value ?? ''; };
  const read = id => $(id).type === 'checkbox' ? $(id).checked : nums.has(id) ? Number($(id).value) : $(id).value;
  const profile = () => s.provider.profiles.find(p => p.id === pid);
  function choices(select, values, selected) {
    select.replaceChildren();
    for (const value of values) {
      const o = root.ownerDocument.createElement('option'); o.value = value.id; o.textContent = value.name || value.label || value.id;
      select.append(o);
    }
    if (selected !== undefined) select.value = selected;
  }
  const on = (id, event, fn) => { $(id).addEventListener(event, fn); unbind.push(() => $(id).removeEventListener(event, fn)); };
  function action(id, fn) {
    on(id, 'click', async () => {
      $(id).disabled = true;
      try { await fn(); } catch (e) { notice(e.message || '操作失败', true); }
      finally { if (!closed) $(id).disabled = false; }
    });
  }
  function showSync() {
    $('sync-status').textContent = store.syncStatus?.synced ? '设置已同步；API key 仅存此设备。' : '此设备未同步；配置与 API key 保存在本机。';
  }
  async function showWizard() {
    const chain = providerChain(s);
    const usable = await Promise.all(chain.map(async c => {
      const apiKey = c.profile.kind === 'openai' ? await store.getSecret(c.profile.id) : '';
      return !profileProblem({ ...c.profile, model: c.model, apiKey }) && (!c.profile.requiresKey || !!apiKey);
    }));
    if (!closed) $('wizard').hidden = usable.some(Boolean);
  }
  async function drawProfile() {
    const token = ++drawToken, p = profile();
    loadingKey = true;
    const ids = ['profileName', 'baseUrl', ...(dialog ? ['set-key', 'clear-key'] : ['apiKey']), 'model', 'fallbackModels', 'jsonMode', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs'];
    for (const id of ids) $(id).disabled = !p;
    $('load-models').disabled = !p; $('test').disabled = !p;
    if (!p) { ids.filter(id => !['set-key', 'clear-key'].includes(id)).forEach(id => fill(id, '')); $('key-row').hidden = true; loadingKey = false; return; }
    for (const id of ['model', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs']) fill(id, p[id]);
    fill('profileName', p.name); fill('baseUrl', p.baseUrl); fill('jsonMode', p.jsonMode ?? false);
    fill('fallbackModels', (p.fallbackModels || []).join('\n'));
    if (!dialog) { fill('apiKey', ''); $('apiKey').disabled = true; }
    else { $('set-key').disabled = $('clear-key').disabled = true; $('key-status').textContent = '未设置'; }
    $('key-row').hidden = p.kind === 'mock'; $('baseUrl').disabled = p.kind === 'mock'; $('jsonMode').disabled = p.kind === 'mock';
    $('credential-label').textContent = 'API key（仅存本机）';
    const preset = getPreset(p.preset);
    $('provider-description').textContent = preset?.description || '使用自己的模型服务；不会自动联网。';
    $('key-link').hidden = !preset?.keyUrl;
    if (preset?.keyUrl) $('key-link').href = preset.keyUrl;
    const secret = edited.has(p.id) ? drafts.get(p.id) : await store.getSecret(p.id);
    if (closed || token !== drawToken) return;
    drafts.set(p.id, secret);
    if (dialog) {
      $('key-status').textContent = secret ? '已设置' : '未设置';
      $('set-key').disabled = $('clear-key').disabled = p.kind === 'mock';
    } else { fill('apiKey', secret); $('apiKey').disabled = p.kind === 'mock'; }
    loadingKey = false;
  }
  function captureProfile() {
    const p = profile(); if (!p || loadingKey) return;
    p.name = read('profileName').trim(); p.model = read('model').trim();
    for (const id of ['maxItems', 'maxChars', 'concurrency', 'timeoutMs']) p[id] = read(id);
    if (p.kind !== 'mock') { p.baseUrl = read('baseUrl').trim(); p.jsonMode = read('jsonMode'); }
    if (p.kind !== 'mock' && !dialog) drafts.set(p.id, read('apiKey').trim());
    p.fallbackModels = lines(read('fallbackModels'));
  }
  function setSelectedChain() {
    const p = profile();
    const chain = p ? [p.model, ...(p.fallbackModels || [])].filter(Boolean).map(model => ({ profileId: p.id, model })) : [];
    fill('providerChain', JSON.stringify(chain, null, 2));
  }
  async function draw() {
    for (const name of ['hover', 'input']) choices($(name + 'Profile'), [{ id: '', name: '继承网页翻译' }, ...s.provider.profiles]);
    fill('comicsSites',s.comics.canvasSites.map(site=>typeof site==='string'?site:JSON.stringify(site)).join('\n'));
    for (const id of simple) fill(id, s[id]);
    for (const [id, path] of Object.entries(bind)) fill(id, path.split('.').reduce((v, k) => v[k], s));
    fill('glossary', s.glossary.map(t => `${t.src} → ${t.dst}`).join('\n'));
    fill('always', s.siteRules.always.join('\n')); fill('never', s.siteRules.never.join('\n'));
    fill('customRules', JSON.stringify(s.siteRules.custom, null, 2));
    fill('translationMode', s.translation.mode); fill('mtEngine', s.translation.mt.engine);
    fill('mtFallback', s.translation.mt.fallback); fill('mtRegion', s.translation.mt.region);
    await drawMtKey();
    for (const o of $('autoLangs').options) o.selected = s.autoTranslateLangs.includes(o.value);
    pid = s.provider.active;
    choices($('profile'), [{ id: '', name: '选择一个服务' }, ...s.provider.profiles], pid);
    fill('providerChain', JSON.stringify(s.provider.chain, null, 2));
    await drawProfile(); showSync(); await showWizard();
    if(platform.comics) await showLanguages();
  }
  function collect() {
    captureProfile();
    const next = structuredClone(s);
    next.comics.canvasSites=lines(read('comicsSites')).map(site=>site.startsWith('{')?JSON.parse(site):site);
    for (const id of simple) next[id] = read(id);
    for (const [id, path] of Object.entries(bind)) {
      const parts = path.split('.'); next[parts[0]][parts[1]] = read(id);
    }
    Object.assign(next.translation, { mode: read('translationMode') });
    Object.assign(next.translation.mt, { engine: read('mtEngine'), fallback: read('mtFallback'), region: read('mtRegion').trim() });
    next.provider.active = pid;
    next.provider.chain = JSON.parse(read('providerChain') || '[]');
    next.glossary = terms(read('glossary'));
    next.siteRules.always = lines(read('always'));
    next.siteRules.never = lines(read('never'));
    next.autoTranslateLangs = [...$('autoLangs').selectedOptions].map(o => o.value);
    try { next.siteRules.custom = JSON.parse(read('customRules') || '[]'); }
    catch { throw new Error('站点规则 JSON 格式无效'); }
    if (Array.isArray(next.siteRules.custom)) for (const r of next.siteRules.custom) for (const field of ['include', 'exclude']) {
      for (const selector of Array.isArray(r[field]) ? r[field] : r[field] ? [r[field]] : []) root.ownerDocument.createDocumentFragment().querySelector(selector);
    }
    return validateSettings(next);
  }
  async function save() {
    if (loadingKey) throw new Error('正在读取本机密钥，请稍后保存');
    const next = collect();
    saving = true;
    try {
      s = await store.save(next);
      const registration=await platform.comics?.syncSites?.();
      if(registration && !registration.ok) throw new Error(registration.error?.message || '漫画站点钩子注册失败');
      for (const id of edited) await store.setSecret(id, drafts.get(id));
      edited.clear();
      dirty = false; showSync(); await showWizard(); notice('设置已保存');
    } finally { saving = false; }
    return s;
  }
  on('settings-form', 'input', event => {
    dirty = true;
    if (event.target === $('backupText')) $('backup-qr').hidden = true;
    if (event.target === $('apiKey') && pid) edited.add(pid);
    if (!dialog && event.target === $('mtKey') && mtSecretId()) { drafts.set(mtSecretId(), $('mtKey').value.trim()); edited.add(mtSecretId()); }
  });
  on('mtEngine', 'change', () => { void drawMtKey(); });
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
  if (dialog) {
    action('set-key', async () => {
      const id = pid;
      if (!id || loadingKey) return;
      const key = await platform.promptSecret('输入此服务的 API key（留空清除；取消保留原值）');
      if (key === null || closed || pid !== id) return;
      if (typeof key !== 'string' || /[^\x20-\x7e]/.test(key.trim())) throw new Error('API key 含有非法字符');
      drafts.set(id, key.trim()); edited.add(id); dirty = true;
      $('key-status').textContent = key.trim() ? '已设置' : '未设置';
      notice('密钥修改尚未保存；点击保存设置。');
    });
    action('mt-set-key', async () => {
      const id = mtSecretId();
      if (!id) return;
      const key = await platform.promptSecret('输入此机器翻译服务的 key（留空清除；取消保留原值）');
      if (key === null || closed || mtSecretId() !== id) return;
      if (typeof key !== 'string' || /[^ -~]/.test(key.trim())) throw new Error('key 含有非法字符');
      drafts.set(id, key.trim()); edited.add(id); dirty = true;
      $('mt-key-status').textContent = key.trim() ? '已设置' : '未设置';
      notice('机器翻译 key 修改尚未保存；点击保存设置。');
    });
    action('mt-clear-key', async () => {
      const id = mtSecretId();
      if (!id) return;
      drafts.set(id, ''); edited.add(id); dirty = true;
      $('mt-key-status').textContent = '未设置'; notice('机器翻译 key 清除尚未保存；点击保存设置。');
    });
    action('clear-key', async () => {
      if (!pid || loadingKey) return;
      drafts.set(pid, ''); edited.add(pid); dirty = true;
      $('key-status').textContent = '未设置'; notice('密钥清除尚未保存；点击保存设置。');
    });
  }
  on('settings-form', 'submit', async e => {
    e.preventDefault(); $('save').disabled = true;
    try { await save(); } catch (error) { notice(error.message, true); }
    finally { if (!closed) $('save').disabled = false; }
  });
  on('profile', 'change', async () => {
    captureProfile(); pid = read('profile'); s.provider.active = pid; dirty = true;
    await drawProfile(); setSelectedChain();
  });
  on('model', 'change', () => {
    captureProfile(); const p = profile(), models = discovered.get(pid);
    if (p?.preset === 'openrouter' && models?.some(m => m.id === p.model)) {
      const primary = models.find(m => m.id === p.model);
      const ordered = [primary, ...models.filter(m => m.id !== primary.id)];
      fill('providerChain', JSON.stringify(recommendedFreeChain(ordered, pid), null, 2));
      p.jsonMode = primary.jsonMode; fill('jsonMode', p.jsonMode);
    } else setSelectedChain();
  });
  on('fallbackModels', 'change', () => { captureProfile(); setSelectedChain(); });
  action('add-profile', async () => {
    const preset = read('providerPreset'); if (!preset) throw new Error('先选择一个服务预设');
    captureProfile();
    let id = preset, count = 2; while (s.provider.profiles.some(p => p.id === id)) id = preset + '-' + count++;
    const p = profileFromPreset(preset, id); s.provider.profiles.push(p); s.provider.active = id; pid = id; dirty = true;
    choices($('profile'), [{ id: '', name: '选择一个服务' }, ...s.provider.profiles], id);
    for (const name of ['hover', 'input']) choices($(name + 'Profile'), [{ id: '', name: '继承网页翻译' }, ...s.provider.profiles], read(name + 'Profile'));
    await drawProfile(); setSelectedChain(); notice('填写 key，获取模型并测试；最后保存。');
  });
  action('load-models', async () => {
    captureProfile(); const p = profile(); notice('正在获取模型列表…');
    let models;
    if (providers) models = await providers.listModels(p);
    else {
      if (dirty) throw new Error('此平台需提供 http 才能在保存前获取模型');
      const r = await service().listModels(pid); if (!r.ok) throw new Error(r.error?.message || '获取失败'); models = r.models;
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
      const r = await service().testProvider(pid); if (!r.ok) throw new Error(r.error?.message || '测试失败');
      notice(`连接正常 · ${r.latencyMs} ms · ${r.sample || ''}`);
    }
  });
  action('mt-test', async () => {
    if (!mtProbe) throw new Error('此平台不能直接测试机器翻译');
    const engine = read('mtEngine'); notice('正在测试机器翻译…');
    const r = await mtProbe.test({ engine, region: read('mtRegion').trim() });
    notice(`机器翻译正常 · ${engine} · ${r.latencyMs} ms · ${r.sample}`);
  });
  action('export', async () => {
    const password = dialog ? await platform.promptSecret('配置导出口令（留空导出不含 key 的明文；取消停止导出）') : read('backupPassword');
    if (password === null || closed) { if (!closed) notice('已取消导出'); return; }
    await save(); const secrets = {};
    if (password) for (const id of [...s.provider.profiles.map(p => p.id), ...MT_SECRET_IDS]) {
      const apiKey = await store.getSecret(id); if (apiKey) secrets[id] = { apiKey };
    }
    const text = await exportConfig(s, { password, secrets });
    $('backup-qr').hidden = true;
    fill('backupText', text);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = root.ownerDocument.createElement('a'); a.href = url; a.download = password ? 'duallens-config.encrypted.txt' : 'duallens-config.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!dialog) fill('backupPassword', ''); notice('已导出；明文配置不含 key，加密配置包含 key。');
  });
  action('export-phone', async () => {
    const password = dialog ? await platform.promptSecret('设置手机配置导出口令（不能为空；取消停止）') : read('backupPassword');
    if (password === null || closed) return;
    if (!password) throw new Error('导出到手机必须设置加密口令');
    await save(); const secrets = {};
    for (const id of [...s.provider.profiles.map(p => p.id), ...MT_SECRET_IDS]) { const apiKey = await store.getSecret(id); if (apiKey) secrets[id] = { apiKey }; }
    const text = await exportConfig(compactConfig(s), { password, secrets });
    if (closed) return;
    fill('backupText', text); $('backup-qr').hidden = true;
    if (!dialog) fill('backupPassword', '');
    if (typeof platform.renderQr !== 'function') {
      notice('加密配置已生成；请复制文本并在另一设备导入。口令通过其他安全方式传递。');
      return;
    }
    try { await platform.renderQr($('backup-qr'), text); if (closed) return; $('backup-qr').hidden = false; notice('加密配置已生成；手机扫码或复制文本，然后从电脑导入。口令通过其他安全方式传递。'); }
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
    const password = dialog ? (text.startsWith('duallens-config:v1:') ? await platform.promptSecret('输入配置导入口令（取消停止导入）') : '') : read('backupPassword');
    if (password === null || closed) { if (!closed) notice('已取消导入'); return; }
    const parsed = await importConfig(text, password);
    const next = importSettings(parsed.settings, await store.load()); // validate everything before writes
    saving = true;
    try {
      s = await store.save(next, { preserveProvider: true });
      for (const [id, secret] of Object.entries(parsed.secrets || {})) if (next.provider.profiles.some(p => p.id === id) || MT_SECRET_IDS.includes(id)) await store.setSecret(id, secret.apiKey);
      drafts.clear(); edited.clear(); dirty = false; if (!dialog) fill('backupPassword', ''); fill('backupText', ''); $('backup-qr').hidden = true; await draw(); notice('设置已导入');
    } finally { saving = false; }
  }
  action('import-button', () => importText(read('backupText')));
  if (dialog) action('import-computer', () => {
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
  s = await store.load(); await draw(); notice('修改后点击保存；获取模型与测试连接由你手动发起。');$('save').disabled=false;
  const off = store.onChange?.(async () => {
    if (saving || closed) return;
    if (dirty) { showSync(); return; }
    try { s = await store.load(); if (!closed) await draw(); } catch { notice('读取更新后的配置失败', true); }
  });
  return {
    refresh: async () => { s = await store.load(); drafts.clear(); edited.clear(); dirty = false; await draw(); },
    destroy() { closed = true; drawToken++; off?.(); unbind.forEach(fn => fn()); ui.remove(); drafts.clear(); edited.clear(); },
  };
}

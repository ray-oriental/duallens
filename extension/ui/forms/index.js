import { t as l10n } from '../../shared/i18n.js';
import { mountPopup } from '../popup-view.js';
import { installSettingsInteractions } from './interactions.js';
import { requestOrigin, requestBroad, requestMTOrigin } from '../../shared/permissions.js';
import { acknowledge,llmDestination } from '../../shared/device-state.js';
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
import { TEXT as COMMON } from '../components.js';

// Localized copy shared by the extension and lazy userscript UI.
const COPY=Object.freeze({
  s0:l10n('mbr'),
  s1:l10n('mbs'),
  s2:l10n('maq'),
  s3:l10n('mbt'),
  s4:l10n('mbu'),
  s5:l10n('mbv'),
  s6:l10n('mbw'),
  s7:l10n('m5s'),
  s8:l10n('mbx'),
  s9:l10n('mby'),
  s10:l10n('mbz'),
  s11:l10n('mc0'),
  s12:l10n('mc1'),
  s13:l10n('mc2'),
  s14:l10n('m3b'),
  s15:l10n('m3c'),
  s16:l10n('m3d'),
  s17:l10n('mc3'),
  s18:l10n('mc4'),
  s19:l10n('mc5'),
  s20:l10n('mc6'),
  s21:l10n('mc7'),
  s22:l10n('mc8'),
  s23:l10n('mc9'),
  s24:l10n('mca'),
  s25:l10n('mcb'),
  s26:l10n('mcc'),
  s27:l10n('mcd'),
  s28:l10n('mce'),
  s29:l10n('mcf'),
  s30:l10n('mcg'),
  s31:l10n('mch'),
  s32:l10n('mci'),
  s33:l10n('mcj'),
  s34:l10n('mck'),
  s35:l10n('mcl'),
  s36:l10n('mcm'),
  s37:l10n('mcn'),
  s38:l10n('mco'),
  s39:l10n('mcp'),
  s40:l10n('mcq'),
  s41:l10n('mcr'),
  s42:l10n('mcs'),
  s43:l10n('mct'),
  s44:l10n('mcu'),
  s45:l10n('mcv'),
  s46:l10n('mcw'),
  s47:l10n('mcx'),
  s48:l10n('mcy'),
  s49:l10n('mcz'),
  s50:l10n('md0'),
  s51:l10n('md1'),
  s52:l10n('md2'),
  s53:l10n('md3'),
  s54:l10n('md4'),
  s55:l10n('md5'),
  s56:l10n('md6')
});

// Shared by options and the platform's page panel. No browser globals or implicit storage.
export async function mountSettingsForm(root, { store, platform }) {
  // Extension settings have their own origin and retain the ordinary password field.
  const dialog = platform.kind !== 'extension';
  const ui = drawLayout(root, { secretDialog:dialog });
  const siteRules=mountSiteRules(ui);
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
    if (dialog) $('mt-key-status').textContent = secret ? COPY.s0 : COPY.s1; else $('mtKey').value = secret;
  }
  const simple = ['targetLang', 'sourceLang', 'displayMode', 'style', 'minChars', 'inlineMaxChars', 'translateShortText'];
  const nums = new Set(['minChars', 'inlineMaxChars', 'rootMarginPx', 'batchDelayMs', 'maxItems', 'maxChars', 'concurrency', 'timeoutMs', 'maxEntries', 'ttlDays', 'subtitleSize']);
  const bind = {
    rootMarginPx: 'lazy.rootMarginPx', batchDelayMs: 'lazy.batchDelayMs', hoverEnabled: 'hover.enabled', hoverModifier: 'hover.modifier',
    selectionEnabled: 'selection.enabled', showIcon: 'selection.showIcon', inputEnabled: 'input.enabled', inputLang: 'input.targetLang',
    inputTrigger: 'input.trigger', prefixOverride: 'input.prefixOverride', floatEnabled: 'floatBall.enabled', floatSide: 'floatBall.side', floatAutoHide:'floatBall.autoHide', subtitlesEnabled:'subtitles.enabled', subtitleMode:'subtitles.mode', subtitlePosition:'subtitles.position', subtitleSize:'subtitles.fontSize',
    inputMode: 'input.mode', inputOrder: 'input.order', hoverProfile: 'hover.profileId', hoverModel: 'hover.model',
    inputProfile: 'input.profileId', inputModel: 'input.model',
    preset: 'prompt.preset', customPrompt: 'prompt.custom', cacheEnabled: 'cache.enabled', maxEntries: 'cache.maxEntries', ttlDays: 'cache.ttlDays',
    comicsEnabled:'comics.enabled',comicsLanguage:'comics.language',
  };
  const notice = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  const fill = (id, value) => { if ($(id).type === 'checkbox') $(id).checked = !!value; else $(id).value = value ?? ''; if(id==='providerChain') interactions?.draw(); };
  const read = id => $(id).type === 'checkbox' ? $(id).checked : nums.has(id) ? Number($(id).value) : $(id).value;
  const profile = () => s.provider.profiles.find(p => p.id === pid);
  function choices(select, values, selected) {
    select.replaceChildren();
    for (const value of values) {
      const o = root.ownerDocument.createElement('option'); o.value = value.id; o.textContent = value.name || value.label || value.id;
      if(value.kind==='mock') o.hidden=true;
      select.append(o);
    }
    if (selected !== undefined) select.value = selected;
  }
  const on = (id, event, fn) => { $(id).addEventListener(event, fn); unbind.push(() => $(id).removeEventListener(event, fn)); };
  function action(id, fn) {
    on(id, 'click', async () => {
      $(id).disabled = true;
      const report=(message,error=false)=>{notice(message,error);if(['test','load-models','mt-test'].includes(id)){let result=$('result-'+id);if(!result){result=root.ownerDocument.createElement('span');result.id='result-'+id;result.className='status';result.setAttribute('role','status');$(id).after(result);}result.textContent=message;result.classList.toggle('error',error);}};
      try { await fn(report); } catch (e) { report(e.message || COPY.s2, true); }
      finally { if (!closed) $(id).disabled = false; }
    });
  }
  function showSync() {
    $('sync-status').textContent = store.syncStatus?.synced ? COPY.s3 : COPY.s4;
  }
  async function showWizard() {}
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
    else { $('set-key').disabled = $('clear-key').disabled = true; $('key-status').textContent = COPY.s1; }
    $('key-row').hidden = p.kind === 'mock'; $('baseUrl').disabled = p.kind === 'mock'; $('jsonMode').disabled = p.kind === 'mock';
    $('credential-label').textContent = l10n('polishKey');
    const preset = getPreset(p.preset);
    $('provider-description').textContent = preset?.description || COPY.s6;
    $('key-link').hidden = !preset?.keyUrl;
    if (preset?.keyUrl) $('key-link').href = preset.keyUrl;
    const secret = edited.has(p.id) ? drafts.get(p.id) : await store.getSecret(p.id);
    if (closed || token !== drawToken) return;
    drafts.set(p.id, secret);
    if (dialog) {
      $('key-status').textContent = secret ? COPY.s0 : COPY.s1;
      $('set-key').disabled = $('clear-key').disabled = p.kind === 'mock';
    } else { fill('apiKey', secret); $('apiKey').disabled = p.kind === 'mock'; }
    loadingKey = false; interactions?.draw();
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
    fill('providerChain', JSON.stringify(chain, null, 2)); interactions?.draw();
  }
  async function draw() {
    for (const name of ['hover', 'input']) choices($(name + 'Profile'), [{ id: '', name: COPY.s7 }, ...s.provider.profiles]);
    fill('comicsSites',s.comics.canvasSites.map(site=>typeof site==='string'?site:JSON.stringify(site)).join('\n'));
    for (const id of simple) fill(id, s[id]);
    for (const [id, path] of Object.entries(bind)) fill(id, path.split('.').reduce((v, k) => v[k], s));
    fill('glossary', s.glossary.map(t => `${t.src} → ${t.dst}`).join('\n'));
    fill('always', s.siteRules.always.join('\n')); fill('never', s.siteRules.never.join('\n'));
    fill('customRules', JSON.stringify(s.siteRules.custom, null, 2));siteRules.draw();
    fill('translationMode', s.translation.mode); fill('mtEngine', s.translation.mt.engine);
    fill('mtFallback', s.translation.mt.fallback); fill('mtRegion', s.translation.mt.region);
    await drawMtKey();
    for (const o of $('autoLangs').options) o.selected = s.autoTranslateLangs.includes(o.value);
    pid = s.provider.active;
    choices($('profile'), [{ id: '', name: COPY.s8 }, ...s.provider.profiles], pid);
    fill('providerChain', JSON.stringify(s.provider.chain, null, 2));
    await drawProfile(); showSync(); await showWizard(); interactions?.draw();
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
    catch { throw new Error(COPY.s9); }
    if (Array.isArray(next.siteRules.custom)) for (const r of next.siteRules.custom) for (const field of ['include', 'exclude']) {
      for (const selector of Array.isArray(r[field]) ? r[field] : r[field] ? [r[field]] : []) root.ownerDocument.createDocumentFragment().querySelector(selector);
    }
    return validateSettings(next);
  }
  async function save() {
    if (loadingKey) throw new Error(COPY.s10);
    const next = collect();
    if(platform.kind==='extension' && !await requestMTOrigin(next.translation.mt.engine,platform.permissionAPI))throw new Error(COPY.s28);
    const chosen=next.provider.profiles.find(p=>p.id===next.provider.active);
    if(chosen?.baseUrl && platform.kind==='extension' && !await requestOrigin(chosen.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);
    if(platform.kind==='extension' && (next.siteRules.always.length || next.siteRules.custom.some(r=>r.page==='always'||['selection','hover','input'].some(f=>r[f]==='on')) || next.autoTranslateLangs.length) && !await requestBroad(platform.permissionAPI)) throw new Error(COPY.s28);
    saving = true;
    try {
      s = await store.save(next);
      const registration=await platform.comics?.syncSites?.();
      if(registration && !registration.ok) throw new Error(registration.error?.message || COPY.s11);
      for (const id of edited) await store.setSecret(id, drafts.get(id));
      if(chosen?.baseUrl && platform.localArea) await acknowledge(platform.localArea,llmDestination(chosen.baseUrl));
      edited.clear();
      dirty = false;siteRules.close();siteRules.draw(); showSync(); await showWizard(); interactions?.draw(); notice(COPY.s12);
    } finally { saving = false; }
    return s;
  }
  on('settings-form', 'input', event => {
    if (['style-tile','translation-method'].includes(event.target.name) || interactions?.isImmediate(event.target) || ['backupText','backupPassword'].includes(event.target.id)) return;
    dirty = true;
    if (event.target === $('backupText')) $('backup-qr').hidden = true;
    if (event.target === $('apiKey') && pid) edited.add(pid);
    if (!dialog && event.target === $('mtKey') && mtSecretId()) { drafts.set(mtSecretId(), $('mtKey').value.trim()); edited.add(mtSecretId()); }
  });
  on('mtEngine', 'change', () => { void drawMtKey(); });
  async function showLanguages() {
    const output=$('comics-languages');output.replaceChildren();
    const result=await platform.comics?.languages();
    if(!result?.ok) {output.textContent=result?.error?.message || COPY.s13;return;}
    if(!result.languages.length) output.textContent=COPY.s14;
    for(const pack of result.languages) {
      const row=root.ownerDocument.createElement('p');row.textContent=`${pack.lang} · ${(pack.bytes/1048576).toFixed(2)} MiB `;
      const button=root.ownerDocument.createElement('button');button.type='button';button.textContent=COPY.s15;
      button.addEventListener('click',async()=> {
        button.disabled=true;
        try {const deleted=await platform.comics.languages(pack.lang);if(!deleted.ok)throw new Error(COPY.s16);row.remove();}
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
      const key = await platform.promptSecret(COPY.s17);
      if (key === null || closed || pid !== id) return;
      if (typeof key !== 'string' || /[^\x20-\x7e]/.test(key.trim())) throw new Error(COPY.s18);
      drafts.set(id, key.trim()); edited.add(id); dirty = true;
      $('key-status').textContent = key.trim() ? COPY.s0 : COPY.s1;
      notice(COPY.s19);
    });
    action('mt-set-key', async () => {
      const id = mtSecretId();
      if (!id) return;
      const key = await platform.promptSecret(COPY.s20);
      if (key === null || closed || mtSecretId() !== id) return;
      if (typeof key !== 'string' || /[^ -~]/.test(key.trim())) throw new Error(COPY.s21);
      drafts.set(id, key.trim()); edited.add(id); dirty = true;
      $('mt-key-status').textContent = key.trim() ? COPY.s0 : COPY.s1;
      notice(COPY.s22);
    });
    action('mt-clear-key', async () => {
      const id = mtSecretId();
      if (!id) return;
      drafts.set(id, ''); edited.add(id); dirty = true;
      $('mt-key-status').textContent = COPY.s1; notice(COPY.s23);
    });
    action('clear-key', async () => {
      if (!pid || loadingKey) return;
      drafts.set(pid, ''); edited.add(pid); dirty = true;
      $('key-status').textContent = COPY.s1; notice(COPY.s24);
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
    const preset = read('providerPreset'); if (!preset) throw new Error(COPY.s25);
    captureProfile();
    let id = preset, count = 2; while (s.provider.profiles.some(p => p.id === id)) id = preset + '-' + count++;
    const p = profileFromPreset(preset, id); s.provider.profiles.push(p); s.provider.active = id; pid = id; dirty = true;
    choices($('profile'), [{ id: '', name: COPY.s8 }, ...s.provider.profiles], id);
    for (const name of ['hover', 'input']) choices($(name + 'Profile'), [{ id: '', name: COPY.s7 }, ...s.provider.profiles], read(name + 'Profile'));
    if(['ollama','lmstudio'].includes(preset)){s.translation.mode='llm';fill('translationMode','llm');}
    await drawProfile(); setSelectedChain(); notice(['ollama','lmstudio'].includes(preset)?l10n('polishLocalReady'):COPY.s26);
  });
  action('load-models', async () => {
    captureProfile(); const p = profile(); notice(COPY.s27);
    let models;
    if (platform.kind==='extension' && p?.baseUrl && !await requestOrigin(p.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);
    if (providers) models = await providers.listModels(p,{freeOnly:$('freeModels').checked});
    else {
      if (dirty) throw new Error(COPY.s29);
      const r = await service().listModels(pid); if (!r.ok) throw new Error(r.error?.message || COPY.s30); models = r.models;
    }
    choices($('models'), models || []);
    discovered.set(p.id, models || []);
    if (p.preset === 'openrouter' && models?.length && !p.model) {
      const chain = recommendedFreeChain(models, p.id); p.model = chain[0].model;
      p.jsonMode = !!models.find(m => m.id === p.model)?.jsonMode;
      fill('model', p.model); fill('jsonMode', p.jsonMode); fill('providerChain', JSON.stringify(chain, null, 2));
    }
    notice(l10n('md7', [models?.length || 0]));
  });
  action('test', async report => {
    captureProfile(); const p = profile(); report(COPY.s31);
    if (platform.kind==='extension' && p?.baseUrl && !await requestOrigin(p.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);
    if (providers) {
      const { messages, idMap } = buildMessages({ items: [{ id: 1, text: 'Hello, world.' },{ id:2,text:'The library is quiet.' }], to: 'zh-CN', from: 'en', context: {}, preset: 'general', custom: '', glossary: [] });
      const start = Date.now(); const content = await providers.chat({ profile: p, model: p.model, messages });
      const parsed = parseSegments(content, idMap),sample=parsed.results.get(1);
      if (parsed.results.size!==2 || parsed.missing.length || parsed.invalidJSON || !sample) throw new Error(COPY.s32);
      report(l10n('md8', [Date.now() - start, stripMarkup(sample).slice(0, 200)]));
    } else {
      if (dirty) throw new Error(COPY.s33);
      const r = await service().testProvider(pid); if (!r.ok) throw new Error(r.error?.message || COPY.s34);
      report(l10n('md8', [r.latencyMs, r.sample || '']));
    }
  });
  action('mt-test', async () => {
    if (!mtProbe) throw new Error(COPY.s35);
    const engine = read('mtEngine');
    if(platform.kind==='extension'&&!await requestMTOrigin(engine,platform.permissionAPI))throw new Error(COPY.s28);
    notice(COPY.s36);
    const r = await mtProbe.test({ engine, region: read('mtRegion').trim() });
    notice(l10n('md9', [engine, r.latencyMs, r.sample]));
  });
  action('export', async () => {
    const password = dialog ? await platform.promptSecret(COPY.s37) : read('backupPassword');
    if (password === null || closed) { if (!closed) notice(COPY.s38); return; }
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
    if (!dialog) fill('backupPassword', ''); notice(COPY.s39);
  });
  action('export-phone', async () => {
    const password = dialog ? await platform.promptSecret(COPY.s40) : read('backupPassword');
    if (password === null || closed) return;
    if (!password) throw new Error(COPY.s41);
    await save(); const secrets = {};
    for (const id of [...s.provider.profiles.map(p => p.id), ...MT_SECRET_IDS]) { const apiKey = await store.getSecret(id); if (apiKey) secrets[id] = { apiKey }; }
    // Locale-dependent defaults differ across devices: always transfer the chosen language.
    const text = await exportConfig({...compactConfig(s),targetLang:s.targetLang}, { password, secrets });
    if (closed) return;
    fill('backupText', text); $('backup-qr').hidden = true;
    if (!dialog) fill('backupPassword', '');
    if (typeof platform.renderQr !== 'function') {
      notice(COPY.s42);
      return;
    }
    try { await platform.renderQr($('backup-qr'), text); if (closed) return; $('backup-qr').hidden = false; notice(COPY.s43); }
    catch (error) { notice(error.message); }
  });
  action('copy-backup', async () => {
    const text = read('backupText'); if (!text) throw new Error(COPY.s44);
    const clipboard = root.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard) { $('backupText').select(); notice(COPY.s45); return; }
    try { await clipboard.writeText(text); notice(COPY.s46); }
    catch { $('backupText').select(); notice(COPY.s47); }
  });
  async function importText(text) {
    const password = dialog ? (text.startsWith('duallens-config:v1:') ? await platform.promptSecret(COPY.s48) : '') : read('backupPassword');
    if (password === null || closed) { if (!closed) notice(COPY.s49); return; }
    const parsed = await importConfig(text, password);
    const next = importSettings(parsed.settings, await store.load()); // validate everything before writes
    saving = true;
    try {
      s = await store.save(next, { preserveProvider: true });
      for (const [id, secret] of Object.entries(parsed.secrets || {})) if (next.provider.profiles.some(p => p.id === id) || MT_SECRET_IDS.includes(id)) await store.setSecret(id, secret.apiKey);
      drafts.clear(); edited.clear(); dirty = false; if (!dialog) fill('backupPassword', ''); fill('backupText', ''); $('backup-qr').hidden = true; await draw(); notice(COPY.s50);
    } finally { saving = false; }
  }
  action('import-button', () => importText(read('backupText')));
  if (dialog) action('import-computer', () => {
    const text = read('backupText').trim();
    if (!text.startsWith('duallens-config:v1:')) throw new Error(COPY.s51);
    return importText(text);
  });
  action('import-file-button', async () => $('import-file').click());
  on('import-file', 'change', async () => {
    try {
      const file = $('import-file').files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error(COPY.s52);
      await importText(await file.text());
    } catch (e) { notice(e.message, true); }
    finally { $('import-file').value = ''; }
  });
  action('cache-clear', async () => {
    if (!platform.clearCache) throw new Error(COPY.s53);
    await platform.clearCache(); $('cache-stats').textContent = COPY.s54; notice(COPY.s54);
  });
  let interactions;
  s = await store.load();
  interactions = installSettingsInteractions(ui,{store,platform,version:platform.version||mountSettingsForm.version,getSettings:()=>s,setSettings:value=>{s=value;},getDirty:()=>dirty,setDirty:value=>{dirty=value;},getProfile:profile,save,draw,captureProfile,onSaved:showSync,notice,bind,simple,nums});
  await draw(); notice(['common','ai','sites','glossary'].includes(platform.settingsGroup||globalThis.location?.hash.slice(1)||'common')?COPY.s55:'');$('save').disabled=false;
  const off = store.onChange?.(async () => {
    if (saving || closed) return;
    if (dirty) { showSync(); return; }
    try { s = await store.load(); if (!closed) await draw(); } catch { notice(COPY.s56, true); }
  });
  return {
    navigateGroup: group => interactions.select(group || 'common'),
    canClose: () => !dirty || interactions.ask(COMMON.discard),
    refresh: async () => { s = await store.load(); drafts.clear(); edited.clear(); dirty = false; await draw(); },
    destroy() { interactions.destroy(); closed = true; drawToken++; off?.(); unbind.forEach(fn => fn()); ui.remove(); drafts.clear(); edited.clear(); },
  };
}

// The verified lazy settings resource also supplies the mobile popup view.
mountSettingsForm.mountPopup = mountPopup;

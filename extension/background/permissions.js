import { BROAD, PERSISTENT_FEATURES, featureNeedsBroad } from '../shared/permissions.js';

export const PAGE_SCRIPT_ID = 'duallens-pages';
export const SUBTITLE_SCRIPT_ID = 'duallens-subtitles';
export const REVOCATION_KEY = 'ui.permissionsRevoked';
const PASSIVE = PERSISTENT_FEATURES.filter(name => featureNeedsBroad(name) && name !== 'alwaysRules');

export function needsResident(settings) {
  return PASSIVE.some(name => settings[name]?.enabled) || settings.subtitles?.enabled ||
    settings.siteRules?.always?.length > 0 || settings.autoTranslateLangs?.length > 0 ||
    settings.siteRules?.custom?.some(rule => rule.page === 'always' ||
      ['selection', 'hover', 'input'].some(name => rule[name] === 'on')) || false;
}

// Return a patch, without touching preferences unrelated to passive page access.
export function revokedSettingsPatch(settings) {
  const patch = {};
  for (const name of [...PASSIVE, 'subtitles']) {
    if (settings[name]?.enabled) patch[name] = { enabled: false };
  }
  if (settings.autoTranslateLangs?.length) patch.autoTranslateLangs = [];
  const rules = settings.siteRules;
  if (rules?.always?.length || rules?.custom?.some(rule => rule.page === 'always' ||
      ['selection', 'hover', 'input'].some(name => rule[name] === 'on'))) {
    patch.siteRules = { ...rules, always: [], custom: (rules.custom || []).map(rule => {
      const next = { ...rule };
      if (next.page === 'always') next.page = 'default';
      for (const name of ['selection', 'hover', 'input']) if (next[name] === 'on') next[name] = 'off';
      return next;
    }) };
  }
  return patch;
}

export function residentScripts(settings, broad) {
  if (!broad || !needsResident(settings)) return [];
  const scripts = [{ id: PAGE_SCRIPT_ID, matches: ['http://*/*', 'https://*/*', 'file:///*'],
    js: ['content/loader.js'], css: ['styles/content.css'], runAt: 'document_idle', allFrames: true,
    matchOriginAsFallback: true, persistAcrossSessions: true }];
  if (settings.subtitles?.enabled) scripts.push({ id: SUBTITLE_SCRIPT_ID,
    matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
    js: ['content/subtitles/observer.js'], runAt: 'document_start', world: 'MAIN',
    allFrames: false, persistAcrossSessions: true });
  return scripts;
}

export function createPermissionRegistry(api, store) {
  let pending = Promise.resolve();
  return { sync() {
    const task = pending.then(async () => {
      const broad = await api.permissions.contains(BROAD);
      let settings = await store.load();
      if (!broad) {
        const patch = revokedSettingsPatch(settings);
        if (Object.keys(patch).length) {
          settings = await store.save(patch, { preserveProvider: true });
          await api.storage.local.set({ [REVOCATION_KEY]: { features: Object.keys(patch) } });
        }
      }
      const wanted = residentScripts(settings, broad);
      const current = await api.scripting.getRegisteredContentScripts({ ids: [PAGE_SCRIPT_ID, SUBTITLE_SCRIPT_ID] });
      for (const script of current) if (!wanted.some(next => next.id === script.id)) {
        await api.scripting.unregisterContentScripts({ ids: [script.id] });
      }
      for (const script of wanted) {
        const old = current.find(item => item.id === script.id);
        if (!old) await api.scripting.registerContentScripts([script]);
        else if (Object.keys(script).some(key => {
          const normalize = value => key === 'matches' ? [...value].sort() : value;
          return JSON.stringify(normalize(old[key])) !== JSON.stringify(normalize(script[key]));
        })) {
          await api.scripting.updateContentScripts([script]);
        }
      }
      return { ok: true, broad, registered: wanted.map(script => script.id) };
    });
    pending = task.catch(() => {});
    return task;
  } };
}

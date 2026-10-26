import { t as l10n, registerMessages, uiLanguage } from '../shared/i18n.js';
import { createResourceLoader } from './settings-resource.js';
const RESOURCE = '__DUALLENS_FEATURES_RESOURCE__';
export const FEATURES_RESOURCE_ERROR = () => l10n('budgetResourceError');

// One loader per userscript closure; the grant never crosses into the host page.
let load, activeModule;
export function configureFeatures(getResourceText) {
  if (!load) {
    const read = createFeaturesLoader(getResourceText);
    load = async () => activeModule = await read();
  }
}
export function syncFeatureLanguage() { activeModule?.setUiLanguage(uiLanguage()); }
export function createFeaturesLoader(getResourceText, spec = RESOURCE) {
  const read = createResourceLoader(getResourceText, spec, module =>
    typeof module?.VideoSubtitles === 'function' && typeof module?.createUserscriptOCR === 'function' && typeof module?.ComicTranslator === 'function' &&
    typeof module?.setUiLanguage === 'function' && module?.messages && typeof module.messages === 'object', FEATURES_RESOURCE_ERROR);
  return async () => {
    const module = await read();
    registerMessages(module.messages);
    module.setUiLanguage(uiLanguage());
    return module;
  };
}
export function loadFeatures() {
  return load ? load() : Promise.reject(new Error(FEATURES_RESOURCE_ERROR()));
}

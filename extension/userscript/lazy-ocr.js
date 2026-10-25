import { configureFeatures, loadFeatures } from './features-loader.js';
import { LANGUAGES } from '../content/comics/languages.js';

// Synchronous factory, asynchronous methods: same contract as the original OCR adapter.
export function createUserscriptOCR(options) {
  configureFeatures(options.getResourceText);
  let ocr, pending;
  const get = () => pending = loadFeatures().then(module => ocr ||= module.createUserscriptOCR(options))
    .finally(() => { pending = null; });
  return {
    async recognize(blob, options) { return (await get()).recognize(blob, options); },
    async languages(lang) {
      if (ocr || pending) return (await get()).languages(lang);
      // Settings list/remove private cached language records without parsing the OCR runtime.
      if (lang) { if (!LANGUAGES[lang]) return {ok:false}; await options.storage.remove(lang); }
      const all = await options.storage.get(null);
      return {ok:true,languages:Object.entries(all).filter(([key])=>LANGUAGES[key]).map(([key,record])=>({lang:key,bytes:record.bytes}))};
    },
  };
}

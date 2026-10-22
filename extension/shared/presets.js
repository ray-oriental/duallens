import { t as l10n } from './i18n.js';
// Original provider metadata, with links to each provider's public instructions.
// JSON mode is conservative: capability also depends on the selected model.
const batch = Object.freeze({ maxItems: 12, maxChars: 3000, concurrency: 2, timeoutMs: 60000 });
const preset = (id, name, baseUrl, requiresKey, keyUrl, description, extra = {}) => Object.freeze({
  id, get name(){return typeof name==='function'?name():name;}, baseUrl, requiresKey, keyUrl, get description() { return description(); }, kind: 'openai', jsonMode: false, ...batch, ...extra,
});
export const PROVIDER_PRESETS = Object.freeze([
  preset('openrouter', () => l10n('m8i'), 'https://openrouter.ai/api/v1', true,
    'https://openrouter.ai/settings/keys', () => l10n('m8j'), { freeModels: true }),
  preset('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', true,
    'https://platform.deepseek.com/api_keys', () => l10n('m8k')),
  preset('openai', 'OpenAI', 'https://api.openai.com/v1', true,
    'https://platform.openai.com/api-keys', () => l10n('m8l')),
  preset('ollama', 'Ollama', 'http://localhost:11434/v1', false,
    'https://docs.ollama.com/faq', () => l10n('m8m')),
  preset('lmstudio', 'LM Studio', 'http://localhost:1234/v1', false,
    'https://lmstudio.ai/docs/developer/openai-compat', () => l10n('m8n')),
  preset('custom', () => l10n('m8o'), '', false,
    '', () => l10n('m8p')),

]);
export function getPreset(id) { return PROVIDER_PRESETS.find(p => p.id === id); }
export function profileFromPreset(presetId, id = presetId) {
  const p = getPreset(presetId);
  if (!p) throw new Error(l10n('m8q'));
  const { description, keyUrl, freeModels, ...fields } = p;
  return { ...fields, id, preset: presetId, model: p.model || '', fallbackModels: [] };
}
export function recommendedFreeChain(models, profileId, limit = 3) {
  const vendors = new Set();
  return models.filter(m => {
    const vendor = m.id.split('/')[0];
    if (vendors.has(vendor)) return false;
    vendors.add(vendor);
    return true;
  }).slice(0, limit).map(m => ({ profileId, model: m.id }));
}

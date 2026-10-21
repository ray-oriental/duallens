// Original provider metadata, with links to each provider's public instructions.
// JSON mode is conservative: capability also depends on the selected model.
const batch = Object.freeze({ maxItems: 12, maxChars: 3000, concurrency: 2, timeoutMs: 60000 });
const preset = (id, name, baseUrl, requiresKey, keyUrl, description, extra = {}) => Object.freeze({
  id, name, baseUrl, requiresKey, keyUrl, description, kind: 'openai', jsonMode: false, ...batch, ...extra,
});
export const PROVIDER_PRESETS = Object.freeze([
  preset('openrouter', 'OpenRouter（推荐）', 'https://openrouter.ai/api/v1', true,
    'https://openrouter.ai/settings/keys', '可公开获取免费模型列表。免费模型有每分钟和每日限额，切换模型不能绕过账号限额；以服务商当前规则为准。JSON 模式按模型能力启用。', { freeModels: true }),
  preset('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', true,
    'https://platform.deepseek.com/api_keys', '在 DeepSeek 开放平台创建自己的 API key。JSON 模式默认关闭，可按模型文档启用。'),
  preset('openai', 'OpenAI', 'https://api.openai.com/v1', true,
    'https://platform.openai.com/api-keys', '使用你自己的 OpenAI API key，API 费用与 ChatGPT 订阅分开。JSON 模式按模型能力启用。'),
  preset('ollama', 'Ollama', 'http://localhost:11434/v1', false,
    'https://docs.ollama.com/faq', '需要自行运行 Ollama，并设置 OLLAMA_ORIGINS 允许扩展来源。localhost 指向当前设备；其它设备需填写可访问的服务地址。'),
  preset('lmstudio', 'LM Studio', 'http://localhost:1234/v1', false,
    'https://lmstudio.ai/docs/developer/openai-compat', '需要自行启动 LM Studio 的 OpenAI 兼容服务；localhost 指向当前设备。'),
  preset('custom', '自定义 OpenAI 兼容接口', '', false,
    '', '填写完整兼容 API 基础地址。可选 API key 仅存本机；JSON 模式默认关闭。'),

]);
export function getPreset(id) { return PROVIDER_PRESETS.find(p => p.id === id); }
export function profileFromPreset(presetId, id = presetId) {
  const p = getPreset(presetId);
  if (!p) throw new Error('未知的服务商预设');
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

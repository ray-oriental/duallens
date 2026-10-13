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
  preset('siliconflow', '硅基流动', 'https://api.siliconflow.cn/v1', true,
    'https://cloud.siliconflow.cn/account/ak', '在硅基流动控制台创建 API key。模型能力不同，JSON 模式默认关闭。'),
  preset('zhipu', '智谱', 'https://open.bigmodel.cn/api/paas/v4', true,
    'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', '使用智谱开放平台通用 API key；套餐专用端点可能不同。JSON 模式默认关闭。'),
  preset('moonshot', '月之暗面', 'https://api.moonshot.cn/v1', true,
    'https://platform.moonshot.cn/console/api-keys', '在 Moonshot 开放平台创建 key。JSON 模式默认关闭，按所选模型文档配置。'),
  preset('openai', 'OpenAI', 'https://api.openai.com/v1', true,
    'https://platform.openai.com/api-keys', '使用你自己的 OpenAI API key，API 费用与 ChatGPT 订阅分开。JSON 模式按模型能力启用。'),
  preset('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', true,
    'https://aistudio.google.com/apikey', 'Gemini 的 OpenAI 兼容端点。JSON 模式默认关闭；模型可用性和限额由 Google 决定。'),
  preset('groq', 'Groq', 'https://api.groq.com/openai/v1', true,
    'https://console.groq.com/keys', '在 Groq 控制台创建 API key。JSON 模式默认关闭，按模型能力启用。'),
  preset('sjtu', '交大模型服务', 'https://models.sjtu.edu.cn/api/v1', true,
    'https://models.sjtu.edu.cn', '填入你自己的服务 key，不依赖本机中转。JSON 模式默认关闭。'),
  preset('ollama', 'Ollama', 'http://127.0.0.1:11434/v1', false,
    'https://docs.ollama.com/api/openai-compatibility', '需要你自己运行 Ollama。手机请填可访问的局域网地址；127.0.0.1 指向当前设备。JSON 模式按模型能力启用。'),
  preset('gateway', 'DualLens 本机网关', 'http://127.0.0.1:18790/v1', false,
    'https://github.com/ray-oriental/duallens#readme', '桌面可选增强，需手动启动本机网关。不会自动启用订阅或其他账号。', { kind: 'gateway', jsonMode: true, timeoutMs: 130000 }),
  preset('custom', '自定义 OpenAI 兼容接口', '', false,
    '', '填写完整兼容 API 基础地址。可选 API key 仅存本机；JSON 模式默认关闭。'),
  preset('mock', 'Mock 测试（不联网）', '', false, '', '离线返回【译】前缀，不使用账号或模型服务。', { kind: 'mock', model: 'mock' }),
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

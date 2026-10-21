// The same destination inventory drives disclosure and the worker's mandatory consent gate.
import { providerChain } from './settings.js';
import { llmDestination, mtDestination, loadDeviceState, needsConfirmation } from './device-state.js';
import { DLError } from './errors.js';
import { ERR } from './protocol.js';

const NAMES = { microsoft:'微软机器翻译', google:'谷歌机器翻译', 'microsoft-api':'微软 Translator', deepl:'DeepL' };
const HOSTS = { microsoft:'edge.microsoft.com / api-edge.cognitive.microsofttranslator.com', google:'clients5.google.com',
  'microsoft-api':'api.cognitive.microsofttranslator.com', deepl:'api.deepl.com / api-free.deepl.com' };
export function requestDestinations(s, req = {}) {
  let chain = providerChain(s);
  if (req.profileId !== undefined) {
    const profile = s.provider.profiles.find(p => p.id === req.profileId);
    if (profile) chain = [{profile, model:req.model || profile.model}, ...chain];
  }
  chain = chain.filter(c => c.model?.trim() && (c.profile.kind === 'mock' || c.profile.baseUrl));
  const mode = req.mode || s.translation?.mode || 'mt+llm', dests = [];
  if (mode !== 'llm') {
    const engine = s.translation?.mt?.engine || 'microsoft';
    const engines = [engine, ...(['microsoft','google'].includes(engine) && s.translation?.mt?.fallback !== false
      ? [engine === 'microsoft' ? 'google' : 'microsoft'] : [])];
    for (const id of engines) dests.push({id:mtDestination(id), name:NAMES[id] || id, host:HOSTS[id] || '',
      fallback:engine === 'microsoft' && id === 'google'});
  }
  if (mode !== 'mt') for (const {profile} of chain) if (profile.kind !== 'mock') {
    const id = llmDestination(profile.baseUrl);
    if (id) dests.push({id, name:profile.name || new URL(profile.baseUrl).hostname, host:new URL(profile.baseUrl).host});
  }
  return dests.filter((d,i,a) => a.findIndex(x => x.id === d.id) === i);
}
export function destinationMessage(d) {
  if (d.fallback) return `微软失败时才用谷歌，本页文字会发送到 ${d.host}。`;
  return `将使用 ${d.name} 翻译，本页文字${d.id.startsWith('llm:') ? '和标题' : ''}会发送到 ${d.host}。`;
}
export function createConfirmationGuard(localArea) {
  return async (settings, req) => {
    const state = await loadDeviceState(localArea);
    const destination = requestDestinations(settings, req).find(d => needsConfirmation(state, d.id));
    if (destination) throw new DLError(ERR.CONFIRMATION_REQUIRED, destinationMessage(destination), {destination});
  };
}

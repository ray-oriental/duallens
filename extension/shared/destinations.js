import { t as l10n } from './i18n.js';
// The same destination inventory drives disclosure and the worker's mandatory consent gate.
import { providerChain } from './settings.js';
import { llmDestination, mtDestination, loadDeviceState, needsConfirmation } from './device-state.js';
import { DLError } from './errors.js';
import { ERR } from './protocol.js';

const NAMES = { get microsoft(){return l10n('m7x');}, get google(){return l10n('m7y');}, get 'microsoft-api'(){return l10n('m7z');}, deepl:'DeepL' };
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
    if (id) dests.push({id, name:profile.name?.trim() || new URL(profile.baseUrl).hostname, host:new URL(profile.baseUrl).host});
  }
  return dests.filter((d,i,a) => a.findIndex(x => x.id === d.id) === i);
}
export function destinationMessage(d) {
  if (d.fallback) return l10n('m80');
  if (d.id === 'mt:microsoft') return l10n('consentMicrosoft');
  return d.id.startsWith('llm:')?l10n('polishConsentAI',[d.name.trim()]):l10n('polishConsentMT',[d.name.trim()]);
}
export function destinationNotice(dests) {
  const pair=dests.some(d=>d.id==='mt:microsoft')&&dests.some(d=>d.id==='mt:google'&&d.fallback);
  return {message:dests.filter(d=>!pair||!d.fallback).map(d=>pair&&d.id==='mt:microsoft'?l10n('consentMicrosoftFallback'):destinationMessage(d)).join('\n'),
    details:dests.map(d=>d.name.trim()+': '+d.host).join('\n')};
}
export function createConfirmationGuard(localArea) {
  return async (settings, req) => {
    const state = await loadDeviceState(localArea);
    const destination = requestDestinations(settings, req).find(d => needsConfirmation(state, d.id));
    if (destination) throw new DLError(ERR.CONFIRMATION_REQUIRED, destinationMessage(destination), {destination});
  };
}

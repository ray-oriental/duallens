// One-shot message handlers (SPEC §4.2), kept free of chrome.* so they can be unit tested.
// Every handler resolves to { ok: true, ... } or { ok: false, error: { code, message } } and never rejects.

import {
  ERR,
  MSG_TRANSLATE_TEXT,
  MSG_LIST_MODELS,
  MSG_PROVIDER_TEST,
  MSG_CACHE_STATS,
  MSG_CACHE_CLEAR,
  MSG_OPEN_OPTIONS,
} from '../shared/protocol.js';
import { buildMessages, parseSegments } from '../shared/prompt.js';
import { stripMarkup } from '../shared/markup.js';
import { DLError, toErrorInfo } from '../shared/errors.js';
import { profileProblem } from './providers.js';
import { profileFromPreset } from '../shared/presets.js';

const MAX_TEXT_CHARS = 20000;

export function createHandlers({ translator, cache, providers, getSettings, openOptions = async () => {}, now = () => Date.now() }) {
  const wrap = (fn) => async (msg, sender) => {
    try {
      return await fn(msg || {}, sender);
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) };
    }
  };

  async function profileById(id) {
    const settings = await getSettings();
    const profile = settings.provider.profiles.find((p) => p.id === id);
    if (!profile) throw new DLError(ERR.CONFIG, `找不到模型配置：${id}`);
    return profile;
  }

  return {
    [MSG_TRANSLATE_TEXT]: wrap(async (msg) => {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (!text.trim()) throw new DLError(ERR.CONFIG, '没有要翻译的文字');
      if (text.length > MAX_TEXT_CHARS) throw new DLError(ERR.CONFIG, `文字太长（上限 ${MAX_TEXT_CHARS} 字）`);
      const settings = await getSettings();
      const out = await translator.translateText({
        text,
        to: msg.to || settings.targetLang,
        from: msg.from || settings.sourceLang,
        ...(msg.profileId !== undefined || msg.model !== undefined ? { profileId: msg.profileId, model: msg.model } : {}),
      });
      return { ok: true, text: out };
    }),

    [MSG_LIST_MODELS]: wrap(async (msg) => {
      const profile = msg.presetId ? profileFromPreset(msg.presetId) : await profileById(msg.profileId);
      return { ok: true, models: await providers.listModels(profile, { freeOnly: msg.freeOnly !== false }) };
    }),

    [MSG_PROVIDER_TEST]: wrap(async (msg) => {
      const profile = await profileById(msg.profileId);
      const problem = profileProblem(profile);
      if (problem) throw new DLError(ERR.CONFIG, problem);
      const { messages, idMap } = buildMessages({
        items: [{ id: 1, text: 'Hello, world.' }],
        to: 'zh-CN',
        from: 'en',
        context: {},
        preset: 'general',
        custom: '',
        glossary: [],
      });
      const started = now();
      const content = await providers.chat({ profile, model: profile.model, messages });
      const latencyMs = now() - started;
      const parsed = parseSegments(content, idMap).results.get(1);
      return { ok: true, latencyMs, sample: stripMarkup(parsed ?? content).trim().slice(0, 200) };
    }),

    [MSG_CACHE_STATS]: wrap(async () => ({ ok: true, entries: await cache.count() })),

    [MSG_CACHE_CLEAR]: wrap(async () => {
      await cache.clear();
      return { ok: true, entries: 0 };
    }),

    // content scripts cannot call chrome.runtime.openOptionsPage() themselves
    [MSG_OPEN_OPTIONS]: wrap(async () => {
      await openOptions();
      return { ok: true };
    }),
  };
}

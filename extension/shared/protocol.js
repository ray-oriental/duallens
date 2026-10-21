// Message contract between content scripts, background and UI pages.
// Owned by leader; see docs/SPEC.md §4. Change the spec first, then this file.

export const PORT_TRANSLATE = 'dl-translate';

// content -> background, over the PORT_TRANSLATE port
export const MSG_TRANSLATE = 'translate';
export const MSG_CANCEL = 'cancel';
// background -> content, over the same port
export const MSG_PARTIAL = 'partial';
export const MSG_DONE = 'done';

// one-shot chrome.runtime.sendMessage requests (UI/content -> background)
export const MSG_TRANSLATE_TEXT = 'translate-text';
export const MSG_LIST_MODELS = 'list-models';
export const MSG_PROVIDER_TEST = 'provider-test';
export const MSG_CACHE_STATS = 'cache-stats';
export const MSG_CACHE_CLEAR = 'cache-clear';
export const MSG_OPEN_OPTIONS = 'open-options'; // content scripts cannot call openOptionsPage()

// background/popup -> content via chrome.tabs.sendMessage
export const MSG_COMMAND = 'command';
export const MSG_GET_STATE = 'get-state';
export const MSG_TRANSLATE_SELECTION = 'translate-selection';

export const COMMANDS = Object.freeze({
  TOGGLE_PAGE: 'toggle-page',
  TOGGLE_TRANSLATION_ONLY: 'toggle-translation-only',
  TRANSLATE_INPUT: 'translate-input',
  TOGGLE_HOVER: 'toggle-hover',
});

// priority: lower number is served first
export const PRIORITY = Object.freeze({ VISIBLE: 0, NEAR: 1, PREFETCH: 2 });

// error.code values carried in partial results and one-shot responses
export const ERR = Object.freeze({
  CONFIRMATION_REQUIRED: 'confirmation-required',
  RATE_LIMITED: 'rate_limited',
  PROVIDER: 'provider_error',
  NETWORK: 'network_error',
  PARSE: 'parse_error',
  CANCELLED: 'cancelled',
  CONFIG: 'config_error',
});

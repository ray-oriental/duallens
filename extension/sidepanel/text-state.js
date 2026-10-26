import { LANGS } from '../shared/settings.js';
import { normalizeLang } from '../shared/lang.js';

export const CANCELLED = Symbol('cancelled');

export function detectedSource(result) {
  if (!result || result.reliable === false) return '';
  const lang = normalizeLang(result.lang);
  return LANGS.some(item => item.code === lang) ? lang : '';
}

export function swappedLanguages(from, to, detected) {
  const source = from === 'auto' ? detected : from;
  return LANGS.some(item => item.code === source) ? { from: to, to: source } : null;
}

// Release the view immediately even when a platform RPC cannot abort its transport.
// Both handlers remain attached to the task so a late rejection is still consumed.
export function untilAborted(work, signal) {
  if (signal.aborted) return Promise.resolve(CANCELLED);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); resolve(CANCELLED); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => signal.aborted ? CANCELLED : work()).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

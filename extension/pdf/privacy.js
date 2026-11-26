const PRIVATE_KEY = 'duallens.pdf.private';

// The source can be private even when a spanning reader opens in a normal window.
export function pdfPrivacy({ params, inIncognitoContext, tab, storage, sessions }) {
  let marked = false;
  try { marked = storage.getItem(PRIVATE_KEY) === '1'; } catch { /* storage unavailable */ }
  const privateSource = params.get('private') === '1' || inIncognitoContext === true || tab?.incognito === true || marked;
  let remembered = false;
  if (privateSource) {
    try { storage.setItem(PRIVATE_KEY, '1'); remembered = true; } catch { /* retain the URL flag instead */ }
  }
  return {
    privateSource,
    // Never open the reading database for a private source, including inherited session IDs.
    sessions: privateSource ? { put: async () => null, get: async () => null } : sessions,
    cleanURL: pathname => pathname + (privateSource && !remembered ? '?private=1' : ''),
    translator(service) {
      if (!privateSource) return service;
      return { ...service, translateBatch: (request, onPartial) => service.translateBatch({ ...request, incognito: true }, onPartial) };
    },
  };
}

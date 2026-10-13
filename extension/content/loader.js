// Classic content script, injected on every page. Kept tiny: it only decides whether the real
// content modules are worth loading, then imports them (content scripts cannot be ES modules).
// Importing main.js twice is a no-op (module cache), so the popup may inject this file again.
(async () => {
  try {
    if (!(document.documentElement instanceof HTMLElement)) return; // SVG / XML documents
    if (document.contentType && !/html/i.test(document.contentType)) return;

    const { loadSettings, siteRuleFor } = await import(chrome.runtime.getURL('shared/settings.js'));
    const settings = await loadSettings();
    await import(chrome.runtime.getURL('content/main.js'));
  } catch (e) {
    // extension reloaded under an old tab, or a blocked-resource edge case: stay silent
    void e;
  }
})();

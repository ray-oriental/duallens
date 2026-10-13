// Classic MV3 loader. Module caching plus start() keeps repeated injection idempotent.
(async () => {
  try {
    if (!(document.documentElement instanceof HTMLElement)) return;
    if (document.contentType && !/html/i.test(document.contentType)) return;
    const { createExtensionPlatform } = await import(chrome.runtime.getURL('platform/extension.js'));
    const { start } = await import(chrome.runtime.getURL('content/main.js'));
    await start(createExtensionPlatform());
  } catch { /* stale extension context or blocked resource: stay silent */ }
})();

// Classic MV3 loader. Module caching plus start() keeps repeated injection idempotent.
(() => {
  const marker = Symbol.for('duallens.loader.ready');
  if (globalThis[marker]) return;
  const listener = (msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'tab-ready') return false;
    globalThis[marker].then(ok => reply({ ok }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  globalThis[marker] = (async () => {
  try {
    if (!(document.documentElement instanceof HTMLElement)) return false;
    if (document.contentType && !/html/i.test(document.contentType)) return false;
    const { createExtensionPlatform } = await import(chrome.runtime.getURL('platform/extension.js'));
    const platform=createExtensionPlatform();
    platform.contentCSS=await (await fetch(chrome.runtime.getURL('styles/content.css'))).text();
    if(window!==window.top) {
      const {startFrameAgent}=await import(chrome.runtime.getURL('content/frame-agent.js'));
      startFrameAgent(platform);
    } else {
      const { start } = await import(chrome.runtime.getURL('content/main.js'));
      await start(platform);
    }
    return true;
  } catch { return false; /* stale extension context or blocked resource: stay silent */ }
  })();
  void globalThis[marker].then(ok => {
    if (!ok) { chrome.runtime.onMessage.removeListener(listener); delete globalThis[marker]; }
  });
})();

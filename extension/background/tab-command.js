import { COMMANDS, MSG_COMMAND } from '../shared/protocol.js';

// The shortcut and existing page menu share exactly the same PDF fallback.
export function createTabCommandHandler(api, tabInjector, pdfEntries) {
  return async function handleTabCommand(tabId, message) {
    if (tabId == null) return null;
    try {
      if ((await tabInjector.ensure(tabId)).ok)
        return await api.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => null);
      if (message.type !== MSG_COMMAND || message.name !== COMMANDS.TOGGLE_PAGE) return null;
      // Only a confirmed PDF is switched. Tabs whose address the browser hides (new tab, browser pages,
      // local files without file access) are left untouched; the popup offers the local chooser there.
      const tab = await api.tabs.get(tabId);
      const status = await pdfEntries.status(tab, { probe: false });
      return status.available ? await pdfEntries.open(tab, { translate: true, knownStatus: status }) : null;
    } catch { return null; }
  };
}

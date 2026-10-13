// Keep the sidePanel open call inside the command event's user gesture. This
// separate listener lets the existing page commands keep their routing unchanged.
export function registerSidePanelCommand(api) {
  const listener = (command, tab) => {
    if (command !== 'open-sidepanel') return;
    if (tab?.id != null) {
      void api.sidePanel.open({ tabId: tab.id }).catch(() => {});
    } else {
      void api.windows.getCurrent().then(window => api.sidePanel.open({ windowId: window.id })).catch(() => {});
    }
  };
  api.commands.onCommand.addListener(listener);
  return () => api.commands.onCommand.removeListener(listener);
}

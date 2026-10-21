const TEXT = { popup: 'DualLens' };
// Register immediately; panel code is loaded only on the menu gesture.
export function registerPopupMenu({ platform, pageMessage }) {
  let panel;
  platform.registerCommand('duallens', TEXT.popup, async () => {
    try {
      const mount = await platform.loadSettingsForm();
      panel ||= mount.createPopupPanel({ store: platform.settingsStore, platform,
        loadSettingsForm: platform.loadSettingsForm, pageMessage });
      await panel.open();
    } catch { platform.showResourceError(); }
  });
}

// Adapt extension storage without leaking chrome.* into reusable forms.
export function chromeStorageArea(area, name, changed) {
  return {
    get: keys => area.get(keys),
    set: items => area.set(items),
    remove: keys => area.remove ? area.remove(keys) : Promise.resolve(),
    onChanged(cb) {
      const listener = (changes, areaName) => { if (areaName === name) cb(changes); };
      changed?.addListener(listener);
      return () => changed?.removeListener(listener);
    },
  };
}

// Device-local UI state. Never synced, never exported, and not reset by "restore defaults":
// each device confirms for itself where text may be sent.
export const DEVICE_STATE_KEY = 'ui.device';

const EMPTY = Object.freeze({ onboarded: false, acked: [], upgradeNoticeSeen: false });

function normalize(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  return {
    onboarded: v.onboarded === true,
    acked: Array.isArray(v.acked) ? [...new Set(v.acked.filter((x) => typeof x === 'string' && x.length <= 300))] : [],
    upgradeNoticeSeen: v.upgradeNoticeSeen === true,
  };
}

export async function loadDeviceState(localArea) {
  const got = await localArea.get(DEVICE_STATE_KEY);
  return normalize(got?.[DEVICE_STATE_KEY] ?? EMPTY);
}

export async function updateDeviceState(localArea, patch) {
  const next = normalize({ ...(await loadDeviceState(localArea)), ...patch });
  await localArea.set({ [DEVICE_STATE_KEY]: next });
  return next;
}

// A destination is where translation text goes: 'mt:<engine>' or 'llm:<origin>' (scheme://host[:port]).
export function mtDestination(engine) {
  return `mt:${String(engine || 'microsoft')}`;
}

export function llmDestination(baseUrl) {
  try {
    return `llm:${new URL(baseUrl).origin}`;
  } catch {
    return null;
  }
}

// Loopback and the demo profile never leave the machine, so they need no confirmation.
export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function needsConfirmation(state, destination) {
  if (!destination || destination === 'mt:mock') return false;
  if (destination.startsWith('llm:') && isLocalUrl(destination.slice(4))) return false;
  return !normalize(state).acked.includes(destination);
}

export async function acknowledge(localArea, destination) {
  const state = await loadDeviceState(localArea);
  if (!destination || state.acked.includes(destination)) return state;
  return updateDeviceState(localArea, { acked: [...state.acked, destination] });
}

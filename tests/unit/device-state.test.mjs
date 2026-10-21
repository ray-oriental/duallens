import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDeviceState, updateDeviceState, acknowledge, needsConfirmation, mtDestination, llmDestination, isLocalUrl, DEVICE_STATE_KEY } from '../../extension/shared/device-state.js';
import { originPattern, featureNeedsBroad, hasBroad, requestBroad, requestOrigin } from '../../extension/shared/permissions.js';

function memoryArea() {
  const data = {};
  return { data, get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (o) => { Object.assign(data, o); } };
}

test('device state defaults, normalizes and acknowledges each destination once', async () => {
  const area = memoryArea();
  assert.deepEqual(await loadDeviceState(area), { onboarded: false, acked: [], upgradeNoticeSeen: false });
  area.data[DEVICE_STATE_KEY] = { onboarded: 'yes', acked: ['mt:microsoft', 'mt:microsoft', 7], extra: 1 };
  assert.deepEqual(await loadDeviceState(area), { onboarded: false, acked: ['mt:microsoft'], upgradeNoticeSeen: false });
  await acknowledge(area, llmDestination('https://api.example.com/v1'));
  await acknowledge(area, llmDestination('https://api.example.com/v1/chat'));
  assert.deepEqual((await loadDeviceState(area)).acked, ['mt:microsoft', 'llm:https://api.example.com']);
  assert.equal((await updateDeviceState(area, { onboarded: true })).onboarded, true);
});

test('confirmation is skipped only for local endpoints and the demo engine', () => {
  const state = { acked: ['mt:microsoft'] };
  assert.equal(needsConfirmation(state, mtDestination('microsoft')), false);
  assert.equal(needsConfirmation(state, mtDestination('google')), true);
  assert.equal(needsConfirmation(state, 'mt:mock'), false);
  assert.equal(needsConfirmation(state, llmDestination('http://127.0.0.1:11434/v1')), false);
  assert.equal(needsConfirmation(state, llmDestination('http://localhost:1234/v1')), false);
  assert.equal(needsConfirmation(state, llmDestination('http://192.168.1.5:11434/v1')), true);
  assert.equal(isLocalUrl('http://[::1]:8080/'), true);
  assert.equal(llmDestination('not a url'), null);
});

test('permission helpers: origin patterns, persistent features, userscript fallback', async () => {
  assert.equal(originPattern('https://api.example.com:8443/v1'), 'https://api.example.com:8443/*');
  assert.equal(originPattern('ftp://x/'), null);
  assert.equal(featureNeedsBroad('floatBall'), true);
  assert.equal(featureNeedsBroad('subtitles'), false);
  const saved = globalThis.chrome;
  delete globalThis.chrome;
  try {
    assert.equal(await hasBroad(), true);
    assert.equal(await requestBroad(), true);
  } finally { if (saved) globalThis.chrome = saved; }
  const calls = [];
  const api = { permissions: { contains: async () => false, request: async (p) => { calls.push(p); return true; } } };
  assert.equal(await hasBroad(api), false);
  assert.equal(await requestOrigin('https://api.example.com/v1', api), true);
  assert.deepEqual(calls, [{ origins: ['https://api.example.com/*'] }]);
});

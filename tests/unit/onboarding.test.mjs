import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStepCount } from '../../extension/ui/popup-view.js';
import { localPDFAccess } from '../../extension/ui/local-pdf-access.js';

test('only extensions without file access need four onboarding steps', () => {
  assert.equal(onboardingStepCount('extension', false), 4);
  assert.equal(onboardingStepCount('extension', true), 3);
  assert.equal(onboardingStepCount('userscript', false), 3);
  assert.equal(onboardingStepCount('userscript', true), 3);
});

test('local PDF capability reads permission and opens only this installation details', async () => {
  const calls = [];
  const access = localPDFAccess({
    extension: { isAllowedFileSchemeAccess: async () => false },
    runtime: { id: 'fixture-extension' },
    tabs: { create: async options => calls.push(options) },
  });
  assert.equal(await access.allowed(), false);
  await access.openDetails();
  assert.deepEqual(calls, [{ url: 'chrome://extensions/?id=fixture-extension' }]);
});

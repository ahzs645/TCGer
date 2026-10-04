import assert from 'node:assert/strict';
import test from 'node:test';
import { selectSimulator } from './select-ios-simulator.mjs';
test('duplicate names across runtimes select one deterministic UUID; a booted device wins', () => {
  const inventory = { devices: {
    'iOS-26-4': [{ name: 'iPhone 17 Pro', udid: 'older', state: 'Shutdown' }],
    'iOS-26-5': [{ name: 'iPhone 17 Pro', udid: 'newer', state: 'Shutdown' }],
  } };
  assert.equal(selectSimulator(inventory), 'newer');
  inventory.devices['iOS-26-4'][0].state = 'Booted';
  assert.equal(selectSimulator(inventory), 'older');
});
test('unavailable and absent devices never produce an unusable UUID', () => {
  assert.throws(() => selectSimulator({ devices: { ios: [{ name: 'iPhone 17 Pro', isAvailable: false }] } }));
});

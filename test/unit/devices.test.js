/**
 * Unit tests — src/devices.js (createDeviceStore factory)
 * Run with: node --test test/unit/devices.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceStore } from '../../src/devices.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStore() {
  const dir   = mkdtempSync(join(tmpdir(), 'trmnl-devices-test-'));
  const store = createDeviceStore(dir, 'TEST');
  return { dir, store };
}

function cleanUp(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ─── createDeviceStore ────────────────────────────────────────────────────────

describe('createDeviceStore.getOrCreate', () => {
  test('creates a new device on first call', () => {
    const { dir, store } = makeStore();
    const device = store.getOrCreate('AA:BB:CC:DD:EE:FF');

    assert.equal(device.mac, 'AA:BB:CC:DD:EE:FF');
    assert.ok(typeof device.apiKey    === 'string', 'apiKey should be a string');
    assert.ok(typeof device.friendlyId === 'string', 'friendlyId should be a string');
    assert.ok(typeof device.createdAt  === 'string', 'createdAt should be an ISO string');
    assert.ok(device.apiKey.length === 32, 'apiKey should be 32 hex chars (16 bytes)');

    cleanUp(dir);
  });

  test('uses the vesselPrefix for friendlyId', () => {
    const { dir, store } = makeStore(); // prefix = TEST
    const device = store.getOrCreate('00:11:22:33:44:55');
    assert.ok(device.friendlyId.startsWith('TEST'), `Expected TEST prefix but got: ${device.friendlyId}`);
    cleanUp(dir);
  });

  test('friendlyId is zero-padded to at least 2 digits', () => {
    const { dir, store } = makeStore();
    const device = store.getOrCreate('00:11:22:33:44:55');
    assert.match(device.friendlyId, /TEST\d{2,}/);
    cleanUp(dir);
  });

  test('returns the same record on a second call for the same MAC', () => {
    const { dir, store } = makeStore();
    const first  = store.getOrCreate('AA:BB:CC:DD:EE:01');
    const second = store.getOrCreate('AA:BB:CC:DD:EE:01');

    assert.equal(first.apiKey,     second.apiKey);
    assert.equal(first.friendlyId, second.friendlyId);
    assert.equal(first.createdAt,  second.createdAt);

    cleanUp(dir);
  });

  test('persists device to devices.json', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:BB:CC:DD:EE:FF');
    const storePath = join(dir, 'devices.json');
    assert.ok(existsSync(storePath), 'devices.json should be created');
    const contents = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.ok(contents['AA:BB:CC:DD:EE:FF'], 'device should be in the JSON file');
    cleanUp(dir);
  });

  test('generates distinct records for different MACs', () => {
    const { dir, store } = makeStore();
    const d1 = store.getOrCreate('AA:00:00:00:00:01');
    const d2 = store.getOrCreate('AA:00:00:00:00:02');

    assert.notEqual(d1.apiKey,     d2.apiKey,     'apiKeys should differ');
    assert.notEqual(d1.friendlyId, d2.friendlyId, 'friendlyIds should differ');

    cleanUp(dir);
  });

  test('increments friendlyId counter for each new device', () => {
    const { dir, store } = makeStore();
    const d1 = store.getOrCreate('AA:00:00:00:00:01');
    const d2 = store.getOrCreate('AA:00:00:00:00:02');
    const d3 = store.getOrCreate('AA:00:00:00:00:03');

    const nums = [d1, d2, d3].map(d => parseInt(d.friendlyId.replace(/\D/g, ''), 10));
    assert.deepEqual(nums, [1, 2, 3]);

    cleanUp(dir);
  });
});

describe('createDeviceStore.get', () => {
  test('returns null for an unknown MAC', () => {
    const { dir, store } = makeStore();
    assert.equal(store.get('DE:AD:BE:EF:00:00'), null);
    cleanUp(dir);
  });

  test('returns the device after it has been created', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:BB:CC:00:00:01');
    const device = store.get('AA:BB:CC:00:00:01');
    assert.ok(device !== null);
    assert.equal(device.mac, 'AA:BB:CC:00:00:01');
    cleanUp(dir);
  });
});

describe('createDeviceStore.updateTelemetry', () => {
  test('does nothing for an unknown MAC', () => {
    const { dir, store } = makeStore();
    // Should not throw
    assert.doesNotThrow(() => store.updateTelemetry('00:00:00:00:00:00', { battery: '12.4' }));
    cleanUp(dir);
  });

  test('stores lastSeen timestamp after update', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:BB:CC:DD:EE:FF');

    const before = Date.now();
    store.updateTelemetry('AA:BB:CC:DD:EE:FF', { battery: '12.4', wifi: '-60', firmware: '1.2.3' });
    const after = Date.now();

    const device = store.get('AA:BB:CC:DD:EE:FF');
    const lastSeen = new Date(device.lastSeen).getTime();

    assert.ok(lastSeen >= before && lastSeen <= after, 'lastSeen should be between before/after timestamps');

    cleanUp(dir);
  });

  test('stores telemetry fields', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:BB:CC:DD:EE:FF');
    store.updateTelemetry('AA:BB:CC:DD:EE:FF', { battery: '12.4', wifi: '-60', firmware: '1.2.3' });

    const device = store.get('AA:BB:CC:DD:EE:FF');
    assert.equal(device.lastTelemetry.battery, '12.4');
    assert.equal(device.lastTelemetry.wifi, '-60');
    assert.equal(device.lastTelemetry.firmware, '1.2.3');

    cleanUp(dir);
  });

  test('sets null for missing telemetry fields', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:BB:CC:DD:EE:FF');
    store.updateTelemetry('AA:BB:CC:DD:EE:FF', {});

    const device = store.get('AA:BB:CC:DD:EE:FF');
    assert.equal(device.lastTelemetry.battery,  null);
    assert.equal(device.lastTelemetry.wifi,     null);
    assert.equal(device.lastTelemetry.firmware, null);

    cleanUp(dir);
  });
});

describe('createDeviceStore.list', () => {
  test('returns empty array when no devices registered', () => {
    const { dir, store } = makeStore();
    assert.deepEqual(store.list(), []);
    cleanUp(dir);
  });

  test('returns all registered devices', () => {
    const { dir, store } = makeStore();
    store.getOrCreate('AA:00:00:00:00:01');
    store.getOrCreate('AA:00:00:00:00:02');
    store.getOrCreate('AA:00:00:00:00:03');

    const all = store.list();
    assert.equal(all.length, 3);
    const macs = all.map(d => d.mac).sort();
    assert.deepEqual(macs, ['AA:00:00:00:00:01', 'AA:00:00:00:00:02', 'AA:00:00:00:00:03']);

    cleanUp(dir);
  });
});

describe('createDeviceStore persistence', () => {
  test('survives a fresh store instance pointed at the same dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trmnl-devices-persist-'));
    const store1 = createDeviceStore(dir, 'TEST');
    const created = store1.getOrCreate('FF:FF:FF:FF:FF:FF');

    // Simulate a server restart — new instance, same directory
    const store2 = createDeviceStore(dir, 'TEST');
    const loaded  = store2.get('FF:FF:FF:FF:FF:FF');

    assert.ok(loaded !== null, 'device should persist across instances');
    assert.equal(loaded.apiKey,     created.apiKey,     'apiKey should be stable');
    assert.equal(loaded.friendlyId, created.friendlyId, 'friendlyId should be stable');

    rmSync(dir, { recursive: true, force: true });
  });
});

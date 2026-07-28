import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCommonHeaders,
  buildCommonParams,
  createRandomDeviceProfile
} from '../src/core/fq-device-profile.mjs';
import { DeviceProfileStore } from '../src/core/device-profile-store.mjs';

test('generates a coherent replacement device profile', () => {
  let byteSeed = 0;
  const profile = createRandomDeviceProfile({
    randomIndex: () => 0,
    randomBytes: (size) => {
      byteSeed += 1;
      return Buffer.alloc(size, byteSeed);
    },
    randomUUID: () => '11111111-2222-4333-8444-555555555555'
  });

  assert.equal(profile.deviceBrand, 'Xiaomi');
  assert.equal(profile.deviceType, '24031PN0DC');
  assert.equal(profile.osVersion, '10');
  assert.equal(profile.osApi, '29');
  assert.match(profile.deviceId, /^\d{16}$/);
  assert.match(profile.installId, /^\d{16}$/);
  assert.notEqual(profile.deviceId, profile.installId);
  assert.equal(profile.cdid, '11111111-2222-4333-8444-555555555555');
  assert.match(profile.cookie, new RegExp(`install_id=${profile.installId};`));
  assert.match(profile.userAgent, /Android 10; zh_CN; 24031PN0DC; Build\/V291IR/);

  const params = buildCommonParams(profile, 123);
  const headers = new Map(buildCommonHeaders(profile, 123, () => 0));
  assert.equal(params.get('device_id'), profile.deviceId);
  assert.equal(params.get('iid'), profile.installId);
  assert.equal(params.get('cdid'), profile.cdid);
  assert.equal(headers.get('cookie'), profile.cookie);
  assert.equal(headers.get('user-agent'), profile.userAgent);
});

test('persists a rotated device profile across application restarts', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fqnovel-device-'));
  let sequence = 0;
  const generator = () => {
    sequence += 1;
    return createRandomDeviceProfile({
      randomIndex: () => 0,
      randomBytes: (size) => Buffer.alloc(size, sequence),
      randomUUID: () => `11111111-2222-4333-8444-${String(sequence).padStart(12, '0')}`
    });
  };

  try {
    const store = new DeviceProfileStore({ dataDir, generator });
    const before = store.get();
    const after = store.rotate();

    assert.equal(store.status().generation, 2);
    assert.notEqual(after.deviceId, before.deviceId);
    assert.equal(
      JSON.parse(readFileSync(path.join(dataDir, 'device-profile.json'), 'utf8')).deviceId,
      after.deviceId
    );

    const restored = new DeviceProfileStore({ dataDir });
    assert.equal(restored.get().deviceId, after.deviceId);
    assert.equal(restored.status().generation, 2);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

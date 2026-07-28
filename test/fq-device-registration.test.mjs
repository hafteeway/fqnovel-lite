import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { FqDeviceRegistrationService } from '../src/core/fq-device-registration.mjs';
import { createDeviceProfile } from '../src/core/fq-device-profile.mjs';

test('registers a generated device and uses the upstream-issued identifiers', async () => {
  let request;
  const registration = new FqDeviceRegistrationService({
    now: () => 1_750_000_000_000,
    randomBytes: (size) => Buffer.alloc(size, 7),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        device_id: '8897460456777783',
        install_id: '9572027561010387'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const registered = await registration.register(createDeviceProfile({
    deviceBrand: 'vivo',
    deviceType: 'V2118A',
    osVersion: '11',
    osApi: '30'
  }));

  assert.match(request.url, /\/service\/2\/device_register\//);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  const body = JSON.parse(request.options.body);
  assert.equal(body.magic_tag, 'ss_app_log');
  assert.equal(body.header.device_brand, 'vivo');
  assert.equal(body.header.device_model, 'V2118A');
  assert.equal(body._gen_time, 1_750_000_000_000);
  assert.equal(registered.deviceId, '8897460456777783');
  assert.equal(registered.installId, '9572027561010387');
  assert.match(registered.cookie, /install_id=9572027561010387;/);
  assert.equal(registered.registeredAt, 1_750_000_000_000);
});

test('rejects a registration response without upstream-issued identifiers', async () => {
  const registration = new FqDeviceRegistrationService({
    randomBytes: (size) => Buffer.alloc(size, 3),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    fetch: async () => new Response(JSON.stringify({ message: 'invalid device' }), { status: 200 })
  });

  await assert.rejects(
    registration.register(createDeviceProfile()),
    (error) => error.code === 'DEVICE_REGISTER_REJECTED' && error.message === 'invalid device'
  );
});

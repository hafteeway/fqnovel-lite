import test from 'node:test';
import assert from 'node:assert/strict';
import { BookSourceServer, findLanAddress } from '../src/core/book-source-server.mjs';

test('serves local and LAN addresses from one listener', async () => {
  const server = new BookSourceServer({ host: '0.0.0.0', port: 0 });
  await server.start();
  try {
    const status = server.status();
    assert.equal(status.host, '0.0.0.0');
    assert.match(status.localBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(status.lanBaseUrl, /^http:\/\/[^:]+:\d+$/);
    const health = await fetch(`${status.localBaseUrl}/api/v1/health`);
    assert.equal(health.status, 200);
  } finally {
    await server.stop();
  }
});

test('prefers a physical LAN adapter over TUN and virtual adapters', () => {
  const address = findLanAddress({
    singbox_tun: [{
      address: '172.18.0.1',
      family: 'IPv4',
      internal: false
    }],
    '以太网 2': [{
      address: '10.102.108.138',
      family: 'IPv4',
      internal: false
    }],
    'vEthernet (WSL)': [{
      address: '172.29.64.1',
      family: 'IPv4',
      internal: false
    }]
  });
  assert.equal(address, '10.102.108.138');
});

test('falls back to an available virtual address and then loopback', () => {
  assert.equal(findLanAddress({
    tailscale0: [{
      address: '100.64.0.2',
      family: 'IPv4',
      internal: false
    }]
  }), '100.64.0.2');
  assert.equal(findLanAddress({}), '127.0.0.1');
});

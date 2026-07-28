import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AppRuntime } from '../src/core/app-runtime.mjs';

test('reports refreshing and maintenance for the complete worker refresh window', async () => {
  let finishRefresh;
  const refreshGate = new Promise((resolve) => {
    finishRefresh = resolve;
  });

  const worker = Object.assign(new EventEmitter(), {
    status: () => ({ state: 'ready' }),
    refresh: () => refreshGate,
    start: async () => {},
    stop: async () => {}
  });
  const server = Object.assign(new EventEmitter(), {
    maintenance: false,
    setMaintenance(enabled) {
      this.maintenance = enabled;
      this.emit('status', this.status());
    },
    status() {
      return {
        state: 'running',
        mode: 'local',
        baseUrl: 'http://127.0.0.1:9999',
        maintenance: this.maintenance
      };
    },
    start: async () => {},
    stop: async () => {},
    setMode: async () => server.status()
  });
  const repository = {
    stats: () => ({ books: 0, downloadedChapters: 0, downloadTasks: 0 }),
    close: () => {}
  };
  const candidateDevice = { deviceBrand: 'Xiaomi', deviceType: '24031PN0DC' };
  const registeredDevice = { ...candidateDevice, registeredAt: 123 };
  const nextDevice = { deviceBrand: 'Xiaomi', deviceType: '24031PN0DC', generation: 2 };
  const deviceProfiles = {
    generate: () => candidateDevice,
    commit: (device) => {
      assert.equal(device, registeredDevice);
      return nextDevice;
    },
    status: () => ({
      generation: 2,
      deviceBrand: nextDevice.deviceBrand,
      deviceType: nextDevice.deviceType
    })
  };
  const deviceRegistration = {
    register: async (device) => {
      assert.equal(device, candidateDevice);
      return registeredDevice;
    }
  };
  const settings = {
    get: () => ({ exportDirectory: 'exports' })
  };
  let appliedDevice;
  const api = {
    status: () => ({}),
    clearCache: () => {},
    setDeviceProfile: (device) => {
      appliedDevice = device;
    }
  };
  const downloads = Object.assign(new EventEmitter(), {
    status: () => ({ activeTasks: 0, tasks: [] }),
    stop: async () => {}
  });

  const runtime = new AppRuntime({
    repository,
    settings,
    worker,
    deviceProfiles,
    deviceRegistration,
    server,
    api,
    downloads,
    exports: {}
  });

  const transitions = [];
  runtime.on('status', (status) => {
    transitions.push({
      refreshing: status.refreshing,
      maintenance: status.server.maintenance
    });
  });

  const refresh = runtime.refreshUnidbg();
  assert.equal(runtime.status().refreshing, true);
  assert.equal(runtime.status().server.maintenance, true);

  finishRefresh({ generation: 2 });
  await refresh;

  assert.equal(appliedDevice, nextDevice);
  assert.equal(runtime.status().refreshing, false);
  assert.equal(runtime.status().server.maintenance, false);
  assert.equal(
    transitions.some((transition) => transition.maintenance && !transition.refreshing),
    false
  );
});

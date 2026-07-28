import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AppRuntime } from '../src/core/app-runtime.mjs';

test('keeps the book source stopped by default and starts it only when enabled', async () => {
  const calls = [];
  const settingsValue = {
    exportDirectory: 'exports',
    bookSourceEnabled: false
  };
  const settings = {
    get: () => ({ ...settingsValue }),
    setBookSourceEnabled(enabled) {
      settingsValue.bookSourceEnabled = Boolean(enabled);
      calls.push(['persist', Boolean(enabled)]);
      return this.get();
    }
  };
  const worker = Object.assign(new EventEmitter(), {
    start: async () => calls.push(['worker-start']),
    stop: async () => calls.push(['worker-stop']),
    status: () => ({ state: 'ready' })
  });
  let running = false;
  const server = Object.assign(new EventEmitter(), {
    async start() {
      running = true;
      calls.push(['server-start']);
      return this.status();
    },
    async stop() {
      running = false;
      calls.push(['server-stop']);
    },
    status() {
      return {
        state: running ? 'running' : 'stopped',
        baseUrl: running ? 'http://192.168.1.2:9999' : null
      };
    }
  });
  const repository = {
    stats: () => ({ books: 0, downloadedChapters: 0, downloadTasks: 0 }),
    close: () => calls.push(['repository-close'])
  };
  const api = {
    status: () => ({}),
    clearCache: () => {}
  };
  const downloads = Object.assign(new EventEmitter(), {
    status: () => ({ activeTasks: 0, tasks: [] }),
    stop: async () => calls.push(['downloads-stop'])
  });
  const deviceProfiles = {
    status: () => ({ generation: 1 })
  };
  const runtime = new AppRuntime({
    repository,
    settings,
    worker,
    server,
    api,
    downloads,
    deviceProfiles,
    exports: {}
  });

  await runtime.start();
  assert.equal(calls.some(([name]) => name === 'server-start'), false);
  assert.equal(runtime.status().server.state, 'stopped');

  await runtime.setBookSourceEnabled(true);
  assert.equal(runtime.status().server.state, 'running');
  assert.equal(settingsValue.bookSourceEnabled, true);

  await runtime.setBookSourceEnabled(false);
  assert.equal(runtime.status().server.state, 'stopped');
  assert.equal(settingsValue.bookSourceEnabled, false);

  await runtime.stop();
});

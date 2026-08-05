#!/usr/bin/env node
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppRuntime } from '../src/core/app-runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const runtimeRoot = path.resolve(process.env.FQNOVEL_RUNTIME_ROOT || projectRoot);
const nativeParentPid = Number.parseInt(process.env.FQNOVEL_NATIVE_PARENT_PID || '', 10);
const runtime = new AppRuntime({
  dataDir: process.env.FQNOVEL_DATA_DIR || path.join(runtimeRoot, 'native-macos', '.runtime-data'),
  workerOptions: {
    cwd: runtimeRoot,
    javaBin: process.env.FQNOVEL_JAVA_BIN || undefined,
    jarPath: path.join(runtimeRoot, 'java-worker', 'target', 'unidbg-worker.jar')
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function publicStatus() {
  const { downloads, settings } = runtime.status();
  return { downloads, settings };
}

runtime.on('status', () => send({ event: 'status', data: publicStatus() }));

const actions = {
  status: () => publicStatus(),
  search: ({ query }) => runtime.searchBooks({ query }),
  downloads: () => runtime.listDownloads(),
  createDownload: ({ bookId, format }) => runtime.createDownload(bookId, { format }),
  controlDownload: ({ taskId, action }) => runtime.controlDownload(taskId, action),
  deleteDownload: ({ taskId }) => runtime.deleteDownload(taskId),
  deleteCompletedDownloads: () => runtime.deleteCompletedDownloads(),
  setExportDirectory: ({ directory }) => runtime.setExportDirectory(directory),
  setExportFormat: ({ format }) => runtime.setExportFormat(format),
  clearSearchHistory: () => runtime.clearSearchHistory()
};

try {
  await runtime.start();
  send({ event: 'ready', data: publicStatus() });
} catch (error) {
  send({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const handler = actions[request.action];
    if (!handler) throw new Error('不支持的原生应用请求');
    const data = await handler(request.payload || {});
    send({ id: request.id, data });
  } catch (error) {
    send({ id: request?.id, error: error instanceof Error ? error.message : String(error) });
  }
});

async function stop() {
  input.close();
  await runtime.stop().catch(() => {});
  process.exit(0);
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);

if (Number.isInteger(nativeParentPid) && nativeParentPid > 1) {
  const parentMonitor = setInterval(() => {
    try {
      process.kill(nativeParentPid, 0);
    } catch {
      clearInterval(parentMonitor);
      void stop();
    }
  }, 2_000);
  parentMonitor.unref();
}

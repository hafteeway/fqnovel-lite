import { AppRuntime } from './core/app-runtime.mjs';

const runtime = new AppRuntime();
runtime.on('log', ({ source, message }) => console.error(`[${source}] ${message}`));

async function shutdown() {
  await runtime.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const status = await runtime.start();
  console.log(JSON.stringify(status, null, 2));
  console.log('Press Ctrl+C to stop.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

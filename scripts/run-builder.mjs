import { spawn } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const executable = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);
const child = spawn(executable, process.argv.slice(2), {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
  shell: process.platform === 'win32'
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});

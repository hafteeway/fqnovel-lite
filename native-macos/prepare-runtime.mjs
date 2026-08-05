#!/usr/bin/env node
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const nativeDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(nativeDirectory, '..');
const destination = path.resolve(process.argv[2] || '');

if (!destination || destination === projectRoot) {
  throw new Error('请提供 App Resources 中 Runtime 的输出目录');
}

const requiredSources = [
  ['src/core', 'src/core'],
  ['native-macos/bridge.mjs', 'native-macos/bridge.mjs'],
  ['java-worker/target/unidbg-worker.jar', 'java-worker/target/unidbg-worker.jar'],
  ['vendor/jre/mac/arm64', 'jre'],
  ['node_modules/heic-convert', 'node_modules/heic-convert'],
  ['node_modules/heic-decode', 'node_modules/heic-decode'],
  ['node_modules/jpeg-js', 'node_modules/jpeg-js'],
  ['node_modules/libheif-js', 'node_modules/libheif-js']
];

for (const [from] of requiredSources) {
  await stat(path.join(projectRoot, from));
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await mkdir(path.join(destination, 'bin'), { recursive: true });
await cp(process.execPath, path.join(destination, 'bin', 'node'));
for (const [from, to] of requiredSources) {
  await cp(path.join(projectRoot, from), path.join(destination, to), { recursive: true });
}

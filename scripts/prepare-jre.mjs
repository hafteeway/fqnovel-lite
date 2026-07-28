import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import extractZip from 'extract-zip';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const requestedPlatform = process.argv[2] || platformName(process.platform);
const requestedArch = process.argv[3] || process.arch;
const target = resolveTarget(requestedPlatform, requestedArch);
const destination = path.join(projectRoot, 'vendor', 'jre', target.folderPlatform, target.folderArch);
const javaPath = path.join(destination, 'bin', target.os === 'windows' ? 'java.exe' : 'java');

if (await exists(javaPath)) {
  console.log(JSON.stringify({ state: 'ready', platform: target.folderPlatform, arch: target.folderArch, javaPath }));
  process.exit(0);
}

const metadataUrl = new URL('https://api.adoptium.net/v3/assets/latest/8/hotspot');
metadataUrl.searchParams.set('architecture', target.apiArch);
metadataUrl.searchParams.set('image_type', 'jre');
metadataUrl.searchParams.set('os', target.os);
metadataUrl.searchParams.set('vendor', 'eclipse');
metadataUrl.searchParams.set('heap_size', 'normal');

const assetsResponse = await fetch(metadataUrl, { headers: { Accept: 'application/json' } });
if (!assetsResponse.ok) throw new Error(`Temurin metadata request failed: HTTP ${assetsResponse.status}`);
const assets = await assetsResponse.json();
let provider = 'Eclipse Temurin';
let packageInfo = assets[0]?.binary?.package;
if ((!packageInfo?.link || !packageInfo?.checksum || !packageInfo?.name)
    && target.os === 'mac' && target.folderArch === 'arm64') {
  provider = 'Azul Zulu';
  packageInfo = await getAzulMacArmPackage();
}
if (!packageInfo?.link || !packageInfo?.checksum || !packageInfo?.name) {
  throw new Error(`No downloadable Java 8 JRE was found for ${target.folderPlatform}/${target.folderArch}`);
}

const cacheDir = path.join(projectRoot, 'vendor', '.downloads');
await mkdir(cacheDir, { recursive: true });
const archivePath = path.join(cacheDir, packageInfo.name);
const checksumPath = `${archivePath}.sha256`;
let archiveReady = false;
if (await exists(archivePath) && await exists(checksumPath)) {
  const savedChecksum = (await readFile(checksumPath, 'utf8')).trim();
  archiveReady = savedChecksum === packageInfo.checksum && await sha256(archivePath) === packageInfo.checksum;
}
if (!archiveReady) {
  const temporary = `${archivePath}.tmp`;
  await rm(temporary, { force: true });
  const archiveResponse = await fetch(packageInfo.link, { redirect: 'follow' });
  if (!archiveResponse.ok || !archiveResponse.body) {
    throw new Error(`Temurin JRE download failed: HTTP ${archiveResponse.status}`);
  }
  await pipeline(Readable.fromWeb(archiveResponse.body), createWriteStream(temporary));
  const actualChecksum = await sha256(temporary);
  if (actualChecksum !== packageInfo.checksum) {
    await rm(temporary, { force: true });
    throw new Error(`Temurin JRE checksum mismatch: expected ${packageInfo.checksum}, received ${actualChecksum}`);
  }
  await rename(temporary, archivePath);
  await writeFile(checksumPath, `${packageInfo.checksum}\n`, 'utf8');
}

const extractionRoot = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-jre-'));
try {
  if (packageInfo.name.endsWith('.zip')) {
    await extractZip(archivePath, { dir: extractionRoot });
  } else if (packageInfo.name.endsWith('.tar.gz')) {
    await run('tar', ['-xzf', archivePath, '-C', extractionRoot]);
  } else {
    throw new Error(`Unsupported Temurin archive: ${packageInfo.name}`);
  }
  const sourceRoot = await findRuntimeRoot(extractionRoot, target.os);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(sourceRoot, destination, { recursive: true, force: true });
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

await access(javaPath);
console.log(JSON.stringify({
  state: 'downloaded',
  platform: target.folderPlatform,
  arch: target.folderArch,
  provider,
  package: packageInfo.name,
  checksum: packageInfo.checksum,
  javaPath
}, null, 2));

async function getAzulMacArmPackage() {
  const listUrl = new URL('https://api.azul.com/metadata/v1/zulu/packages/');
  listUrl.searchParams.set('java_version', '8');
  listUrl.searchParams.set('os', 'macos');
  listUrl.searchParams.set('arch', 'arm');
  listUrl.searchParams.set('archive_type', 'tar.gz');
  listUrl.searchParams.set('java_package_type', 'jre');
  listUrl.searchParams.set('javafx_bundled', 'false');
  listUrl.searchParams.set('release_status', 'ga');
  listUrl.searchParams.set('availability_types', 'CA');
  listUrl.searchParams.set('latest', 'true');
  listUrl.searchParams.set('page_size', '20');
  const listResponse = await fetch(listUrl, { headers: { Accept: 'application/json' } });
  if (!listResponse.ok) throw new Error(`Azul metadata request failed: HTTP ${listResponse.status}`);
  const packages = await listResponse.json();
  const selected = packages.find((item) => item.javafx_bundled === false) || packages[0];
  if (!selected?.package_uuid) return null;
  const detailResponse = await fetch(
    `https://api.azul.com/metadata/v1/zulu/packages/${selected.package_uuid}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!detailResponse.ok) throw new Error(`Azul package request failed: HTTP ${detailResponse.status}`);
  const detail = await detailResponse.json();
  return {
    link: detail.download_url,
    checksum: detail.sha256_hash,
    name: detail.name
  };
}
function resolveTarget(platform, arch) {
  const normalizedPlatform = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform;
  const normalizedArch = arch === 'aarch64' ? 'arm64' : arch;
  const platforms = {
    win: { os: 'windows', folderPlatform: 'win' },
    mac: { os: 'mac', folderPlatform: 'mac' }
  };
  const architectures = {
    x64: { apiArch: 'x64', folderArch: 'x64' },
    arm64: { apiArch: 'aarch64', folderArch: 'arm64' }
  };
  if (!platforms[normalizedPlatform]) throw new Error(`Unsupported JRE platform: ${platform}`);
  if (!architectures[normalizedArch]) throw new Error(`Unsupported JRE architecture: ${arch}`);
  return { ...platforms[normalizedPlatform], ...architectures[normalizedArch] };
}

function platformName(value) {
  if (value === 'win32') return 'win';
  if (value === 'darwin') return 'mac';
  return value;
}

async function findRuntimeRoot(extractionRoot, targetOs) {
  let entries = await readdir(extractionRoot, { withFileTypes: true });
  let root = entries.length === 1 && entries[0].isDirectory()
    ? path.join(extractionRoot, entries[0].name)
    : extractionRoot;
  if (targetOs === 'mac') {
    const macHome = path.join(root, 'Contents', 'Home');
    if (await exists(macHome)) root = macHome;
  }
  const executable = path.join(root, 'bin', targetOs === 'windows' ? 'java.exe' : 'java');
  if (!await exists(executable)) throw new Error(`Extracted JRE does not contain ${executable}`);
  return root;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  const file = await import('node:fs').then(({ createReadStream }) => createReadStream(filePath));
  for await (const chunk of file) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AppRuntime } from './core/app-runtime.mjs';
import { CoverImageService } from './core/cover-image-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const packagedRoot = process.resourcesPath;
const runtimeRoot = app.isPackaged ? packagedRoot : projectRoot;
const bundledJava = path.join(
  packagedRoot,
  'jre',
  'bin',
  process.platform === 'win32' ? 'java.exe' : 'java'
);
const bundledWorker = path.join(packagedRoot, 'unidbg', 'unidbg-worker.jar');
const smokeTest = process.env.FQNOVEL_SMOKE_TEST === '1';

// The client uses standard desktop controls and thumbnail images. Disabling
// Chromium GPU acceleration removes a large dedicated process without changing
// any required rendering capability.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

if (smokeTest) {
  const smokeDataPath = app.isPackaged
    ? path.join(app.getPath('temp'), 'fqnovel-electron-smoke')
    : path.join(projectRoot, '.electron-smoke');
  app.setPath('userData', smokeDataPath);
  app.commandLine.appendSwitch('disk-cache-dir', path.join(smokeDataPath, 'cache'));
}

const runtime = new AppRuntime({
  dataDir: path.join(app.getPath('userData'), 'data'),
  workerOptions: {
    cwd: runtimeRoot,
    javaBin: app.isPackaged ? bundledJava : undefined,
    jarPath: app.isPackaged ? bundledWorker : undefined
  }
});
const coverImages = new CoverImageService({
  maxEntries: 32,
  transform: optimizeCoverDataUrl
});

let mainWindow;
let allowQuit = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f3f3f3',
    title: 'FQNovel Desktop',
    show: !smokeTest,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(projectRoot, 'dist', 'renderer', 'index.html'));
}

function publishStatus() {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('runtime:status', presentationStatus());
}

function presentationStatus() {
  const { downloads, settings } = runtime.status();
  return { downloads, settings };
}

app.whenReady().then(async () => {
  ipcMain.handle('runtime:get-status', () => presentationStatus());
  ipcMain.handle('images:get-cover', async (_event, url) => {
    try {
      return await coverImages.getDataUrl(url);
    } catch {
      return null;
    }
  });
  ipcMain.handle('books:search', (_event, request) => runtime.searchBooks(request));
  ipcMain.handle('downloads:create', (_event, bookId, options) => runtime.createDownload(bookId, options));
  ipcMain.handle('downloads:control', (_event, taskId, action) => runtime.controlDownload(taskId, action));
  ipcMain.handle('downloads:delete', (_event, taskId) => runtime.deleteDownload(taskId));
  ipcMain.handle('settings:get', () => runtime.getSettings());
  ipcMain.handle('settings:choose-export-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择默认导出目录',
      defaultPath: runtime.getSettings().exportDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return runtime.getSettings();
    return runtime.setExportDirectory(result.filePaths[0]);
  });
  ipcMain.handle('files:show', (_event, filePath) => {
    const resolved = path.resolve(String(filePath || ''));
    const exportDirectory = path.resolve(runtime.getSettings().exportDirectory);
    const relative = path.relative(exportDirectory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('只能打开默认导出目录内的文件');
    }
    return shell.showItemInFolder(resolved);
  });

  runtime.on('status', publishStatus);
  createWindow();
  try {
    await runtime.start();
  } catch (error) {
    runtime.log('error', error.message);
  }
  publishStatus();

  if (smokeTest) {
    if (mainWindow.webContents.isLoading()) {
      await new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const renderer = await mainWindow.webContents.executeJavaScript(`({
      title: document.querySelector('h1')?.textContent,
      bridge: Object.keys(window.fqnovel).sort()
    })`);
    const smokeResult = { smoke: 'ok', packaged: app.isPackaged, renderer };
    console.log(JSON.stringify(smokeResult));
    if (process.env.FQNOVEL_SMOKE_RESULT) {
      await writeFile(
        path.resolve(process.env.FQNOVEL_SMOKE_RESULT),
        JSON.stringify(smokeResult, null, 2),
        'utf8'
      );
    }
    await runtime.stop();
    allowQuit = true;
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (allowQuit || !app.isReady()) return;
  event.preventDefault();
  allowQuit = true;
  runtime.stop().finally(() => app.quit());
});

function optimizeCoverDataUrl(dataUrl) {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return dataUrl;
  const size = image.getSize();
  if (!size.width || !size.height) return dataUrl;

  const scale = Math.min(1, 144 / size.width, 200 / size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const thumbnail = scale < 1
    ? image.resize({ width, height, quality: 'good' })
    : image;
  const jpeg = thumbnail.toJPEG(82);
  if (jpeg.length === 0) return dataUrl;
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

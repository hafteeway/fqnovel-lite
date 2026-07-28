import { EventEmitter } from 'node:events';
import path from 'node:path';
import { JavaWorkerClient } from './java-worker-client.mjs';
import { BookSourceServer } from './book-source-server.mjs';
import { FqNovelApiClient } from './fq-novel-api-client.mjs';
import { FileCacheStore } from './file-cache-store.mjs';
import { SettingsStore } from './settings-store.mjs';
import { DeviceProfileStore } from './device-profile-store.mjs';
import { FqDeviceRegistrationService } from './fq-device-registration.mjs';
import { DownloadManager } from './download-manager.mjs';
import { ExportService } from './export-service.mjs';

const HIDDEN_JAVA_LOG_LINES = [
  /^\[main\]E\/METASEC:\s*Fatal:\s*SDK not init,\s*crashing\.\.\.\s*$/
];

export function filterClientLogMessage(source, message) {
  if (message === null || message === undefined) return '';
  const value = String(message);
  if (source !== 'java') return value;

  return value
    .split(/\r?\n/)
    .filter((line) => !HIDDEN_JAVA_LOG_LINES.some((pattern) => pattern.test(line)))
    .join('\n')
    .trim();
}

export class AppRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    const dataDir = options.dataDir
      || process.env.FQNOVEL_DATA_DIR
      || path.join(options.workerOptions?.cwd || process.cwd(), 'data');
    this.repository = options.repository || new FileCacheStore({ dataDir });
    this.settings = options.settings || new SettingsStore({ dataDir });
    this.deviceProfiles = options.deviceProfiles || new DeviceProfileStore({
      dataDir,
      initialProfile: options.apiOptions?.device
    });
    this.deviceRegistration = options.deviceRegistration
      || new FqDeviceRegistrationService(options.deviceRegistrationOptions);
    this.worker = options.worker || new JavaWorkerClient(options.workerOptions);
    this.api = options.api || new FqNovelApiClient({
      ...options.apiOptions,
      worker: this.worker,
      device: this.deviceProfiles.get(),
      onIllegalAccess: async () => {
        this.#log('system', '章节接口拒绝访问，正在自动刷新模拟环境');
        await this.refreshUnidbg();
        this.#log('system', '自动刷新完成，正在重试章节请求');
      }
    });
    this.exports = options.exports || new ExportService({
      repository: this.repository,
      exportsDir: this.settings.get().exportDirectory
    });
    this.downloads = options.downloads || new DownloadManager({
      api: this.api,
      repository: this.repository,
      exporter: this.exports
    });
    this.server = options.server || new BookSourceServer({
      ...options.serverOptions,
      workerStatus: () => this.worker.status(),
      apiStatus: () => this.api.status(),
      api: this.api,
      management: {
        listDownloads: () => this.listDownloads(),
        createDownload: (bookId, downloadOptions) => this.createDownload(bookId, downloadOptions),
        controlDownload: (taskId, action) => this.controlDownload(taskId, action)
      }
    });
    this.refreshPromise = null;
    this.refreshing = false;
    this.stopPromise = null;
    this.stopping = false;
    this.logs = [];

    this.worker.on('log', (line) => this.#log('java', line));
    this.worker.on('status', () => this.#emitStatus());
    this.worker.on('worker-error', (error) => this.#log('error', error.message));
    this.server.on('status', () => this.#emitStatus());
    this.downloads.on('status', (task) => {
      if (task) this.#log('download', `${task.bookName || task.bookId}：${task.status} ${task.progress}%`);
      this.#emitStatus();
    });
  }

  async start() {
    await this.worker.start();
    if (this.settings.get().bookSourceEnabled) {
      await this.server.start();
    }
    this.#emitStatus();
    return this.status();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      await this.downloads.stop();
      await this.server.stop();
      await this.worker.stop();
      this.repository.close();
    })();
    return this.stopPromise;
  }

  log(source, message) {
    this.#log(source, message);
  }

  searchBooks(request) {
    const normalized = typeof request === 'string' ? { query: request } : (request || {});
    return this.api.searchBooks({
      query: normalized.query,
      tabType: 3,
      offset: normalized.offset || 0,
      count: normalized.count || 20,
      searchId: normalized.searchId || ''
    });
  }

  listDownloads() {
    return this.downloads.list();
  }

  async createDownload(bookId, options) {
    const task = await this.downloads.create(bookId, options);
    this.#emitStatus();
    return task;
  }

  controlDownload(taskId, action) {
    if (!['pause', 'resume', 'cancel'].includes(action)) {
      throw new Error(`不支持的下载操作：${action}`);
    }
    return this.downloads[action](taskId);
  }

  deleteDownload(taskId) {
    return this.downloads.delete(taskId);
  }

  getSettings() {
    return this.settings.get();
  }

  setExportDirectory(directory) {
    const settings = this.settings.setExportDirectory(directory);
    this.exports.exportsDir = path.resolve(settings.exportDirectory);
    this.#log('system', `默认导出目录已更改：${settings.exportDirectory}`);
    this.#emitStatus();
    return this.getSettings();
  }

  async setBookSourceEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled) {
      await this.server.start({ emitStatus: false });
    } else {
      await this.server.stop({ emitStatus: false });
    }
    this.settings.setBookSourceEnabled(nextEnabled);
    const status = this.server.status();
    this.#log('system', nextEnabled ? `书源服务已开启：${status.baseUrl}` : '书源服务已关闭');
    this.#emitStatus();
    return this.getSettings();
  }

  async refreshUnidbg() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshing = true;
    this.refreshPromise = this.#performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
      this.refreshing = false;
      this.#emitStatus();
    }
  }

  async #performRefresh() {
    this.server.setMaintenance(true);
    this.#log('system', '开始刷新 unidbg 模拟环境');
    try {
      const workerStatus = await this.worker.refresh();
      this.#log('system', '正在向上游注册新的模拟设备');
      const candidate = this.deviceProfiles.generate();
      const registered = await this.deviceRegistration.register(candidate);
      const nextDevice = this.deviceProfiles.commit(registered);
      this.api.setDeviceProfile(nextDevice);
      const deviceStatus = this.deviceProfiles.status();
      this.#log(
        'system',
        `已切换到新的模拟设备：${deviceStatus.deviceBrand} ${deviceStatus.deviceType}`
      );
      return { ...workerStatus, device: deviceStatus };
    } finally {
      this.server.setMaintenance(false);
      this.#emitStatus();
    }
  }

  status() {
    return {
      worker: this.worker.status(),
      device: this.deviceProfiles.status(),
      api: this.api.status(),
      server: this.server.status(),
      downloads: this.downloads.status(),
      settings: this.settings.get(),
      refreshing: this.refreshing,
      logs: this.logs.slice(-100)
    };
  }

  #log(source, message) {
    const filteredMessage = filterClientLogMessage(source, message);
    if (!filteredMessage) return;
    this.logs.push({ source, message: filteredMessage, at: Date.now() });
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    this.emit('log', this.logs.at(-1));
  }

  #emitStatus() {
    if (this.stopping) return;
    this.emit('status', this.status());
  }
}

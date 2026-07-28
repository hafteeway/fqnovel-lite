import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class SettingsStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
    this.settingsPath = path.join(this.dataDir, 'settings.json');
    this.defaults = {
      exportDirectory: path.join(this.dataDir, 'exports'),
      bookSourceEnabled: false
    };
    this.settings = this.#read();
    mkdirSync(this.settings.exportDirectory, { recursive: true });
  }

  get() {
    return { ...this.settings };
  }

  setExportDirectory(directory) {
    const resolved = path.resolve(String(directory || ''));
    if (!path.isAbsolute(resolved)) throw new Error('导出目录必须是绝对路径');
    mkdirSync(resolved, { recursive: true });
    this.settings.exportDirectory = resolved;
    this.#flush();
    return this.get();
  }

  setBookSourceEnabled(enabled) {
    this.settings.bookSourceEnabled = Boolean(enabled);
    this.#flush();
    return this.get();
  }

  #read() {
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      return { ...this.defaults, ...saved };
    } catch {
      return { ...this.defaults };
    }
  }

  #flush() {
    mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    const temporary = `${this.settingsPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.settingsPath);
  }
}

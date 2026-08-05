import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class SettingsStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
    this.settingsPath = path.join(this.dataDir, 'settings.json');
    this.defaults = {
      exportDirectory: path.join(this.dataDir, 'exports'),
      exportFormat: 'epub',
      searchHistory: []
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

  setExportFormat(format) {
    this.settings.exportFormat = normalizeFormat(format);
    this.#flush();
    return this.get();
  }

  recordSearch(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return this.get();
    this.settings.searchHistory = [
      normalized,
      ...this.settings.searchHistory.filter((item) => item !== normalized)
    ].slice(0, 20);
    this.#flush();
    return this.get();
  }

  clearSearchHistory() {
    this.settings.searchHistory = [];
    this.#flush();
    return this.get();
  }

  #read() {
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      return {
        ...this.defaults,
        exportDirectory: typeof saved?.exportDirectory === 'string'
          ? saved.exportDirectory
          : this.defaults.exportDirectory,
        exportFormat: normalizeFormat(saved?.exportFormat),
        searchHistory: normalizeSearchHistory(saved?.searchHistory)
      };
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

function normalizeFormat(value) {
  const format = String(value || 'epub').toLowerCase();
  if (!['txt', 'epub'].includes(format)) return 'epub';
  return format;
}

function normalizeSearchHistory(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 20);
}

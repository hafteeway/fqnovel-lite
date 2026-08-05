import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../src/core/settings-store.mjs';

test('persists the export directory and discards removed settings', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fqnovel-settings-'));
  try {
    const settings = new SettingsStore({ dataDir });
    assert.equal(settings.get().exportDirectory, path.join(dataDir, 'exports'));

    const exportDirectory = path.join(dataDir, 'library');
    settings.setExportDirectory(exportDirectory);
    assert.deepEqual(settings.get(), { exportDirectory, exportFormat: 'epub', searchHistory: [] });

    settings.setExportFormat('txt');
    assert.deepEqual(settings.get(), { exportDirectory, exportFormat: 'txt', searchHistory: [] });

    settings.setExportFormat('unsupported');
    assert.equal(settings.get().exportFormat, 'epub');

    settings.recordSearch('剑来');
    settings.recordSearch('凡人修仙');
    settings.recordSearch('剑来');
    assert.deepEqual(settings.get().searchHistory, ['剑来', '凡人修仙']);
    settings.clearSearchHistory();
    assert.deepEqual(settings.get().searchHistory, []);

    const restored = new SettingsStore({ dataDir });
    assert.deepEqual(restored.get(), { exportDirectory, exportFormat: 'epub', searchHistory: [] });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../src/core/settings-store.mjs';

test('keeps the book source disabled by default and persists explicit changes', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fqnovel-settings-'));
  try {
    const settings = new SettingsStore({ dataDir });
    assert.equal(settings.get().bookSourceEnabled, false);

    settings.setBookSourceEnabled(true);
    assert.equal(settings.get().bookSourceEnabled, true);

    const restored = new SettingsStore({ dataDir });
    assert.equal(restored.get().bookSourceEnabled, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

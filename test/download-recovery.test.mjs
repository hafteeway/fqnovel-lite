import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStore } from '../src/core/file-cache-store.mjs';

test('recovers interrupted file-cache downloads as paused tasks', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-recovery-'));
  let repository = new FileCacheStore({ dataDir });
  try {
    repository.createDownloadTask({
      id: 'task-1',
      bookId: 'book-1',
      format: 'epub',
      status: 'running',
      batchSize: 2
    }, [
      { chapterId: 'chapter-1', chapterIndex: 1 },
      { chapterId: 'chapter-2', chapterIndex: 2 }
    ]);
    repository.close();

    repository = new FileCacheStore({ dataDir });
    const recovered = repository.getDownloadTask('task-1');
    assert.equal(recovered.status, 'paused');
    assert.equal(recovered.format, 'epub');
    assert.match(recovered.error, /继续下载/);
  } finally {
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

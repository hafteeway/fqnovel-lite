import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStore } from '../src/core/file-cache-store.mjs';
import { DownloadManager } from '../src/core/download-manager.mjs';
import { ExportService } from '../src/core/export-service.mjs';

test('downloads the complete book in batches and automatically exports the selected format', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-download-'));
  const repository = new FileCacheStore({ dataDir });
  const exporter = new ExportService({ repository });
  const batches = [];
  const api = {
    async getBookInfo(bookId) {
      return { bookId, bookName: '队列测试', author: '作者', totalChapters: 5 };
    },
    async getDirectory() {
      return {
        serial_count: '51',
        item_data_list: Array.from({ length: 51 }, (_, index) => ({
          item_id: `chapter-${index + 1}`,
          title: `第${index + 1}章`,
          chapter_index: index + 1
        }))
      };
    },
    async getChapters(bookId, chapterIds) {
      batches.push([...chapterIds]);
      return {
        chapters: Object.fromEntries(chapterIds.map((chapterId) => [
          chapterId,
          { bookId, chapterId, title: chapterId, txtContent: `${chapterId} 正文` }
        ])),
        failures: {}
      };
    }
  };
  const manager = new DownloadManager({ api, repository, exporter });
  try {
    const created = await manager.create('book-1', { format: 'txt' });
    const completed = await waitForTask(manager, created.id, 'completed');

    assert.equal(completed.totalChapters, 51);
    assert.equal(completed.completedChapters, 51);
    assert.equal(completed.progress, 100);
    assert.equal(completed.format, 'txt');
    assert.deepEqual(batches.map((batch) => batch.length), [50, 1]);
    assert.match(await readFile(completed.outputPath, 'utf8'), /chapter-5 正文/);
    assert.match(await readFile(completed.outputPath, 'utf8'), /chapter-51/);
    assert.deepEqual(manager.clearCompleted(), { deletedCount: 1, taskIds: [created.id] });
    assert.deepEqual(manager.list(), []);
  } finally {
    await manager.stop();
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('loads and embeds the cover before automatically exporting EPUB', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-epub-cover-'));
  const repository = new FileCacheStore({ dataDir });
  const expectedCover = {
    data: Buffer.from('cover'),
    mediaType: 'image/jpeg',
    extension: 'jpg'
  };
  let exportOptions = null;
  const exporter = {
    async loadCover(bookId) {
      assert.equal(bookId, 'book-cover');
      return expectedCover;
    },
    exportBook(bookId, format, options) {
      assert.equal(bookId, 'book-cover');
      assert.equal(format, 'epub');
      exportOptions = options;
      return { path: path.join(dataDir, 'book.epub') };
    }
  };
  const api = {
    async getBookInfo(bookId) {
      return { bookId, bookName: 'Cover test', author: 'Author', totalChapters: 1 };
    },
    async getDirectory() {
      return {
        serial_count: '1',
        item_data_list: [{ item_id: 'chapter-1', title: 'Chapter 1', chapter_index: 1 }]
      };
    },
    async getChapters(bookId) {
      return {
        chapters: {
          'chapter-1': { bookId, chapterId: 'chapter-1', title: 'Chapter 1', txtContent: 'Body' }
        },
        failures: {}
      };
    }
  };
  const manager = new DownloadManager({ api, repository, exporter });
  try {
    const created = await manager.create('book-cover', { format: 'epub' });
    await waitForTask(manager, created.id, 'completed');
    assert.strictEqual(exportOptions?.cover, expectedCover);
  } finally {
    await manager.stop();
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function waitForTask(manager, taskId, expectedStatus) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const task = manager.get(taskId);
    if (task?.status === expectedStatus) return task;
    if (task?.status === 'failed') throw new Error(task.error || '下载任务失败');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待下载状态 ${expectedStatus} 超时`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStore } from '../src/core/file-cache-store.mjs';

test('persists downloadable content as files instead of SQLite', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-cache-'));
  let repository = new FileCacheStore({ dataDir });
  try {
    repository.upsertDirectory('book-1', {
      serial_count: '2',
      book_info: { book_id: 'book-1', book_name: '缓存书籍', author: '作者' },
      item_data_list: [
        { item_id: 'chapter-1', title: '第一章', chapter_index: 1 },
        { item_id: 'chapter-2', title: '第二章', chapter_index: 2 }
      ]
    });
    repository.saveChapter({
      bookId: 'book-1',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      title: '第一章',
      txtContent: '正文'
    });
    repository.close();

    repository = new FileCacheStore({ dataDir });
    assert.equal(repository.getBook('book-1').bookName, '缓存书籍');
    assert.equal(repository.getChapter('book-1', 'chapter-1').txtContent, '正文');
    assert.equal(repository.listChapters('book-1').length, 2);
  } finally {
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('deleting the final task also deletes its book cache', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-paused-task-'));
  const repository = new FileCacheStore({ dataDir });
  try {
    repository.createDownloadTask({
      id: 'task-paused',
      bookId: 'book-paused',
      format: 'txt',
      status: 'paused'
    }, [{
      chapterId: 'chapter-1',
      chapterIndex: 1
    }]);
    repository.upsertDirectory('book-paused', {
      serial_count: '1',
      book_info: {
        book_id: 'book-paused',
        book_name: '待删除书籍',
        author: '测试作者',
        thumb_url: 'https://p3-sign.fqnovelpic.com/cover.heic'
      },
      item_data_list: [{ item_id: 'chapter-1', title: '第一章', chapter_index: 1 }]
    });
    repository.saveChapter({
      bookId: 'book-paused',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      title: '第一章',
      txtContent: '正文'
    });

    const task = repository.getDownloadTask('task-paused');
    assert.equal(task.author, '测试作者');
    assert.equal(task.coverUrl, 'https://p3-sign.fqnovelpic.com/cover.heic');

    const result = repository.deleteDownloadTask('task-paused');
    assert.deepEqual(result, { deleted: true, cacheDeleted: true });
    assert.equal(repository.getDownloadTask('task-paused'), null);
    assert.equal(repository.getBook('book-paused'), null);
    assert.equal(repository.getChapter('book-paused', 'chapter-1'), null);
    assert.equal(repository.stats().downloadedChapters, 0);
  } finally {
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('keeps shared book cache until its final task is deleted', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-shared-cache-'));
  const repository = new FileCacheStore({ dataDir });
  try {
    repository.upsertDirectory('book-shared', {
      serial_count: '1',
      book_info: { book_id: 'book-shared', book_name: '共享缓存书籍' },
      item_data_list: [{ item_id: 'chapter-1', title: '第一章', chapter_index: 1 }]
    });
    repository.saveChapter({
      bookId: 'book-shared',
      chapterId: 'chapter-1',
      chapterIndex: 1,
      title: '第一章',
      txtContent: '正文'
    });
    repository.createDownloadTask({
      id: 'task-txt',
      bookId: 'book-shared',
      format: 'txt',
      status: 'paused'
    }, [{
      chapterId: 'chapter-1',
      chapterIndex: 1
    }]);
    repository.createDownloadTask({
      id: 'task-epub',
      bookId: 'book-shared',
      format: 'epub',
      status: 'paused'
    }, [{
      chapterId: 'chapter-1',
      chapterIndex: 1
    }]);

    assert.deepEqual(
      repository.deleteDownloadTask('task-txt'),
      { deleted: true, cacheDeleted: false }
    );
    assert.notEqual(repository.getBook('book-shared'), null);
    assert.notEqual(repository.getChapter('book-shared', 'chapter-1'), null);

    assert.deepEqual(
      repository.deleteDownloadTask('task-epub'),
      { deleted: true, cacheDeleted: true }
    );
    assert.equal(repository.getBook('book-shared'), null);
    assert.equal(repository.getChapter('book-shared', 'chapter-1'), null);

  } finally {
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

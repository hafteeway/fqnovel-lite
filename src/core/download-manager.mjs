import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);
const DOWNLOAD_BATCH_SIZE = 50;

export class DownloadManager extends EventEmitter {
  constructor(options = {}) {
    if (!options.api || !options.repository || !options.exporter) {
      throw new Error('DownloadManager requires api, repository and exporter');
    }
    super();
    this.api = options.api;
    this.repository = options.repository;
    this.exporter = options.exporter;
    this.running = new Map();
    this.stopping = false;
  }

  async create(bookId, options = {}) {
    const normalizedBookId = String(bookId || '').trim();
    if (!normalizedBookId) throw new Error('书籍 ID 不能为空');
    const format = normalizeFormat(options.format);
    const existing = this.repository.getActiveDownloadTask(normalizedBookId, format);
    if (existing) return existing;

    const [book, directory] = await Promise.all([
      this.api.getBookInfo(normalizedBookId),
      this.api.getDirectory(normalizedBookId)
    ]);
    this.repository.upsertBook(book);
    this.repository.upsertDirectory(normalizedBookId, directory);
    const items = (directory.item_data_list || []).map((item, index) => ({
      chapterId: String(item.item_id),
      chapterIndex: Number(item.chapter_index || index + 1)
    }));
    if (items.length === 0) throw new Error('书籍目录为空');

    const task = this.repository.createDownloadTask({
      id: randomUUID(),
      bookId: normalizedBookId,
      format,
      status: 'queued',
      batchSize: DOWNLOAD_BATCH_SIZE
    }, items);
    this.resume(task.id);
    return task;
  }

  list() {
    return this.repository.listDownloadTasks();
  }

  get(taskId) {
    return this.repository.getDownloadTask(taskId);
  }

  pause(taskId) {
    const task = this.#requiredTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return task;
    const updated = this.repository.setDownloadTaskStatus(taskId, 'paused', null);
    this.emit('status', updated);
    return updated;
  }

  resume(taskId) {
    const task = this.#requiredTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return task;
    if (this.running.has(taskId)) return task;
    this.repository.resetFailedDownloadItems(taskId);
    const updated = this.repository.setDownloadTaskStatus(taskId, 'queued', null);
    const promise = Promise.resolve()
      .then(() => this.#run(taskId))
      .catch((error) => {
        const failed = this.repository.setDownloadTaskStatus(taskId, 'failed', error.message);
        this.emit('status', failed);
      })
      .finally(() => this.running.delete(taskId));
    this.running.set(taskId, promise);
    this.emit('status', updated);
    return updated;
  }

  cancel(taskId) {
    this.#requiredTask(taskId);
    const updated = this.repository.setDownloadTaskStatus(taskId, 'cancelled', null);
    this.emit('status', updated);
    return updated;
  }

  delete(taskId) {
    const task = this.#requiredTask(taskId);
    if (this.running.has(taskId) || ['queued', 'running', 'exporting'].includes(task.status)) {
      throw new Error('请先取消正在进行的任务');
    }
    const result = this.repository.deleteDownloadTask(taskId);
    this.emit('status', null);
    return {
      deleted: result.deleted,
      cacheDeleted: result.cacheDeleted,
      taskId,
      bookId: task.bookId
    };
  }

  async stop() {
    this.stopping = true;
    for (const taskId of this.running.keys()) {
      this.repository.setDownloadTaskStatus(taskId, 'paused', '应用退出，可继续下载');
    }
    await Promise.allSettled([...this.running.values()]);
  }

  status() {
    return {
      activeTasks: this.running.size,
      tasks: this.list()
    };
  }

  async #run(taskId) {
    let task = this.#requiredTask(taskId);
    task = this.repository.setDownloadTaskStatus(taskId, 'running', null);
    this.emit('status', task);

    while (!this.stopping) {
      task = this.#requiredTask(taskId);
      if (task.status !== 'running') return;
      const items = this.repository.getPendingDownloadItems(taskId, DOWNLOAD_BATCH_SIZE);
      if (items.length === 0) {
        task = this.repository.refreshDownloadProgress(taskId);
        if (task.failedChapters > 0) {
          task = this.repository.setDownloadTaskStatus(
            taskId,
            'failed',
            `${task.failedChapters} 个章节下载失败，可重试`
          );
          this.emit('status', task);
          return;
        }

        task = this.repository.setDownloadTaskStatus(taskId, 'exporting', null);
        this.emit('status', task);
        let cover = null;
        if (task.format === 'epub' && typeof this.exporter.loadCover === 'function') {
          try {
            cover = await this.exporter.loadCover(task.bookId);
          } catch {
            // Export the book without an image if the upstream cover is unavailable.
          }
        }
        const output = this.exporter.exportBook(task.bookId, task.format, { cover });
        this.repository.setDownloadTaskOutput(taskId, output);
        task = this.repository.setDownloadTaskStatus(taskId, 'completed', null);
        this.emit('status', task);
        return;
      }

      const result = await this.api.getChapters(
        task.bookId,
        items.map((item) => item.chapterId),
        { download: true }
      );
      for (const item of items) {
        const chapter = result.chapters[item.chapterId];
        if (chapter) {
          chapter.chapterIndex = item.chapterIndex;
          this.repository.saveChapter(chapter);
          this.repository.completeDownloadItem(taskId, item.chapterId);
        } else {
          this.repository.failDownloadItem(
            taskId,
            item.chapterId,
            result.failures[item.chapterId] || '章节下载失败'
          );
        }
      }
      task = this.repository.refreshDownloadProgress(taskId);
      this.emit('status', task);
    }
  }

  #requiredTask(taskId) {
    const task = this.repository.getDownloadTask(taskId);
    if (!task) throw new Error('下载任务不存在');
    return task;
  }
}

function normalizeFormat(value) {
  const format = String(value || 'txt').toLowerCase();
  if (!['txt', 'epub'].includes(format)) throw new Error('仅支持 TXT 或 EPUB');
  return format;
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

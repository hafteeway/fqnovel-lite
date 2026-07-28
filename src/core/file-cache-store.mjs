import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
  renameSync
} from 'node:fs';
import path from 'node:path';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'exporting']);

export class FileCacheStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
    this.cacheDir = path.join(this.dataDir, 'cache');
    this.booksDir = path.join(this.cacheDir, 'books');
    this.statePath = path.join(this.cacheDir, 'tasks.json');
    mkdirSync(this.booksDir, { recursive: true });
    this.state = this.#readState();
    this.recoverInterruptedDownloads();
  }

  upsertBook(book = {}) {
    const bookId = text(book.bookId ?? book.book_id);
    if (!bookId) return;
    const current = this.state.books[bookId] || { bookId };
    this.state.books[bookId] = {
      ...current,
      ...book,
      bookId,
      bookName: text(book.bookName ?? book.book_name) || current.bookName || '',
      author: text(book.author) || current.author || '',
      coverUrl: text(book.coverUrl ?? book.thumb_url) || current.coverUrl || '',
      description: text(book.description ?? book.abstract ?? book.abstract_content)
        || current.description
        || '',
      totalChapters: integer(book.totalChapters ?? book.serial_count, current.totalChapters || 0),
      updatedAt: Date.now()
    };
    this.#flush();
  }

  upsertDirectory(bookId, directory = {}) {
    const normalizedBookId = text(bookId);
    if (!normalizedBookId) return;
    this.upsertBook({
      ...(directory.book_info || {}),
      bookId: directory.book_info?.book_id || normalizedBookId,
      totalChapters: directory.serial_count
    });
    const directoryPath = this.#directoryPath(normalizedBookId);
    mkdirSync(path.dirname(directoryPath), { recursive: true });
    atomicWriteJson(directoryPath, directory);
  }

  saveChapter(chapter = {}) {
    const bookId = text(chapter.bookId);
    const chapterId = text(chapter.chapterId);
    if (!bookId || !chapterId) throw new Error('保存章节需要 bookId 和 chapterId');
    const target = this.#chapterPath(bookId, chapterId);
    const isNewChapter = !existsSync(target);
    mkdirSync(path.dirname(target), { recursive: true });
    atomicWriteJson(target, {
      ...chapter,
      bookId,
      chapterId,
      updatedAt: Date.now()
    });
    if (isNewChapter) this.state.cachedChapters += 1;
  }

  getBook(bookId) {
    return this.state.books[text(bookId)] || null;
  }

  listBooks() {
    return Object.values(this.state.books)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .map((book) => ({
        ...book,
        downloadedChapters: this.listChapters(book.bookId, { withContentOnly: true }).length
      }));
  }

  getChapter(bookId, chapterId) {
    return readJson(this.#chapterPath(bookId, chapterId), null);
  }

  listChapters(bookId, options = {}) {
    const normalizedBookId = text(bookId);
    const directory = readJson(this.#directoryPath(normalizedBookId), null);
    const orderedItems = Array.isArray(directory?.item_data_list)
      ? directory.item_data_list
      : [];
    const chapters = [];

    if (orderedItems.length > 0) {
      for (const [index, item] of orderedItems.entries()) {
        const chapterId = text(item.item_id);
        const chapter = this.getChapter(normalizedBookId, chapterId);
        if (chapter) {
          chapters.push({
            ...chapter,
            chapterIndex: integer(chapter.chapterIndex, integer(item.chapter_index, index + 1)),
            title: text(chapter.title) || text(item.title)
          });
        } else if (!options.withContentOnly) {
          chapters.push({
            bookId: normalizedBookId,
            chapterId,
            chapterIndex: integer(item.chapter_index, index + 1),
            title: text(item.title),
            txtContent: null
          });
        }
      }
      return chapters;
    }

    const chaptersDir = path.join(this.#bookDir(normalizedBookId), 'chapters');
    if (!existsSync(chaptersDir)) return [];
    return readdirSync(chaptersDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJson(path.join(chaptersDir, entry.name), null))
      .filter(Boolean)
      .filter((chapter) => !options.withContentOnly || chapter.txtContent != null)
      .sort((a, b) => integer(a.chapterIndex, 0) - integer(b.chapterIndex, 0));
  }

  createDownloadTask(task, items) {
    const now = Date.now();
    this.state.tasks[task.id] = {
      id: task.id,
      bookId: text(task.bookId),
      format: normalizeFormat(task.format),
      status: task.status || 'queued',
      batchSize: integer(task.batchSize, 20),
      totalChapters: items.length,
      completedChapters: 0,
      failedChapters: 0,
      outputPath: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };
    this.state.items[task.id] = items.map((item) => ({
      chapterId: text(item.chapterId),
      chapterIndex: integer(item.chapterIndex, 0),
      status: 'pending',
      attempts: 0,
      error: null,
      updatedAt: now
    }));
    this.#flush();
    return this.getDownloadTask(task.id);
  }

  getActiveDownloadTask(bookId, format) {
    return this.listDownloadTasks().find((task) =>
      task.bookId === text(bookId)
      && (!format || task.format === normalizeFormat(format))
      && !['completed', 'cancelled'].includes(task.status)
    ) || null;
  }

  getDownloadTask(taskId) {
    const task = this.state.tasks[text(taskId)];
    if (!task) return null;
    const book = this.getBook(task.bookId);
    const total = Number(task.totalChapters || 0);
    const completed = Number(task.completedChapters || 0);
    return {
      ...task,
      bookName: book?.bookName || task.bookId,
      author: book?.author || '',
      coverUrl: book?.coverUrl || '',
      horizThumbUrl: book?.horizThumbUrl || '',
      progress: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  }

  listDownloadTasks() {
    return Object.values(this.state.tasks)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map((task) => this.getDownloadTask(task.id));
  }

  setDownloadTaskStatus(taskId, status, error = null) {
    const task = this.state.tasks[text(taskId)];
    if (!task) return null;
    task.status = status;
    task.error = error;
    task.updatedAt = Date.now();
    this.#flush();
    return this.getDownloadTask(taskId);
  }

  setDownloadTaskOutput(taskId, output = {}) {
    const task = this.state.tasks[text(taskId)];
    if (!task) return null;
    task.outputPath = output.path || null;
    task.updatedAt = Date.now();
    this.#flush();
    return this.getDownloadTask(taskId);
  }

  resetFailedDownloadItems(taskId) {
    const items = this.state.items[text(taskId)] || [];
    const now = Date.now();
    for (const item of items) {
      if (item.status !== 'failed') continue;
      item.status = 'pending';
      item.attempts = 0;
      item.error = null;
      item.updatedAt = now;
    }
    this.refreshDownloadProgress(taskId);
  }

  getPendingDownloadItems(taskId, limit) {
    return (this.state.items[text(taskId)] || [])
      .filter((item) => ['pending', 'failed'].includes(item.status) && item.attempts < 3)
      .sort((a, b) => a.chapterIndex - b.chapterIndex)
      .slice(0, integer(limit, 20))
      .map((item) => ({ ...item }));
  }

  completeDownloadItem(taskId, chapterId) {
    this.#updateItem(taskId, chapterId, (item) => {
      item.status = 'completed';
      item.error = null;
    });
  }

  failDownloadItem(taskId, chapterId, error) {
    this.#updateItem(taskId, chapterId, (item) => {
      item.status = 'failed';
      item.attempts += 1;
      item.error = text(error);
    });
  }

  refreshDownloadProgress(taskId) {
    const task = this.state.tasks[text(taskId)];
    if (!task) return null;
    const items = this.state.items[text(taskId)] || [];
    task.completedChapters = items.filter((item) => item.status === 'completed').length;
    task.failedChapters = items.filter((item) => item.status === 'failed').length;
    task.updatedAt = Date.now();
    this.#flush();
    return this.getDownloadTask(taskId);
  }

  deleteDownloadTask(taskId) {
    const normalizedTaskId = text(taskId);
    const task = this.state.tasks[normalizedTaskId];
    if (!task) return { deleted: false, cacheDeleted: false };
    if (ACTIVE_STATUSES.has(task.status)) throw new Error('请先取消正在进行的下载任务');
    const bookId = text(task.bookId);
    delete this.state.tasks[normalizedTaskId];
    delete this.state.items[normalizedTaskId];

    const bookStillInUse = Object.values(this.state.tasks)
      .some((candidate) => text(candidate.bookId) === bookId);
    if (!bookStillInUse) {
      const bookDir = this.#bookDir(bookId);
      if (existsSync(bookDir)) rmSync(bookDir, { recursive: true, force: true });
      delete this.state.books[bookId];
      this.state.cachedChapters = countChapterFiles(this.booksDir);
    }

    this.#flush();
    return { deleted: true, cacheDeleted: !bookStillInUse };
  }

  recoverInterruptedDownloads() {
    let changed = false;
    for (const task of Object.values(this.state.tasks)) {
      if (!['running', 'queued', 'exporting'].includes(task.status)) continue;
      task.status = 'paused';
      task.error = '应用上次退出，可继续下载';
      task.updatedAt = Date.now();
      changed = true;
    }
    if (changed) this.#flush();
  }

  stats() {
    return {
      cacheDir: this.cacheDir,
      books: Object.keys(this.state.books).length,
      downloadedChapters: Number(this.state.cachedChapters || 0),
      downloadTasks: Object.keys(this.state.tasks).length
    };
  }

  close() {
    this.#flush();
  }

  #updateItem(taskId, chapterId, update) {
    const item = (this.state.items[text(taskId)] || [])
      .find((candidate) => candidate.chapterId === text(chapterId));
    if (!item) return;
    update(item);
    item.updatedAt = Date.now();
  }

  #readState() {
    const state = readJson(this.statePath, null);
    if (!state || state.version !== 1) {
      return { version: 1, books: {}, tasks: {}, items: {}, cachedChapters: 0 };
    }
    return {
      version: 1,
      books: state.books || {},
      tasks: state.tasks || {},
      items: state.items || {},
      cachedChapters: Number.isFinite(state.cachedChapters)
        ? state.cachedChapters
        : countChapterFiles(this.booksDir)
    };
  }

  #flush() {
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    atomicWriteJson(this.statePath, this.state);
  }

  #bookDir(bookId) {
    return path.join(this.booksDir, safeSegment(bookId));
  }

  #directoryPath(bookId) {
    return path.join(this.#bookDir(bookId), 'directory.json');
  }

  #chapterPath(bookId, chapterId) {
    return path.join(this.#bookDir(bookId), 'chapters', `${safeSegment(chapterId)}.json`);
  }
}

function atomicWriteJson(target, value) {
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
}

function readJson(target, fallback) {
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeSegment(value) {
  return encodeURIComponent(text(value)).replaceAll('%', '_');
}

function normalizeFormat(value) {
  const format = text(value).toLowerCase();
  return format === 'epub' ? 'epub' : 'txt';
}

function text(value) {
  return value == null ? '' : String(value);
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function countChapterFiles(booksDir) {
  if (!existsSync(booksDir)) return 0;
  let count = 0;
  for (const bookEntry of readdirSync(booksDir, { withFileTypes: true })) {
    if (!bookEntry.isDirectory()) continue;
    const chaptersDir = path.join(booksDir, bookEntry.name, 'chapters');
    if (!existsSync(chaptersDir) || !statSync(chaptersDir).isDirectory()) continue;
    count += readdirSync(chaptersDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .length;
  }
  return count;
}


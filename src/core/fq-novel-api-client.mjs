import { FqApiClient, FqApiError } from './fq-api-client.mjs';
import { FqContentService } from './fq-content-service.mjs';

const CHAPTER_PREFETCH_SIZE = 10;
const MAX_PREFETCH_DIRECTORIES = 5;

export class FqNovelApiClient extends FqApiClient {
  constructor(options = {}) {
    super(options);
    this.content = options.content || new FqContentService(options);
    this.repository = options.repository || null;
    this.chapterIndexes = new Map();
    this.chapterBatchPromises = new Map();
  }

  async searchBooks(request) {
    const result = await super.searchBooks(request);
    for (const book of result.books || []) this.repository?.upsertBook(book);
    return result;
  }

  async getDirectory(bookId, options) {
    const directory = await super.getDirectory(bookId, options);
    this.#rememberDirectory(bookId, directory);
    this.repository?.upsertDirectory(bookId, directory);
    return directory;
  }

  async getBookInfo(bookId) {
    const book = await super.getBookInfo(bookId);
    this.repository?.upsertBook(book);
    return book;
  }

  async getChapter(bookId, chapterId) {
    const normalizedBookId = String(bookId || '').trim();
    const normalizedChapterId = String(chapterId || '').trim();
    if (!normalizedBookId || !normalizedChapterId) {
      throw new FqApiError('INVALID_ARGUMENT', '书籍 ID 和章节 ID 不能为空', 400);
    }

    const cached = this.repository?.getChapter(normalizedBookId, normalizedChapterId);
    if (cached) return cached;

    const plan = await this.#chapterPrefetchPlan(normalizedBookId, normalizedChapterId);
    let pending = this.chapterBatchPromises.get(plan.key);
    if (!pending) {
      pending = this.getChapters(normalizedBookId, plan.chapterIds)
        .finally(() => this.chapterBatchPromises.delete(plan.key));
      this.chapterBatchPromises.set(plan.key, pending);
    }
    const result = await pending;
    const chapter = result.chapters[normalizedChapterId];
    if (!chapter) {
      throw new FqApiError(
        'CHAPTER_NOT_FOUND',
        result.failures?.[normalizedChapterId] || '上游响应中没有该章节',
        404
      );
    }
    return chapter;
  }

  async getChapters(bookId, chapterIds, options) {
    const requestedIds = [...new Set((chapterIds || []).map(String).filter(Boolean))];
    const chapters = {};
    const missingIds = [];
    for (const chapterId of requestedIds) {
      const cached = this.repository?.getChapter(bookId, chapterId);
      if (cached) chapters[chapterId] = cached;
      else missingIds.push(chapterId);
    }

    let failures = {};
    if (missingIds.length > 0) {
      const fetched = await this.content.getChapters(bookId, missingIds, options);
      failures = fetched.failures || {};
      for (const [chapterId, chapter] of Object.entries(fetched.chapters || {})) {
        chapters[chapterId] = chapter;
        this.repository?.saveChapter(chapter);
      }
    }

    return {
      bookId: String(bookId),
      requested: requestedIds.length,
      successCount: Object.keys(chapters).length,
      failedCount: Object.keys(failures).length,
      chapters,
      failures
    };
  }

  setDeviceProfile(profile) {
    const device = super.setDeviceProfile(profile);
    this.content.setDeviceProfile(device);
    return device;
  }

  refreshRegisterKey() {
    return this.content.refreshRegisterKey();
  }

  clearCache() {
    super.clearCache();
    this.chapterIndexes.clear();
    this.chapterBatchPromises.clear();
    this.content.clearCache();
  }
  async #chapterPrefetchPlan(bookId, chapterId) {
    let chapterIds = this.chapterIndexes.get(bookId);
    if (!chapterIds) {
      try {
        await this.getDirectory(bookId, { needVersion: true });
        chapterIds = this.chapterIndexes.get(bookId);
      } catch {
        return singleChapterPlan(bookId, chapterId);
      }
    }

    const chapterIndex = chapterIds?.indexOf(chapterId) ?? -1;
    if (chapterIndex < 0) return singleChapterPlan(bookId, chapterId);
    const batchStart = Math.floor(chapterIndex / CHAPTER_PREFETCH_SIZE) * CHAPTER_PREFETCH_SIZE;
    return {
      key: `${bookId}:${batchStart}`,
      chapterIds: chapterIds.slice(batchStart, batchStart + CHAPTER_PREFETCH_SIZE)
    };
  }

  #rememberDirectory(bookId, directory) {
    const normalizedBookId = String(bookId || '').trim();
    const chapterIds = (directory?.item_data_list || [])
      .map((item) => String(item?.item_id || '').trim())
      .filter(Boolean);
    if (!normalizedBookId || chapterIds.length === 0) return;

    this.chapterIndexes.delete(normalizedBookId);
    this.chapterIndexes.set(normalizedBookId, chapterIds);
    while (this.chapterIndexes.size > MAX_PREFETCH_DIRECTORIES) {
      this.chapterIndexes.delete(this.chapterIndexes.keys().next().value);
    }
  }

  status() {
    return {
      ...super.status(),
      content: this.content.status(),
      cache: this.repository?.stats() || null,
      prefetch: {
        batchSize: CHAPTER_PREFETCH_SIZE,
        directoryIndexes: this.chapterIndexes.size,
        activeBatches: this.chapterBatchPromises.size
      }
    };
  }
}

function singleChapterPlan(bookId, chapterId) {
  return {
    key: `${bookId}:single:${chapterId}`,
    chapterIds: [chapterId]
  };
}

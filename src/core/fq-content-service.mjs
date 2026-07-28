import {
  buildCommonHeaders,
  buildCommonParams,
  createDeviceProfile
} from './fq-device-profile.mjs';
import {
  createRegisterKeyContent,
  decryptChapterContent,
  decryptRegisterKey,
  extractChapterText,
  extractChapterTitle
} from './fq-crypto.mjs';
import { FqApiError } from './fq-api-client.mjs';

const CONTENT_BASE_URL = 'https://api5-normal-sinfonlineb.fqnovel.com';
const CACHE_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const MAX_BATCH_SIZE = 50;

export class FqContentService {
  constructor(options = {}) {
    if (!options.worker) throw new Error('FqContentService requires a Java worker');
    this.worker = options.worker;
    this.device = createDeviceProfile(options.device);
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.onIllegalAccess = typeof options.onIllegalAccess === 'function'
      ? options.onIllegalAccess
      : null;
    this.illegalAccessRecoveryPromise = null;
    this.registerKeys = new Map();
    this.currentKeyVersion = null;
    this.registerKeyPromise = null;
    this.chapterCache = new Map();
    this.pendingChapters = new Map();
    this.metrics = {
      batchRequests: 0,
      decryptedChapters: 0,
      cacheHits: 0,
      registerKeyRequests: 0,
      currentKeyVersion: null,
      lastError: null
    };
  }

  async getChapter(bookId, chapterId) {
    const normalizedBookId = requiredId(bookId, '书籍 ID');
    const normalizedChapterId = requiredId(chapterId, '章节 ID');
    const cacheKey = `${normalizedBookId}:${normalizedChapterId}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      this.metrics.cacheHits += 1;
      return cached.value;
    }
    if (this.pendingChapters.has(cacheKey)) return this.pendingChapters.get(cacheKey);

    const promise = this.getChapters(normalizedBookId, [normalizedChapterId])
      .then((result) => {
        const chapter = result.chapters[normalizedChapterId] || Object.values(result.chapters)[0];
        if (!chapter) throw new FqApiError('CHAPTER_NOT_FOUND', '上游响应中没有该章节', 404);
        return chapter;
      })
      .finally(() => this.pendingChapters.delete(cacheKey));
    this.pendingChapters.set(cacheKey, promise);
    return promise;
  }

  async getChapters(bookId, chapterIds, options = {}) {
    const normalizedBookId = requiredId(bookId, '书籍 ID');
    const ids = normalizeChapterIds(chapterIds);
    if (ids.length === 0) throw new FqApiError('INVALID_ARGUMENT', '章节 ID 不能为空', 400);
    if (ids.length > MAX_BATCH_SIZE) {
      throw new FqApiError('BATCH_TOO_LARGE', `单次最多请求 ${MAX_BATCH_SIZE} 个章节`, 400);
    }

    const chapters = {};
    const missing = [];
    for (const id of ids) {
      const cacheKey = `${normalizedBookId}:${id}`;
      const cached = this.chapterCache.get(cacheKey);
      if (cached && cached.expiresAt > this.now()) {
        this.metrics.cacheHits += 1;
        chapters[id] = cached.value;
      } else {
        missing.push(id);
      }
    }

    const failures = {};
    if (missing.length > 0) {
      const batch = await this.#fetchBatch(normalizedBookId, missing, Boolean(options.download));
      const items = batch?.data && typeof batch.data === 'object' ? batch.data : {};
      for (const [chapterId, item] of Object.entries(items)) {
        try {
          const chapter = await this.#decryptItem(normalizedBookId, chapterId, item);
          chapters[chapterId] = chapter;
          this.#cacheChapter(normalizedBookId, chapterId, chapter);
        } catch (error) {
          failures[chapterId] = error.message;
        }
      }
      for (const id of missing) {
        if (!chapters[id] && !failures[id]) failures[id] = '上游响应中没有该章节';
      }
    }

    return {
      bookId: normalizedBookId,
      requested: ids.length,
      successCount: Object.keys(chapters).length,
      failedCount: Object.keys(failures).length,
      chapters,
      failures
    };
  }

  async refreshRegisterKey() {
    if (this.registerKeyPromise) return this.registerKeyPromise;
    this.registerKeyPromise = this.#fetchRegisterKey();
    try {
      return await this.registerKeyPromise;
    } finally {
      this.registerKeyPromise = null;
    }
  }

  setDeviceProfile(profile) {
    this.device = createDeviceProfile(profile);
    this.clearCache();
    return this.device;
  }

  clearCache() {
    this.registerKeys.clear();
    this.currentKeyVersion = null;
    this.chapterCache.clear();
    this.pendingChapters.clear();
    this.metrics.currentKeyVersion = null;
  }

  status() {
    return {
      ...this.metrics,
      cachedKeyVersions: [...this.registerKeys.keys()],
      chapterCacheEntries: this.chapterCache.size,
      pendingChapters: this.pendingChapters.size
    };
  }

  async #fetchBatch(bookId, chapterIds, download, attempt = 0) {
    this.metrics.batchRequests += 1;
    const now = this.now();
    const params = buildCommonParams(this.device, now);
    params.set('item_ids', chapterIds.join(','));
    params.set('key_register_ts', '0');
    params.set('book_id', bookId);
    params.set('req_type', download ? '0' : '1');
    const url = `${CONTENT_BASE_URL}/reading/reader/batch_full/v?${params}`;
    const payload = await this.#signedRequest(url, {
      method: 'GET',
      headers: buildCommonHeaders(this.device, now, this.random)
    });
    if (Number(payload?.code) === 110 || payload?.message === 'ILLEGAL_ACCESS') {
      if (!this.onIllegalAccess) {
        throw new FqApiError('ILLEGAL_ACCESS', '章节接口拒绝访问，无法自动刷新模拟环境', 502);
      }
      if (attempt >= 1) {
        throw new FqApiError('ILLEGAL_ACCESS', '章节接口拒绝访问，自动刷新后重试仍失败', 502);
      }
      await this.#recoverIllegalAccess();
      return this.#fetchBatch(bookId, chapterIds, download, attempt + 1);
    }
    if (!payload?.data || typeof payload.data !== 'object') {
      throw new FqApiError('UPSTREAM_CONTENT_MISSING', payload?.message || '章节响应没有正文数据', 502);
    }
    return payload;
  }

  async #recoverIllegalAccess() {
    if (this.illegalAccessRecoveryPromise) return this.illegalAccessRecoveryPromise;
    this.illegalAccessRecoveryPromise = Promise.resolve().then(() => this.onIllegalAccess());
    try {
      return await this.illegalAccessRecoveryPromise;
    } catch (error) {
      throw new FqApiError(
        'ILLEGAL_ACCESS_REFRESH_FAILED',
        `章节接口拒绝访问，自动刷新失败：${error?.message || '未知错误'}`,
        502
      );
    } finally {
      this.illegalAccessRecoveryPromise = null;
    }
  }

  async #decryptItem(bookId, chapterId, item) {
    if (!item?.content) throw new Error('章节密文为空');
    const keyVersion = Number(item.key_version);
    const key = await this.#getDecryptionKey(Number.isFinite(keyVersion) ? keyVersion : null);
    const rawContent = decryptChapterContent(item.content, key);
    const txtContent = extractChapterText(rawContent);
    this.metrics.decryptedChapters += 1;
    return {
      chapterId,
      bookId,
      title: String(item.title || extractChapterTitle(rawContent)),
      authorName: String(item.novel_data?.author || '未知作者'),
      rawContent,
      txtContent,
      wordCount: txtContent.length,
      updateTime: this.now(),
      keyVersion: Number.isFinite(keyVersion) ? keyVersion : null
    };
  }

  async #getDecryptionKey(requiredVersion) {
    if (requiredVersion != null && this.registerKeys.has(requiredVersion)) {
      return this.registerKeys.get(requiredVersion);
    }
    if (requiredVersion == null && this.currentKeyVersion != null) {
      return this.registerKeys.get(this.currentKeyVersion);
    }
    const result = await this.refreshRegisterKey();
    if (requiredVersion != null && result.keyVersion !== requiredVersion) {
      throw new Error(`RegisterKey 版本不匹配：需要 ${requiredVersion}，当前 ${result.keyVersion}`);
    }
    return result.key;
  }

  async #fetchRegisterKey() {
    this.metrics.registerKeyRequests += 1;
    const now = this.now();
    const params = buildCommonParams(this.device, now);
    const url = `${CONTENT_BASE_URL}/reading/crypt/registerkey?${params}`;
    const headers = buildCommonHeaders(this.device, now, this.random);
    headers.push(['content-type', 'application/json']);
    const body = JSON.stringify({
      content: createRegisterKeyContent(this.device.deviceId),
      keyver: 1
    });
    const payload = await this.#signedRequest(url, { method: 'POST', headers, body });
    if (Number(payload?.code) !== 0 || !payload?.data?.key) {
      throw new FqApiError('REGISTER_KEY_FAILED', payload?.message || 'RegisterKey 获取失败', 502);
    }
    const keyVersion = Number(payload.data.keyver);
    const key = decryptRegisterKey(payload.data.key);
    this.registerKeys.set(keyVersion, key);
    this.currentKeyVersion = keyVersion;
    this.metrics.currentKeyVersion = keyVersion;
    return { keyVersion, key };
  }

  async #signedRequest(url, options) {
    const signed = await this.worker.sign(url, options.headers);
    const headers = new Headers(options.headers);
    for (const [name, value] of signed.headers || []) headers.set(name, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new FqApiError('UPSTREAM_HTTP_ERROR', `上游接口返回 HTTP ${response.status}`, 502);
      }
      if (!text) throw new FqApiError('UPSTREAM_EMPTY_RESPONSE', '上游接口返回空响应', 502);
      try {
        this.metrics.lastError = null;
        return JSON.parse(text);
      } catch {
        throw new FqApiError('UPSTREAM_INVALID_JSON', '上游接口返回了无效 JSON', 502);
      }
    } catch (error) {
      const normalized = error instanceof FqApiError
        ? error
        : new FqApiError(
          error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_REQUEST_FAILED',
          error?.name === 'AbortError' ? '上游接口请求超时' : error?.message || '上游接口请求失败',
          error?.name === 'AbortError' ? 504 : 502
        );
      this.metrics.lastError = { code: normalized.code, message: normalized.message, at: this.now() };
      const retryable = ['UPSTREAM_EMPTY_RESPONSE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_REQUEST_FAILED'].includes(normalized.code);
      if (retryable && (options.attempt || 0) < 1) {
        clearTimeout(timeout);
        return this.#signedRequest(url, { ...options, attempt: (options.attempt || 0) + 1 });
      }
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  #cacheChapter(bookId, chapterId, chapter) {
    const key = `${bookId}:${chapterId}`;
    this.chapterCache.delete(key);
    this.chapterCache.set(key, { value: chapter, expiresAt: this.now() + CACHE_TTL_MS });
    while (this.chapterCache.size > MAX_CACHE_ENTRIES) {
      this.chapterCache.delete(this.chapterCache.keys().next().value);
    }
  }
}

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new FqApiError('INVALID_ARGUMENT', `${label}不能为空`, 400);
  return normalized;
}

function normalizeChapterIds(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

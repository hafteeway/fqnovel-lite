import {
  buildCommonHeaders,
  buildDirectoryParams,
  buildSearchParams,
  createDeviceProfile
} from './fq-device-profile.mjs';
import {
  mapBookInfo,
  normalizeDirectoryResponse,
  parseSearchResponse
} from './fq-response-mappers.mjs';

const SEARCH_BASE_URL = 'https://api5-normal-sinfonlinec.fqnovel.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 30_000;

export class FqApiClient {
  constructor(options = {}) {
    if (!options.worker) throw new Error('FqApiClient requires a Java worker');
    this.worker = options.worker;
    this.device = createDeviceProfile(options.device);
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.delay = options.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.directoryCache = new Map();
    this.metrics = {
      requests: 0,
      successes: 0,
      failures: 0,
      lastRequestAt: null,
      lastSuccessAt: null,
      lastError: null
    };
  }

  async searchBooks(input = {}) {
    const request = normalizeSearchRequest(input);
    if (!request.query) throw new FqApiError('INVALID_ARGUMENT', '搜索关键词不能为空', 400);

    if (request.searchId) {
      const result = await this.#performSearch({ ...request, isFirstEnterSearch: false });
      result.searchId ||= request.searchId;
      return result;
    }

    const first = await this.#performSearch({ ...request, isFirstEnterSearch: true });
    if (!first.searchId) return first;

    const interval = 1_000 + Math.floor(this.random() * 1_000);
    await this.delay(interval);
    const second = await this.#performSearch({
      ...request,
      searchId: first.searchId,
      isFirstEnterSearch: false,
      lastSearchPageInterval: interval
    });
    second.searchId ||= first.searchId;
    return second;
  }

  async getDirectory(bookId, options = {}) {
    const normalizedBookId = String(bookId || '').trim();
    if (!normalizedBookId) throw new FqApiError('INVALID_ARGUMENT', '书籍 ID 不能为空', 400);

    const cacheKey = `${normalizedBookId}:${options.needVersion ?? true}`;
    const cached = this.directoryCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const now = this.now();
    const params = buildDirectoryParams(this.device, {
      bookId: normalizedBookId,
      bookType: options.bookType ?? 0,
      needVersion: options.needVersion ?? true,
      itemDataListMd5: options.itemDataListMd5,
      catalogDataMd5: options.catalogDataMd5,
      bookInfoMd5: options.bookInfoMd5
    }, now);
    const url = `${SEARCH_BASE_URL}/reading/bookapi/directory/all_items/v?${params}`;
    const payload = await this.#signedGet(url, buildCommonHeaders(this.device, now, this.random));
    const directory = normalizeDirectoryResponse(payload);
    this.directoryCache.set(cacheKey, { value: directory, expiresAt: this.now() + CACHE_TTL_MS });
    return directory;
  }

  async getBookInfo(bookId) {
    const directory = await this.getDirectory(bookId, { needVersion: true });
    if (!directory.book_info) {
      throw new FqApiError('BOOK_INFO_MISSING', '目录响应中没有书籍详情', 502);
    }
    return mapBookInfo(directory, String(bookId));
  }

  setDeviceProfile(profile) {
    this.device = createDeviceProfile(profile);
    this.clearCache();
    return this.device;
  }

  clearCache() {
    this.directoryCache.clear();
  }

  status() {
    return {
      ...this.metrics,
      cacheEntries: this.directoryCache.size,
      upstream: SEARCH_BASE_URL
    };
  }

  async #performSearch(request) {
    const now = this.now();
    const params = buildSearchParams(this.device, request, now);
    const url = `${SEARCH_BASE_URL}/reading/bookapi/search/tab/v?${params}`;
    const headers = buildCommonHeaders(this.device, now, this.random);
    headers.push(['authorization', 'Bearer']);
    const payload = await this.#signedGet(url, headers);
    return parseSearchResponse(payload, request.tabType);
  }

  async #signedGet(url, headers) {
    this.metrics.requests += 1;
    this.metrics.lastRequestAt = this.now();
    const signed = await this.worker.sign(url, headers);
    const mergedHeaders = new Headers(headers);
    for (const [name, value] of signed.headers || []) mergedHeaders.set(name, value);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers: mergedHeaders,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new FqApiError('UPSTREAM_HTTP_ERROR', `上游接口返回 HTTP ${response.status}`, 502, {
          upstreamStatus: response.status,
          body: text.slice(0, 300)
        });
      }
      if (!text.trim()) {
        throw new FqApiError(
          'UPSTREAM_EMPTY_RESPONSE',
          '上游搜索接口返回空响应，当前设备信息未通过校验，请在设置中切换模拟设备后重试',
          502,
          {
            contentType: response.headers.get('content-type'),
            contentLength: text.length
          }
        );
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new FqApiError('UPSTREAM_INVALID_JSON', '上游接口返回了无效 JSON', 502, {
          contentType: response.headers.get('content-type'),
          contentEncoding: response.headers.get('content-encoding'),
          contentLength: text.length,
          prefix: text.slice(0, 120)
        });
      }
      this.metrics.successes += 1;
      this.metrics.lastSuccessAt = this.now();
      this.metrics.lastError = null;
      return payload;
    } catch (error) {
      this.metrics.failures += 1;
      const normalized = normalizeRequestError(error);
      this.metrics.lastError = { code: normalized.code, message: normalized.message, at: this.now() };
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FqApiError extends Error {
  constructor(code, message, httpStatus = 500, details = null) {
    super(message);
    this.name = 'FqApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

function normalizeSearchRequest(input) {
  return {
    ...input,
    query: String(input.query || '').trim(),
    tabType: boundedInteger(input.tabType, 3, 1, 20),
    offset: boundedInteger(input.offset, 0, 0, 100_000),
    count: boundedInteger(input.count, 20, 1, 50),
    searchId: input.searchId ? String(input.searchId) : ''
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeRequestError(error) {
  if (error instanceof FqApiError) return error;
  if (error?.name === 'AbortError') {
    return new FqApiError('UPSTREAM_TIMEOUT', '上游接口请求超时', 504);
  }
  return new FqApiError('UPSTREAM_REQUEST_FAILED', error?.message || '上游接口请求失败', 502);
}

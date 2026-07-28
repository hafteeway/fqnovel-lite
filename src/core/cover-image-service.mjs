import heicConvert from 'heic-convert';

const ALLOWED_IMAGE_DOMAINS = ['fqnovelpic.com', 'bytecdn.cn'];
const PASSTHROUGH_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export class CoverImageService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.convert = options.convert || heicConvert;
    this.transform = options.transform || ((dataUrl) => dataUrl);
    this.timeoutMs = options.timeoutMs || 12_000;
    this.maxBytes = options.maxBytes || 5 * 1024 * 1024;
    this.maxEntries = options.maxEntries || 32;
    this.cache = new Map();
  }

  async getDataUrl(value) {
    const url = validateCoverUrl(value);
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const pending = this.#downloadAndConvert(url);
    this.cache.set(key, pending);
    this.#trimCache();

    try {
      return await pending;
    } catch (error) {
      if (this.cache.get(key) === pending) this.cache.delete(key);
      throw error;
    }
  }

  clear() {
    this.cache.clear();
  }

  async #downloadAndConvert(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/heic,image/*;q=0.8',
          'user-agent': 'Mozilla/5.0 FQNovel Desktop'
        }
      });
      if (!response.ok) throw new Error(`封面请求失败（HTTP ${response.status}）`);

      const announcedSize = Number(response.headers.get('content-length') || 0);
      if (announcedSize > this.maxBytes) throw new Error('封面文件过大');

      const input = Buffer.from(await response.arrayBuffer());
      if (input.length === 0) throw new Error('封面文件为空');
      if (input.length > this.maxBytes) throw new Error('封面文件过大');

      const contentType = normalizeContentType(response.headers.get('content-type'));
      const isHeic = contentType === 'image/heic'
        || contentType === 'image/heif'
        || /\.hei[cf]$/i.test(url.pathname);

      if (isHeic) {
        const output = Buffer.from(await this.convert({
          buffer: input,
          format: 'JPEG',
          quality: 0.82
        }));
        const dataUrl = `data:image/jpeg;base64,${output.toString('base64')}`;
        return this.transform(dataUrl);
      }

      if (!PASSTHROUGH_MIME_TYPES.has(contentType)) {
        throw new Error(`不支持的封面格式：${contentType || 'unknown'}`);
      }
      const dataUrl = `data:${contentType};base64,${input.toString('base64')}`;
      return this.transform(dataUrl);
    } finally {
      clearTimeout(timer);
    }
  }

  #trimCache() {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}

function validateCoverUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('封面地址无效');
  }
  if (url.protocol !== 'https:') throw new Error('封面地址必须使用 HTTPS');
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_IMAGE_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (!allowed) throw new Error('封面地址不在允许的域名中');
  return url;
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

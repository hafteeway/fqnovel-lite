import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const REGISTER_KEY_HEX = 'ac25c67ddd8f38c1b37a2348828e222e';

export function createRegisterKeyContent(deviceId, value = 0n, options = {}) {
  const payload = Buffer.alloc(16);
  payload.writeBigInt64LE(BigInt(deviceId), 0);
  payload.writeBigInt64LE(BigInt(value), 8);
  const iv = options.iv ? Buffer.from(options.iv) : randomBytes(16);
  return encryptWithPrefixedIv(payload, REGISTER_KEY_HEX, iv).toString('base64');
}

export function decryptRegisterKey(encryptedKey) {
  const decrypted = decryptWithPrefixedIv(encryptedKey, REGISTER_KEY_HEX);
  if (decrypted.length < 16) throw new Error('RegisterKey 解密结果不足 16 字节');
  return decrypted.subarray(0, 16).toString('hex');
}

export function decryptChapterContent(encryptedContent, keyHex) {
  const decrypted = decryptWithPrefixedIv(encryptedContent, keyHex);
  const content = decrypted.length >= 2 && decrypted[0] === 0x1f && decrypted[1] === 0x8b
    ? gunzipSync(decrypted)
    : decrypted;
  return content.toString('utf8');
}

export function extractChapterText(htmlContent) {
  if (!htmlContent || !String(htmlContent).trim()) return '';
  const html = String(htmlContent).replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, '');
  const parts = [];
  const pattern = /<blk[^>]*>([\s\S]*?)<\/blk>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const text = decodeHtmlEntities(stripTags(match[1])).trim();
    if (text) parts.push(text);
  }
  if (parts.length > 0) return parts.join('\n');
  return decodeHtmlEntities(stripTags(html)).trim();
}

export function extractChapterTitle(htmlContent, fallback = '章节标题') {
  const match = /<h1[^>]*>[\s\S]*?<blk[^>]*>([\s\S]*?)<\/blk>[\s\S]*?<\/h1>/i
    .exec(String(htmlContent || ''));
  const title = match ? decodeHtmlEntities(stripTags(match[1])).trim() : '';
  return title || fallback;
}

function decryptWithPrefixedIv(encodedData, keyHex) {
  const raw = Buffer.from(String(encodedData || ''), 'base64');
  if (raw.length < 32) throw new Error('AES 密文长度不足');
  const key = parseKey(keyHex);
  const iv = raw.subarray(0, 16);
  const ciphertext = raw.subarray(16);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptWithPrefixedIv(data, keyHex, iv) {
  const key = parseKey(keyHex);
  if (iv.length !== 16) throw new Error('AES IV 必须是 16 字节');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(data), cipher.final()]);
}

function parseKey(keyHex) {
  if (!/^[0-9a-f]{32}$/i.test(String(keyHex || ''))) {
    throw new Error('AES Key 必须是 32 位十六进制字符串');
  }
  return Buffer.from(keyHex, 'hex');
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

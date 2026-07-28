import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv
} from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  createRegisterKeyContent,
  decryptChapterContent,
  decryptRegisterKey,
  extractChapterText,
  extractChapterTitle,
  REGISTER_KEY_HEX
} from '../src/core/fq-crypto.mjs';
import { FqContentService } from '../src/core/fq-content-service.mjs';

test('creates the register payload with two little-endian 64-bit values', () => {
  const iv = Buffer.alloc(16, 0x11);
  const encoded = createRegisterKeyContent('4223674528607515', 0n, { iv });
  const raw = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(REGISTER_KEY_HEX, 'hex'),
    raw.subarray(0, 16)
  );
  const payload = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);

  assert.equal(payload.readBigInt64LE(0), 4223674528607515n);
  assert.equal(payload.readBigInt64LE(8), 0n);
});

test('decrypts register keys and gzipped chapter content', () => {
  const chapterKey = '00112233445566778899aabbccddeeff';
  const encryptedRegisterKey = encryptWithPrefixedIv(
    Buffer.from(chapterKey, 'hex'),
    REGISTER_KEY_HEX,
    Buffer.alloc(16, 0x22)
  );
  const html = '<article><blk>第一段</blk><blk>第二段 &amp; 内容</blk></article>';
  const encryptedChapter = encryptWithPrefixedIv(
    gzipSync(Buffer.from(html)),
    chapterKey,
    Buffer.alloc(16, 0x33)
  );

  assert.equal(decryptRegisterKey(encryptedRegisterKey), chapterKey);
  assert.equal(decryptChapterContent(encryptedChapter, chapterKey), html);
  assert.equal(extractChapterText(html), '第一段\n第二段 & 内容');
});

test('omits the chapter heading from extracted body text', () => {
  const html = '<article><h1><blk>第一章 标题</blk></h1><blk>第一段正文</blk><blk>第二段正文</blk></article>';

  assert.equal(extractChapterTitle(html), '第一章 标题');
  assert.equal(extractChapterText(html), '第一段正文\n第二段正文');
});

test('fetches RegisterKey, decrypts a chapter and caches the result', async () => {
  const chapterKey = '102132435465768798a9bacbdcedfe0f';
  const encryptedRegisterKey = encryptWithPrefixedIv(
    Buffer.from(chapterKey, 'hex'),
    REGISTER_KEY_HEX,
    Buffer.alloc(16, 0x44)
  );
  const html = '<article><blk>缓存测试第一段</blk><blk>缓存测试第二段</blk></article>';
  const encryptedChapter = encryptWithPrefixedIv(
    gzipSync(Buffer.from(html)),
    chapterKey,
    Buffer.alloc(16, 0x55)
  );
  const signed = [];
  const requests = [];
  let registerAttempts = 0;
  const worker = {
    async sign(url, headers) {
      signed.push({ url, headers });
      return { headers: [['X-Argus', 'signature']] };
    }
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/reading/crypt/registerkey')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.get('content-type'), 'application/json');
      registerAttempts += 1;
      if (registerAttempts === 1) return new Response('', { status: 200 });
      return new Response(JSON.stringify({
        code: 0,
        message: 'success',
        data: { key: encryptedRegisterKey, keyver: 7 }
      }), { status: 200 });
    }
    assert.equal(new URL(url).searchParams.get('item_ids'), 'chapter-1');
    return new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        'chapter-1': {
          code: 0,
          title: '第一章',
          content: encryptedChapter,
          key_version: 7,
          novel_data: { author: '测试作者' }
        }
      }
    }), { status: 200 });
  };
  const service = new FqContentService({
    worker,
    fetch,
    now: () => 1_750_000_000_000,
    random: () => 0
  });

  const first = await service.getChapter('book-1', 'chapter-1');
  const second = await service.getChapter('book-1', 'chapter-1');

  assert.equal(first.txtContent, '缓存测试第一段\n缓存测试第二段');
  assert.equal(first.authorName, '测试作者');
  assert.equal(second, first);
  assert.equal(requests.length, 3);
  assert.equal(signed.length, 3);
  assert.equal(service.status().cacheHits, 1);
  assert.equal(service.status().currentKeyVersion, 7);
});

test('automatically refreshes the simulated device and retries once after ILLEGAL_ACCESS', async () => {
  const chapterKey = '2031425364758697a8b9cadbecfd0e1f';
  const encryptedRegisterKey = encryptWithPrefixedIv(
    Buffer.from(chapterKey, 'hex'),
    REGISTER_KEY_HEX,
    Buffer.alloc(16, 0x66)
  );
  const encryptedChapter = encryptWithPrefixedIv(
    gzipSync(Buffer.from('<article><blk>自动刷新成功</blk></article>')),
    chapterKey,
    Buffer.alloc(16, 0x77)
  );
  let batchAttempts = 0;
  let refreshes = 0;
  const service = new FqContentService({
    worker: {
      async sign() {
        return { headers: [] };
      }
    },
    fetch: async (url) => {
      if (url.includes('/reading/crypt/registerkey')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { key: encryptedRegisterKey, keyver: 9 }
        }), { status: 200 });
      }
      batchAttempts += 1;
      if (batchAttempts === 1) {
        return new Response(JSON.stringify({
          code: 110,
          message: 'ILLEGAL_ACCESS'
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          'chapter-1': {
            code: 0,
            title: '第一章',
            content: encryptedChapter,
            key_version: 9
          }
        }
      }), { status: 200 });
    },
    onIllegalAccess: async () => {
      refreshes += 1;
    }
  });

  const chapter = await service.getChapter('book-1', 'chapter-1');

  assert.equal(chapter.txtContent, '自动刷新成功');
  assert.equal(batchAttempts, 2);
  assert.equal(refreshes, 1);
});

test('stops after one automatic refresh when ILLEGAL_ACCESS persists', async () => {
  let batchAttempts = 0;
  let refreshes = 0;
  const service = new FqContentService({
    worker: {
      async sign() {
        return { headers: [] };
      }
    },
    fetch: async () => {
      batchAttempts += 1;
      return new Response(JSON.stringify({
        code: 110,
        message: 'ILLEGAL_ACCESS'
      }), { status: 200 });
    },
    onIllegalAccess: async () => {
      refreshes += 1;
    }
  });

  await assert.rejects(
    service.getChapter('book-1', 'chapter-1'),
    (error) => error.code === 'ILLEGAL_ACCESS'
      && error.message.includes('自动刷新后重试仍失败')
  );
  assert.equal(batchAttempts, 2);
  assert.equal(refreshes, 1);
});
function encryptWithPrefixedIv(data, keyHex, iv) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, ciphertext]).toString('base64');
}

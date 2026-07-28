import assert from 'node:assert/strict';
import test from 'node:test';
import { CoverImageService } from '../src/core/cover-image-service.mjs';

test('converts HEIC covers to JPEG data URLs and caches the result', async () => {
  let fetchCount = 0;
  let convertCount = 0;
  const service = new CoverImageService({
    fetch: async () => {
      fetchCount += 1;
      return new Response(Buffer.from('fake-heic'), {
        status: 200,
        headers: { 'content-type': 'image/heic' }
      });
    },
    convert: async ({ buffer, format, quality }) => {
      convertCount += 1;
      assert.equal(buffer.toString(), 'fake-heic');
      assert.equal(format, 'JPEG');
      assert.equal(quality, 0.82);
      return Buffer.from('fake-jpeg');
    },
    transform: (dataUrl) => {
      assert.match(dataUrl, /^data:image\/jpeg;base64,/);
      return `${dataUrl}#optimized`;
    }
  });

  const url = 'https://p3-sign.fqnovelpic.com/example.heic';
  const [first, second] = await Promise.all([
    service.getDataUrl(url),
    service.getDataUrl(url)
  ]);

  assert.equal(first, `data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')}#optimized`);
  assert.equal(second, first);
  assert.equal(fetchCount, 1);
  assert.equal(convertCount, 1);
});

test('passes supported browser image formats through unchanged', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const service = new CoverImageService({
    fetch: async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg; charset=binary' }
    })
  });

  const result = await service.getDataUrl('https://p6-tt.bytecdn.cn/example.jpeg');
  assert.equal(result, `data:image/jpeg;base64,${bytes.toString('base64')}`);
});

test('rejects cover URLs outside the upstream image domains', async () => {
  let called = false;
  const service = new CoverImageService({
    fetch: async () => {
      called = true;
      return new Response();
    }
  });

  await assert.rejects(
    service.getDataUrl('https://example.com/cover.heic'),
    /不在允许的域名/
  );
  assert.equal(called, false);
});

test('does not cache failed downloads', async () => {
  let fetchCount = 0;
  const service = new CoverImageService({
    fetch: async () => {
      fetchCount += 1;
      return new Response('', { status: 503 });
    }
  });

  const url = 'https://p3-sign.fqnovelpic.com/failure.heic';
  await assert.rejects(service.getDataUrl(url), /HTTP 503/);
  await assert.rejects(service.getDataUrl(url), /HTTP 503/);
  assert.equal(fetchCount, 2);
});

test('evicts old cover entries from the bounded memory cache', async () => {
  const fetchCounts = new Map();
  const service = new CoverImageService({
    maxEntries: 2,
    fetch: async (url) => {
      const key = String(url);
      fetchCounts.set(key, (fetchCounts.get(key) || 0) + 1);
      return new Response(Buffer.from(key), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      });
    }
  });
  const first = 'https://p3-sign.fqnovelpic.com/first.jpg';
  const second = 'https://p3-sign.fqnovelpic.com/second.jpg';
  const third = 'https://p3-sign.fqnovelpic.com/third.jpg';

  await service.getDataUrl(first);
  await service.getDataUrl(second);
  await service.getDataUrl(third);
  await service.getDataUrl(first);

  assert.equal(fetchCounts.get(first), 2);
  assert.equal(fetchCounts.get(second), 1);
  assert.equal(fetchCounts.get(third), 1);
});

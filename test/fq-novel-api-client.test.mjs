import test from 'node:test';
import assert from 'node:assert/strict';
import { FqNovelApiClient } from '../src/core/fq-novel-api-client.mjs';

test('prefetches stable ten-chapter blocks and shares concurrent requests', async () => {
  const contentCalls = [];
  const content = {
    async getChapters(bookId, chapterIds) {
      contentCalls.push({ bookId, chapterIds: [...chapterIds] });
      return {
        failures: {},
        chapters: Object.fromEntries(chapterIds.map((chapterId) => [
          chapterId,
          {
            bookId,
            chapterId,
            title: chapterId,
            txtContent: `body:${chapterId}`
          }
        ]))
      };
    },
    clearCache() {},
    setDeviceProfile(profile) {
      return profile;
    },
    refreshRegisterKey() {},
    status() {
      return {};
    }
  };
  const directoryItems = Array.from({ length: 12 }, (_, index) => ({
    item_id: `chapter-${index + 1}`,
    title: `chapter-${index + 1}`
  }));
  const api = new FqNovelApiClient({
    worker: {
      async sign() {
        return { headers: [] };
      }
    },
    content,
    fetch: async () => new Response(JSON.stringify({
      data: {
        item_data_list: directoryItems
      }
    }), { status: 200 })
  });

  await api.getDirectory('book-1');
  const [third, fourth] = await Promise.all([
    api.getChapter('book-1', 'chapter-3'),
    api.getChapter('book-1', 'chapter-4')
  ]);

  assert.equal(third.chapterId, 'chapter-3');
  assert.equal(fourth.chapterId, 'chapter-4');
  assert.equal(contentCalls.length, 1);
  assert.deepEqual(
    contentCalls[0].chapterIds,
    Array.from({ length: 10 }, (_, index) => `chapter-${index + 1}`)
  );

  const eleventh = await api.getChapter('book-1', 'chapter-11');
  assert.equal(eleventh.chapterId, 'chapter-11');
  assert.deepEqual(contentCalls[1].chapterIds, ['chapter-11', 'chapter-12']);
  assert.deepEqual(api.status().prefetch, {
    batchSize: 10,
    directoryIndexes: 1,
    activeBatches: 0
  });
});

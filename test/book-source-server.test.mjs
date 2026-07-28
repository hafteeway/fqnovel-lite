import test from 'node:test';
import assert from 'node:assert/strict';
import { BookSourceServer } from '../src/core/book-source-server.mjs';

test('serves health and a local book source', async () => {
  const server = new BookSourceServer({
    host: '127.0.0.1',
    port: 0,
    workerStatus: () => ({ state: 'ready' })
  });
  await server.start();
  try {
    const baseUrl = server.status().baseUrl;
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json());
    assert.equal(health.status, 'UP');
    assert.equal(health.worker.state, 'ready');

    const source = await fetch(`${baseUrl}/book-source/fqnovel.json`).then((response) => response.json());
    assert.equal(source[0].bookSourceUrl, baseUrl);
    assert.match(source[0].searchUrl, /api\/fqsearch\/books/);
    assert.equal(source[0].enabledCookieJar, false);
    assert.equal(source[0].enabledExplore, false);
    assert.equal(source[0].ruleBookInfo.wordCount, '$.data.wordCount');
    assert.equal(source[0].ruleBookInfo.kind, '$.data.detailTags[*]');
    assert.equal(source[0].ruleBookInfo.intro, '$.data.detailIntro||$.data.description||$.data.bookAbstractV2');
    assert.equal(
      source[0].ruleBookInfo.updateTime,
      '$.data.updateTimeText||$.data.lastChapterUpdateTime'
    );
    assert.match(source[0].ruleBookInfo.coverUrl, /detailPageThumbUrl/);
    assert.equal(source[0].ruleSearch.updateTime, '$.lastChapterUpdateTime');
    assert.equal(source[0].ruleContent.content, '$.data.txtContent');
    assert.equal('title' in source[0].ruleContent, false);
    assert.equal(source[0].ruleSearch.kind, '$.searchTags[*]');
  } finally {
    await server.stop();
  }
});

test('returns 503 during manual unidbg refresh', async () => {
  const server = new BookSourceServer({ host: '127.0.0.1', port: 0 });
  await server.start();
  server.setMaintenance(true);
  try {
    const response = await fetch(`${server.status().baseUrl}/book-source/fqnovel.json`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '5');
  } finally {
    await server.stop();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BookSourceServer } from '../src/core/book-source-server.mjs';

test('exposes management operations on loopback', async () => {
  const calls = [];
  const management = {
    listDownloads: () => [],
    createDownload: (bookId, options) => {
      calls.push(['create', bookId, options.format]);
      return { id: 'task-1', bookId };
    },
    controlDownload: (taskId, action) => {
      calls.push([action, taskId]);
      return { id: taskId, status: action };
    },
  };
  const server = new BookSourceServer({ host: '127.0.0.1', port: 0, management });
  await server.start();
  try {
    const baseUrl = server.status().baseUrl;

    const task = await post(`${baseUrl}/api/v1/downloads`, {
      bookId: 'book-1',
      format: 'epub'
    });
    assert.equal(task.data.id, 'task-1');
    const paused = await post(`${baseUrl}/api/v1/downloads/task-1/pause`, {});
    assert.equal(paused.data.status, 'pause');
    assert.deepEqual(calls, [['create', 'book-1', 'epub'], ['pause', 'task-1']]);
  } finally {
    await server.stop();
  }
});

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then((response) => response.json());
}

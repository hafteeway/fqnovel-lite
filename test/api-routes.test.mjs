import test from 'node:test';
import assert from 'node:assert/strict';
import { BookSourceServer } from '../src/core/book-source-server.mjs';

test('exposes search, directory and book detail routes', async () => {
  const calls = [];
  const api = {
    async searchBooks(request) {
      calls.push(['search', request]);
      return { books: [{ bookId: 'book-1' }], total: 1, hasMore: false, searchId: 'sid' };
    },
    async getDirectory(bookId, options) {
      calls.push(['directory', bookId, options]);
      return { item_data_list: [{ item_id: 'chapter-1', title: '第一章' }] };
    },
    async getBookInfo(bookId) {
      calls.push(['book', bookId]);
      return { bookId, bookName: '测试书籍' };
    }
  };
  const server = new BookSourceServer({ host: '127.0.0.1', port: 0, api });
  await server.start();
  try {
    const baseUrl = server.status().baseUrl;
    const searchResponse = await fetch(`${baseUrl}/api/fqsearch/books?query=%E6%B5%8B%E8%AF%95&tabType=3`);
    const search = await searchResponse.json();
    assert.equal(searchResponse.status, 200);
    assert.equal(search.code, 0);
    assert.equal(search.data.books[0].bookId, 'book-1');

    const directory = await fetch(`${baseUrl}/api/fqsearch/directory/book-1`).then((response) => response.json());
    assert.equal(directory.data.item_data_list[0].item_id, 'chapter-1');

    const book = await fetch(`${baseUrl}/api/fqnovel/book/book-1`).then((response) => response.json());
    assert.equal(book.data.bookName, '测试书籍');
    assert.equal(calls[0][1].query, '测试');
  } finally {
    await server.stop();
  }
});

test('exposes decrypted chapter routes', async () => {
  const api = {
    async getChapter(bookId, chapterId) {
      return { bookId, chapterId, title: '第一章', txtContent: '正文' };
    },
    async getChapters(bookId, chapterIds) {
      return { bookId, chapters: { [chapterIds[0]]: { chapterId: chapterIds[0] } } };
    }
  };
  const server = new BookSourceServer({ host: '127.0.0.1', port: 0, api });
  await server.start();
  try {
    const baseUrl = server.status().baseUrl;
    const chapterResponse = await fetch(`${baseUrl}/api/fqnovel/chapter/book-1/chapter-1`);
    const chapter = await chapterResponse.json();
    assert.equal(chapterResponse.status, 200);
    assert.equal(chapter.data.txtContent, '正文');

    const batch = await fetch(`${baseUrl}/api/fqnovel/chapters/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 'book-1', chapterIds: ['chapter-1'] })
    }).then((response) => response.json());
    assert.equal(batch.data.chapters['chapter-1'].chapterId, 'chapter-1');
  } finally {
    await server.stop();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FqApiClient } from '../src/core/fq-api-client.mjs';
import { mapBookInfo } from '../src/core/fq-response-mappers.mjs';

test('performs two-phase signed search and maps book fields', async () => {
  const signedRequests = [];
  const fetchedRequests = [];
  const delays = [];
  const worker = {
    async sign(url, headers) {
      signedRequests.push({ url, headers });
      return { headers: [['X-Argus', 'signed-value']] };
    }
  };
  const fetch = async (url, options) => {
    fetchedRequests.push({ url, options });
    const searchId = new URL(url).searchParams.get('search_id');
    const tab = {
      tab_type: 3,
      search_id: 'sid-1',
      total: searchId ? 1 : 0,
      has_more: false,
      data: searchId ? [{
        book_data: [{
          book_id: 'book-1',
          book_name: '测试小说',
          author: '测试作者',
          abstract: '简介',
          thumb_url: 'https://img.example/cover.jpg',
          word_number: '12345',
          serial_count: '9',
          score: '8.6',
          read_cnt_text: '1.2万人在读',
          last_chapter_title: '第九章',
          tags: ['悬疑', '都市'],
          category: '悬疑',
          genre: '0',
          sub_genre: '1',
          tomato_book_status: '1',
          complete_category: '已完结',
          creation_status: '0',
          update_status: '0'
        }]
      }] : []
    };
    return new Response(JSON.stringify({ search_tabs: [tab] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const api = new FqApiClient({
    worker,
    fetch,
    now: () => 1_750_000_000_000,
    random: () => 0,
    delay: async (milliseconds) => delays.push(milliseconds)
  });

  const result = await api.searchBooks({ query: '测试 小说', tabType: 3 });

  assert.equal(signedRequests.length, 2);
  assert.equal(fetchedRequests.length, 2);
  assert.deepEqual(delays, [1_000]);
  assert.equal(new URL(signedRequests[0].url).searchParams.get('query'), '测试 小说');
  assert.equal(new URL(signedRequests[1].url).searchParams.get('search_id'), 'sid-1');
  assert.ok(signedRequests[0].headers.some(([name, value]) => name === 'authorization' && value === 'Bearer'));
  assert.equal(fetchedRequests[1].options.headers.get('x-argus'), 'signed-value');
  assert.deepEqual(result, {
    books: [{
      bookId: 'book-1',
      bookName: '测试小说',
      bookShortName: '',
      author: '测试作者',
      authorId: '',
      authorInfo: null,
      description: '简介',
      bookAbstractV2: '',
      coverUrl: 'https://img.example/cover.jpg',
      detailPageThumbUrl: '',
      expandThumbUrl: '',
      horizThumbUrl: '',
      status: '1',
      tomatoBookStatus: '1',
      statusText: '已完结',
      creationStatus: '0',
      updateStatus: '0',
      wordCount: 12345,
      totalChapters: 9,
      firstChapterTitle: '',
      firstChapterItemId: '',
      lastChapterTitle: '第九章',
      lastChapterItemId: '',
      updateTime: 0,
      lastChapterUpdateTime: '',
      category: '悬疑',
      categoryV2: '',
      completeCategory: '已完结',
      genre: '0',
      subGenre: '1',
      tags: ['悬疑', '都市'],
      tagsStr: '悬疑,都市',
      searchTags: ['悬疑', '都市', '已完结', '评分 8.6', '9章', '1.2万人在读'],
      gender: '',
      rating: 8.6,
      readCount: '',
      readCntText: '1.2万人在读',
      addBookshelfCount: '',
      source: '',
      platform: ''
    }],
    total: 1,
    hasMore: false,
    searchId: 'sid-1'
  });
});

test('derives completion from lifecycle status and ignores genre paths in complete_category', () => {
  const ongoing = mapBookInfo({
    book_info: {
      book_id: 'ongoing',
      status: '1',
      tomato_book_status: '1',
      creation_status: '1',
      update_status: '1'
    }
  }, 'ongoing');
  const completed = mapBookInfo({
    book_info: {
      book_id: 'completed',
      status: '1',
      tomato_book_status: '1',
      complete_category: '男生/玄幻/异世大陆',
      creation_status: '0',
      update_status: '0'
    }
  }, 'completed');
  const unknown = mapBookInfo({
    book_info: { book_id: 'unknown', status: '1', tomato_book_status: '1' }
  }, 'unknown');

  assert.equal(ongoing.statusText, '连载中');
  assert.equal(completed.statusText, '已完结');
  assert.equal(unknown.statusText, '');
});

test('reports an empty search response as an invalid device instead of invalid JSON', async () => {
  const worker = {
    async sign() {
      return { headers: [['X-Argus', 'signed-value']] };
    }
  };
  const api = new FqApiClient({
    worker,
    fetch: async () => new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }),
    delay: async () => {}
  });

  await assert.rejects(
    api.searchBooks({ query: '剑来', tabType: 3 }),
    (error) => error.code === 'UPSTREAM_EMPTY_RESPONSE'
      && error.message.includes('当前设备信息未通过校验')
  );
});

test('normalizes directory data and reuses it for book details', async () => {
  let fetchCount = 0;
  const worker = { async sign() { return { headers: [['X-Argus', 'ok']] }; } };
  const fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      data: {
        serial_count: '2',
        book_info: {
          book_id: 'book-2',
          book_name: '目录测试',
          author: '作者',
          abstract: '书籍简介',
          thumb_url: 'https://img.example/book-2.jpg',
          word_number: '5000',
          category: '玄幻',
          category_v2: JSON.stringify([{ Name: '东方玄幻' }, { Name: '穿越' }]),
          complete_category: '男生/玄幻/东方玄幻',
          genre: '0',
          sub_genre: '1',
          tags: ['升级流', '热血'],
          pure_category_tags: '男频,玄幻',
          score: '9.3',
          status: '1',
          tomato_book_status: '1',
          creation_status: '0',
          update_status: '0',
          read_cnt_text: '2.5万人在读',
          last_chapter_title: '第二章',
          last_chapter_update_time: '1700000100',
          publisher: '测试出版社'
        },
        item_data_list: [
          { item_id: 'chapter-1', title: '第一章', first_pass_time: 1_700_000_000 },
          { item_id: 'chapter-2', title: '第二章', first_pass_time: 1_700_000_100 }
        ]
      }
    }), { status: 200 });
  };
  const api = new FqApiClient({ worker, fetch, now: () => 1_750_000_000_000 });

  const directory = await api.getDirectory('book-2');
  const book = await api.getBookInfo('book-2');

  assert.equal(fetchCount, 1);
  assert.equal(directory.item_data_list[0].chapter_index, 1);
  assert.equal(directory.item_data_list[1].is_latest, true);
  assert.equal(book.bookName, '目录测试');
  assert.equal(book.totalChapters, 2);
  assert.equal(book.wordCount, 5000);
  assert.equal(book.statusText, '已完结');
  assert.equal(book.tomatoBookStatus, '1');
  assert.equal(book.lastChapterTitle, '第二章');
  assert.equal(book.updateTimeText, '2023-11-14 22:15:00');
  assert.equal(book.publisher, '测试出版社');
  assert.deepEqual(book.tags, ['升级流', '热血']);
  assert.deepEqual(book.detailTags, ['玄幻', '东方玄幻', '穿越', '升级流', '热血', '男频']);
  assert.equal(book.detailIntro, '已完结 · 评分 9.3 · 2章 · 2.5万人在读\n\n书籍简介');
  assert.equal(api.status().cacheEntries, 1);
});

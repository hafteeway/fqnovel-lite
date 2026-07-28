import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppRuntime } from '../src/core/app-runtime.mjs';

const cwd = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-runtime-smoke-'));
const runtime = new AppRuntime({
  dataDir,
  workerOptions: { cwd },
  serverOptions: { host: '127.0.0.1', port: 0 }
});
runtime.on('log', ({ source, message }) => process.stderr.write(`[${source}] ${message}\n`));

try {
  await runtime.start();
  await runtime.setBookSourceEnabled(true);
  const status = runtime.status();
  const baseUrl = status.server.baseUrl;
  const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json());
  const source = await fetch(`${baseUrl}/book-source/fqnovel.json`).then((response) => response.json());
  const search = await fetch(
    `${baseUrl}/api/fqsearch/books?query=${encodeURIComponent(process.argv[2] || '剑来')}&tabType=3&count=5`
  ).then((response) => response.json());
  const firstBook = search.data?.books?.[0] || null;
  let directory = null;
  if (firstBook?.bookId) {
    directory = await fetch(`${baseUrl}/api/fqsearch/directory/${firstBook.bookId}`)
      .then((response) => response.json());
  }
  const firstChapter = directory?.data?.item_data_list?.[0] || null;
  let chapter = null;
  if (firstBook?.bookId && firstChapter?.item_id) {
    chapter = await fetch(
      `${baseUrl}/api/fqnovel/chapter/${firstBook.bookId}/${firstChapter.item_id}`
    ).then((response) => response.json());
  }
  if (firstChapter && !chapter?.data) process.exitCode = 1;
  console.log(JSON.stringify({
    health: health.status,
    worker: health.worker?.state,
    bookSourceUrl: source[0]?.bookSourceUrl,
    books: search.data?.books?.length ?? 0,
    firstBook: firstBook ? {
      bookId: firstBook.bookId,
      bookName: firstBook.bookName,
      author: firstBook.author
    } : null,
    chapters: directory?.data?.item_data_list?.length ?? null,
    chapter: chapter?.data ? {
      chapterId: chapter.data.chapterId,
      title: chapter.data.title,
      textLength: chapter.data.txtContent?.length ?? 0,
      keyVersion: chapter.data.keyVersion
    } : null,
    chapterError: chapter?.data ? null : {
      code: chapter?.code,
      error: chapter?.error,
      message: chapter?.message
    }
  }, null, 2));
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

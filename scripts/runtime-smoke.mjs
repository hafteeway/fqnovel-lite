import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppRuntime } from '../src/core/app-runtime.mjs';

const cwd = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-runtime-smoke-'));
const runtime = new AppRuntime({
  dataDir,
  workerOptions: { cwd }
});
runtime.on('log', ({ source, message }) => process.stderr.write(`[${source}] ${message}\n`));

try {
  await runtime.start();
  const search = await runtime.searchBooks({ query: process.argv[2] || '剑来', count: 5 });
  const firstBook = search.books?.[0] || null;
  let directory = null;
  if (firstBook?.bookId) {
    directory = await runtime.api.getDirectory(firstBook.bookId);
  }
  const firstChapter = directory?.item_data_list?.[0] || null;
  let chapter = null;
  if (firstBook?.bookId && firstChapter?.item_id) {
    chapter = await runtime.api.getChapter(firstBook.bookId, firstChapter.item_id);
  }
  if (firstChapter && !chapter) process.exitCode = 1;
  console.log(JSON.stringify({
    worker: runtime.status().worker.state,
    books: search.books?.length ?? 0,
    firstBook: firstBook ? {
      bookId: firstBook.bookId,
      bookName: firstBook.bookName,
      author: firstBook.author
    } : null,
    chapters: directory?.item_data_list?.length ?? null,
    chapter: chapter ? {
      chapterId: chapter.chapterId,
      title: chapter.title,
      textLength: chapter.txtContent?.length ?? 0,
      keyVersion: chapter.keyVersion
    } : null,
    chapterError: chapter ? null : '未取得正文'
  }, null, 2));
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}

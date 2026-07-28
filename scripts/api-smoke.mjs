import { JavaWorkerClient } from '../src/core/java-worker-client.mjs';
import { FqApiClient } from '../src/core/fq-api-client.mjs';

const cwd = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const worker = new JavaWorkerClient({ cwd });
worker.on('log', (line) => process.stderr.write(`${line}\n`));

try {
  await worker.start();
  const api = new FqApiClient({ worker });
  const search = await api.searchBooks({ query: process.argv[2] || '剑来', tabType: 3, count: 5 });
  const first = search.books[0] || null;
  let directory = null;
  if (first?.bookId) directory = await api.getDirectory(first.bookId);
  console.log(JSON.stringify({
    searchId: search.searchId,
    books: search.books.length,
    firstBook: first ? {
      bookId: first.bookId,
      bookName: first.bookName,
      author: first.author
    } : null,
    chapters: directory?.item_data_list?.length ?? null,
    api: api.status()
  }, null, 2));
} finally {
  await worker.stop();
}

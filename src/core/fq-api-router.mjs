export async function handleFqApiRequest({ request, response, url, api }) {
  if (!isImplementedRoute(url.pathname)) return false;
  if (!api) throw httpError('API_NOT_CONFIGURED', 'FQ API client is not configured', 503);

  if (request.method === 'GET' && url.pathname === '/api/fqsearch/books') {
    const data = await api.searchBooks({
      query: url.searchParams.get('query'),
      tabType: url.searchParams.get('tabType'),
      offset: url.searchParams.get('offset'),
      count: url.searchParams.get('count'),
      searchId: url.searchParams.get('searchId')
    });
    sendSuccess(response, data);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/fqsearch/quick') {
    const data = await api.searchBooks({
      query: url.searchParams.get('query'),
      tabType: 3,
      offset: 0,
      count: 10
    });
    sendSuccess(response, data);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/fqsearch/books') {
    sendSuccess(response, await api.searchBooks(await readJsonBody(request)));
    return true;
  }

  const directoryMatch = url.pathname.match(/^\/api\/fqsearch\/(?:directory|chapters)\/([^/]+)$/);
  if (request.method === 'GET' && directoryMatch) {
    const data = await api.getDirectory(decodeURIComponent(directoryMatch[1]), {
      needVersion: !url.pathname.includes('/chapters/')
    });
    sendSuccess(response, data);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/fqsearch/directory') {
    const body = await readJsonBody(request);
    sendSuccess(response, await api.getDirectory(body.bookId, body));
    return true;
  }

  const bookMatch = url.pathname.match(/^\/api\/fqnovel\/book\/([^/]+)$/);
  if (request.method === 'GET' && bookMatch) {
    sendSuccess(response, await api.getBookInfo(decodeURIComponent(bookMatch[1])));
    return true;
  }

  const chapterMatch = url.pathname.match(/^\/api\/fqnovel\/chapter\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && chapterMatch) {
    sendSuccess(response, await api.getChapter(
      decodeURIComponent(chapterMatch[1]),
      decodeURIComponent(chapterMatch[2])
    ));
    return true;
  }

  const itemMatch = url.pathname.match(/^\/api\/fqnovel\/item_id\/([^/]+)$/);
  if (request.method === 'GET' && itemMatch) {
    sendSuccess(response, await api.getChapter(
      url.searchParams.get('bookId'),
      decodeURIComponent(itemMatch[1])
    ));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/fqnovel/chapter') {
    const body = await readJsonBody(request);
    sendSuccess(response, await api.getChapter(body.bookId, body.chapterId));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/fqnovel/chapters/batch') {
    const body = await readJsonBody(request);
    sendSuccess(response, await api.getChapters(
      body.bookId,
      body.chapterIds || body.itemIds,
      { download: body.download }
    ));
    return true;
  }

  return false;
}

export function sendApiError(response, error) {
  sendJson(response, Number(error?.httpStatus) || 500, {
    code: -1,
    error: error?.code || 'INTERNAL_ERROR',
    message: error?.message || 'Internal Server Error',
    details: error?.details || null,
    serverTime: Date.now()
  });
}

function isImplementedRoute(pathname) {
  return pathname === '/api/fqsearch/books'
    || pathname === '/api/fqsearch/quick'
    || pathname === '/api/fqsearch/directory'
    || /^\/api\/fqsearch\/(?:directory|chapters)\/[^/]+$/.test(pathname)
    || /^\/api\/fqnovel\/book\/[^/]+$/.test(pathname)
    || /^\/api\/fqnovel\/chapter\/[^/]+\/[^/]+$/.test(pathname)
    || /^\/api\/fqnovel\/item_id\/[^/]+$/.test(pathname)
    || pathname === '/api/fqnovel/chapter'
    || pathname === '/api/fqnovel/chapters/batch';
}

function sendSuccess(response, data) {
  sendJson(response, 200, {
    code: 0,
    message: 'success',
    data,
    serverTime: Date.now()
  });
}

function sendJson(response, status, body) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw httpError('PAYLOAD_TOO_LARGE', '请求体过大', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError('INVALID_JSON', '请求体不是有效 JSON', 400);
  }
}

function httpError(code, message, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

const MANAGEMENT_PREFIXES = ['/api/v1/downloads'];

export async function handleManagementRequest({ request, response, url, management }) {
  if (!MANAGEMENT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false;
  if (!isLoopback(request.socket?.remoteAddress)) {
    sendJson(response, 403, { code: -1, message: '管理接口仅允许本机访问' });
    return true;
  }
  if (!management) {
    sendJson(response, 503, { code: -1, message: '本地管理功能尚未就绪' });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/downloads') {
    sendSuccess(response, await management.listDownloads());
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/downloads') {
    const body = await readJsonBody(request);
    sendSuccess(response, await management.createDownload(body.bookId, body));
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/v1\/downloads\/([^/]+)\/(pause|resume|cancel)$/);
  if (request.method === 'POST' && actionMatch) {
    const [, encodedTaskId, action] = actionMatch;
    sendSuccess(response, await management.controlDownload(decodeURIComponent(encodedTaskId), action));
    return true;
  }

  sendJson(response, 404, { code: -1, message: '管理接口不存在' });
  return true;
}

function isLoopback(address = '') {
  const normalized = String(address).toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function sendSuccess(response, data) {
  sendJson(response, 200, { code: 0, message: 'success', data, serverTime: Date.now() });
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
    if (size > 1_048_576) {
      const error = new Error('请求体过大');
      error.httpStatus = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求体不是有效 JSON');
    error.httpStatus = 400;
    throw error;
  }
}

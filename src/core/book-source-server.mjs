import http from 'node:http';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import { createBookSource } from './book-source.mjs';
import { handleFqApiRequest, sendApiError } from './fq-api-router.mjs';
import { handleManagementRequest } from './management-router.mjs';

export class BookSourceServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '0.0.0.0';
    this.port = options.port ?? 9999;
    this.server = null;
    this.maintenance = false;
    this.workerStatus = options.workerStatus || (() => ({ state: 'unknown' }));
    this.apiStatus = options.apiStatus || (() => null);
    this.api = options.api || null;
    this.management = options.management || null;
  }

  async start({ emitStatus = true } = {}) {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => sendApiError(response, error));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    if (emitStatus) this.emit('status', this.status());
    return this.status();
  }

  async stop({ emitStatus = true } = {}) {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
    if (emitStatus) this.emit('status', this.status());
  }

  setMaintenance(enabled) {
    this.maintenance = Boolean(enabled);
    this.emit('status', this.status());
  }

  status() {
    const address = this.server?.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    const running = Boolean(this.server);
    const advertisedHost = this.host === '0.0.0.0' ? findLanAddress() : this.host;
    const localBaseUrl = running ? `http://127.0.0.1:${port}` : null;
    const lanBaseUrl = running ? `http://${advertisedHost}:${port}` : null;
    return {
      state: running ? 'running' : 'stopped',
      host: this.host,
      advertisedHost,
      port,
      maintenance: this.maintenance,
      localBaseUrl,
      lanBaseUrl,
      baseUrl: lanBaseUrl
    };
  }

  async #handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || `${this.host}:${this.port}`}`);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (this.maintenance && url.pathname !== '/api/v1/health') {
      response.statusCode = 503;
      response.setHeader('Retry-After', '5');
      return response.end(JSON.stringify({ code: -1, message: '模拟设备正在刷新，请稍后重试' }));
    }

    if (request.method === 'GET' && ['/api/v1/health', '/api/fqnovel/health'].includes(url.pathname)) {
      return this.#json(response, 200, {
        status: 'UP',
        service: 'FQNovel Desktop',
        worker: this.workerStatus(),
        api: this.apiStatus(),
        serverTime: Date.now()
      });
    }

    if (request.method === 'GET' && url.pathname === '/book-source/fqnovel.json') {
      const baseUrl = `${url.protocol}//${url.host}`;
      return this.#json(response, 200, createBookSource(baseUrl));
    }

    const managementHandled = await handleManagementRequest({
      request, response, url, management: this.management
    });
    if (managementHandled) return;

    const handled = await handleFqApiRequest({ request, response, url, api: this.api });
    if (handled) return;

    if (url.pathname.startsWith('/api/fqsearch/') || url.pathname.startsWith('/api/fqnovel/')) {
      return this.#json(response, 501, {
        code: -1,
        message: '该业务接口尚未实现',
        data: null,
        serverTime: Date.now()
      });
    }

    return this.#json(response, 404, { code: -1, message: 'Not Found' });
  }

  #json(response, status, body) {
    response.statusCode = status;
    response.end(JSON.stringify(body));
  }
}

const VIRTUAL_INTERFACE_PATTERN =
  /(?:^|[\s_-])(tun|tap|vpn|singbox|tailscale|zerotier|wsl|docker|podman|veth|vmware|virtualbox|hyper-v|vethernet|bridge|br-)/i;
const PHYSICAL_INTERFACE_PATTERN =
  /^(?:en\d+|enp\w+|eth\d+|wlan\d+|wlp\w+|wi-?fi|ethernet|以太网|无线局域网)/i;

export function findLanAddress(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isIpv4 || entry.internal || !entry.address || isLinkLocal(entry.address)) continue;
      let score = isPrivateIpv4(entry.address) ? 100 : 0;
      if (PHYSICAL_INTERFACE_PATTERN.test(name)) score += 40;
      if (VIRTUAL_INTERFACE_PATTERN.test(name)) score -= 200;
      candidates.push({ address: entry.address, name, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0]?.address || '127.0.0.1';
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isLinkLocal(address) {
  return address.startsWith('169.254.') || address === '0.0.0.0';
}
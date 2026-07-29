import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_THREAD_STACK_SIZE = process.platform === 'darwin' && process.arch === 'arm64'
  ? '-Xss1m'
  : '-Xss512k';
const DEFAULT_JAVA_OPTIONS = [
  '-Xms16m',
  '-Xmx128m',
  DEFAULT_THREAD_STACK_SIZE,
  '-XX:+UseSerialGC',
  '-XX:MaxMetaspaceSize=96m',
  '-XX:ReservedCodeCacheSize=32m'
];

export class JavaWorkerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.javaBin = options.javaBin || process.env.FQNOVEL_JAVA_BIN || 'java';
    this.jarPath = options.jarPath || process.env.FQNOVEL_WORKER_JAR;
    this.cwd = options.cwd || process.cwd();
    this.javaOptions = Array.isArray(options.javaOptions)
      ? options.javaOptions.map(String)
      : DEFAULT_JAVA_OPTIONS;
    this.child = null;
    this.pending = new Map();
    this.readyInfo = null;
    this.startPromise = null;
    this.stopping = false;
  }

  async start() {
    if (this.readyInfo && this.child) return this.readyInfo;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.#spawnWorker();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #spawnWorker() {
    const jarPath = await this.#resolveJarPath();
    this.stopping = false;
    const child = spawn(this.javaBin, [
      ...this.javaOptions,
      '-Dfile.encoding=UTF-8',
      `-Dfq.worker.parentPid=${process.pid}`,
      '-jar',
      jarPath
    ], {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    const errorLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
    errorLines.on('line', (line) => this.emit('log', line));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.#handleLine(line));

    child.on('error', (error) => this.#handleExit(error));
    child.on('exit', (code, signal) => {
      const error = new Error(`Java worker exited (code=${code}, signal=${signal || 'none'})`);
      error.code = 'WORKER_EXITED';
      this.#handleExit(error);
    });

    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Java worker startup timed out after ${STARTUP_TIMEOUT_MS}ms`));
      }, STARTUP_TIMEOUT_MS);
      const onReady = (message) => {
        cleanup();
        resolve(message);
      };
      const onFailure = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('worker-error', onFailure);
      };
      this.once('ready', onReady);
      this.once('worker-error', onFailure);
    });

    this.readyInfo = ready;
    this.emit('status', this.status());
    return ready;
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.start();
    if (!this.child?.stdin?.writable) throw new Error('Java worker stdin is not writable');

    const id = randomUUID();
    const payload = JSON.stringify({ version: 1, id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Java worker request timed out: ${method}`);
        error.code = 'WORKER_TIMEOUT';
        reject(error);
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${payload}\n`, 'utf8', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async sign(url, headers) {
    return this.request('sign', { url, headers });
  }

  async refresh() {
    const result = await this.request('refresh', {}, 45_000);
    this.readyInfo = { ...this.readyInfo, status: result };
    this.emit('status', this.status());
    return result;
  }

  async stop() {
    const child = this.child;
    if (!child || this.stopping) return;
    this.stopping = true;
    try {
      await this.request('shutdown', {}, 3_000);
    } catch {
      if (child.exitCode === null && !child.killed) child.kill();
    }
  }

  status() {
    return {
      state: this.readyInfo ? 'ready' : this.child ? 'starting' : 'stopped',
      pid: this.child?.pid || null,
      info: this.readyInfo
    };
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('log', `[protocol] ignored non-JSON stdout: ${line}`);
      return;
    }

    if (message.type === 'ready') {
      this.readyInfo = message;
      this.emit('ready', message);
      return;
    }

    const entry = message.id ? this.pending.get(message.id) : null;
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      const error = new Error(message.error?.message || 'Java worker request failed');
      error.code = message.error?.code || 'WORKER_ERROR';
      error.retryable = Boolean(message.error?.retryable);
      entry.reject(error);
    }
  }

  #handleExit(error) {
    const child = this.child;
    this.child = null;
    this.readyInfo = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    if (!this.stopping) this.emit('worker-error', error);
    this.emit('status', this.status());
    if (child?.stdout) child.stdout.destroy();
  }

  async #resolveJarPath() {
    const candidates = [
      this.jarPath,
      path.join(this.cwd, 'java-worker', 'target', 'unidbg-worker.jar'),
      path.join(process.resourcesPath || '', 'unidbg', 'unidbg-worker.jar')
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    throw new Error(`unidbg-worker.jar not found. Checked: ${candidates.join(', ')}`);
  }
}

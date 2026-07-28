import type { RuntimeStatus } from './types';

export type StatusTone = 'ready' | 'busy' | 'error' | 'idle';

export interface StatusIndicator {
  tone: StatusTone;
  label: string;
  detail: string;
}

export interface RuntimePresentation {
  worker: StatusIndicator;
  source: StatusIndicator;
}

export function deriveRuntimePresentation(status: RuntimeStatus): RuntimePresentation {
  const workerState = status.worker?.state;
  const serverState = status.server?.state;
  const sourceEnabled = Boolean(status.settings?.bookSourceEnabled);
  const maintenance = Boolean(status.refreshing || status.server?.maintenance);
  const workerReady = workerState === 'ready';
  const serverRunning = serverState === 'running';

  let worker: StatusIndicator;
  if (maintenance) {
    worker = {
      tone: 'busy',
      label: '刷新中',
      detail: '正在重新初始化 unidbg 模拟环境'
    };
  } else if (workerReady) {
    worker = {
      tone: 'ready',
      label: '正常',
      detail: 'unidbg 模拟环境已就绪'
    };
  } else if (workerState === 'starting') {
    worker = {
      tone: 'busy',
      label: '启动中',
      detail: 'Java Worker 正在启动'
    };
  } else if (!status.worker) {
    worker = {
      tone: 'idle',
      label: '加载中',
      detail: '正在读取模拟环境状态'
    };
  } else {
    worker = {
      tone: 'error',
      label: '异常',
      detail: 'Java Worker 未运行'
    };
  }

  let source: StatusIndicator;
  if (!sourceEnabled) {
    source = {
      tone: 'idle',
      label: '已关闭',
      detail: '可在设置中开启书源服务'
    };
  } else if (maintenance) {
    source = {
      tone: 'busy',
      label: '维护中',
      detail: '刷新期间书源请求会暂时返回维护状态'
    };
  } else if (serverRunning && workerReady) {
    source = {
      tone: 'ready',
      label: '正常',
      detail: '书源服务已就绪'
    };
  } else if (serverRunning && (workerState === 'starting' || !status.worker)) {
    source = {
      tone: 'busy',
      label: '等待中',
      detail: '书源服务正在等待模拟环境就绪'
    };
  } else if (!status.server) {
    source = {
      tone: 'idle',
      label: '加载中',
      detail: '正在读取书源服务状态'
    };
  } else {
    source = {
      tone: 'error',
      label: '不可用',
      detail: serverRunning ? '模拟环境未就绪' : '书源服务未启动'
    };
  }

  return { worker, source };
}

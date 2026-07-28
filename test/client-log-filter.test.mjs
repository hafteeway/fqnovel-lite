import test from 'node:test';
import assert from 'node:assert/strict';
import { filterClientLogMessage } from '../src/core/app-runtime.mjs';

test('hides the known MetaSec SDK initialization noise from client logs', () => {
  assert.equal(
    filterClientLogMessage('java', '[main]E/METASEC: Fatal: SDK not init, crashing...'),
    ''
  );
});

test('keeps real Java worker messages while removing only the known noise line', () => {
  const message = [
    '[INFO] [IdleFQ] IdleFQ初始化完成',
    '[main]E/METASEC: Fatal: SDK not init, crashing...',
    '[ERROR] [IdleFQ] 真实错误'
  ].join('\n');

  assert.equal(
    filterClientLogMessage('java', message),
    '[INFO] [IdleFQ] IdleFQ初始化完成\n[ERROR] [IdleFQ] 真实错误'
  );
});

test('does not filter messages from other sources', () => {
  const message = '[main]E/METASEC: Fatal: SDK not init, crashing...';
  assert.equal(filterClientLogMessage('system', message), message);
});

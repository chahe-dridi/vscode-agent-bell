import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module from 'node:module';
import assert from 'node:assert/strict';

// Mock 'vscode' module for standalone testing
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      window: {
        state: { focused: false },
        createOutputChannel: () => ({ appendLine: () => {} }),
      },
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => def,
        }),
      },
      ThemeIcon: class {},
    };
  }
  return originalRequire.apply(this, arguments);
};

const hooks = await import('../out/hooks.js');
const history = await import('../out/history.js');
const logger = await import('../out/logger.js');
const config = await import('../out/config.js');

async function testHookDebounce() {
  if (!fs.existsSync(config.CLAUDE_DIR)) {
    fs.mkdirSync(config.CLAUDE_DIR, { recursive: true });
  }

  logger.initLogger({ appendLine: () => {} });

  const mockGlobalState = {
    get: () => [],
    update: () => {},
  };
  history.initHistory({ globalState: mockGlobalState }, () => {});
  history.clearHistory();

  hooks.setupHookSignalWatcher();

  try {
    // 1. Write first event: 'Notification'
    fs.writeFileSync(config.HOOK_SIGNAL_PATH, 'Notification');
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(history.alertHistory.length, 1);
    assert.equal(history.alertHistory[0].detail, 'Notification');

    // Duplicate call (simulating fs.watch firing twice for one write)
    hooks.handleHookSignal();
    assert.equal(history.alertHistory.length, 1, 'Duplicate fs.watch callback must be ignored');

    // 2. Write second event 100ms later: 'Stop'
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(config.HOOK_SIGNAL_PATH, 'Stop');
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(history.alertHistory.length, 2, 'Distinct event 100ms later must reach history');
    assert.equal(history.alertHistory[0].detail, 'Stop');
    assert.equal(history.alertHistory[1].detail, 'Notification');

    // 3. Write same event later: 'Stop' (new mtime)
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(config.HOOK_SIGNAL_PATH, 'Stop');
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(history.alertHistory.length, 3, 'Same event with new mtime must reach history');
    assert.equal(history.alertHistory[0].detail, 'Stop');

    console.log('testHookDebounce: PASSED');
  } finally {
    hooks.teardownHookSignalWatcher();
    try { fs.unlinkSync(config.HOOK_SIGNAL_PATH); } catch {}
  }
}

await testHookDebounce();
process.exit(0);

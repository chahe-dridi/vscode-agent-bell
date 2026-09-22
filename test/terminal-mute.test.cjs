const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const manifest = require('../package.json');

function harness(overrides = {}, platform = process.platform) {
  let now = 100_000;
  let timerId = 0;
  const timers = new Map();
  const events = {};
  const commands = new Map();
  const messages = [];
  const logs = [];
  const processes = [];
  const writes = [];
  const statusBars = [];
  const config = Object.fromEntries(Object.entries(manifest.contributes.configuration.properties)
    .map(([key, value]) => [key.replace('agentConfirmSound.', ''), value.default]));
  Object.assign(config, overrides);
  const disposable = () => ({ dispose() {} });
  const listen = (name) => (callback) => { events[name] = callback; return disposable(); };
  const state = { hookDecision: 'declined' };
  const context = {
    extensionPath: path.resolve(__dirname, '..'),
    extension: { packageJSON: manifest },
    subscriptions: [],
    globalState: {
      get: (key, fallback) => state[key] ?? fallback,
      update: async (key, value) => { state[key] = JSON.parse(JSON.stringify(value)); writes.push(key); },
    },
  };
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    window: {
      state: { focused: false },
      activeTerminal: undefined,
      createOutputChannel: () => ({ ...disposable(), appendLine: (line) => logs.push(line), show() {} }),
      createStatusBarItem: () => {
        const item = { ...disposable(), show() {} };
        statusBars.push(item);
        return item;
      },
      showInformationMessage: async (message) => { messages.push(message); },
      registerWebviewViewProvider: disposable,
      onDidCloseTerminal: listen('close'),
      onDidStartTerminalShellExecution: listen('start'),
      onDidEndTerminalShellExecution: listen('end'),
    },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }),
      onDidChangeConfiguration: disposable,
    },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); } },
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../out/extension.js'), 'utf8'), {
    exports, Buffer, AbortController,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    require: (id) => {
      if (id === 'vscode') { return vscode; }
      if (id === 'node:fs') { return { existsSync: () => false }; }
      if (id === 'node:os') { return { homedir: () => '/test-home', platform: () => platform }; }
      if (id === 'node:child_process') {
        return { spawn: (...args) => { processes.push(args); return { on() {}, unref() {} }; } };
      }
      return require(id);
    },
  }, { filename: 'extension.js' });
  exports.activate(context);
  const tick = (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { break; }
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = end;
  };
  const start = async (terminal, chunks = []) => {
    events.start({ terminal, execution: { async *read() { yield* chunks; } } });
    for (let i = 0; i < chunks.length * 3 + 5; i++) { await Promise.resolve(); }
  };
  return {
    config, events, messages, logs, processes, writes, status: statusBars[0], state, tick, start,
    terminal: (name) => ({ name, shown: 0, show() { this.shown++; } }),
    run: (name, terminal) => { vscode.window.activeTerminal = terminal; return commands.get(`agentConfirmSound.${name}`)(); },
    finish: (terminal, exitCode = 0) => events.end({ terminal, exitCode }),
    stop: () => exports.deactivate(),
    alerts: () => state.alertHistory ?? [],
    commands,
  };
}

test('both commands are contributed and registered', () => {
  const h = harness();
  for (const name of ['muteTerminal', 'unmuteTerminal']) {
    assert.ok(manifest.contributes.commands.some((c) => c.command === `agentConfirmSound.${name}`));
    assert.ok(h.commands.has(`agentConfirmSound.${name}`));
  }
});

test('commands without an active terminal are harmless and explain why', () => {
  const h = harness();
  h.run('muteTerminal');
  h.run('unmuteTerminal');
  assert.equal(h.messages.length, 2);
  assert.ok(h.messages.every((message) => message.includes('no active terminal')));
  assert.doesNotMatch(h.status.tooltip, /Muted terminals/);
  assert.deepEqual(h.writes, []);
});

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`${platform}: muting suppresses prompt side effects while another same-named terminal still alerts`, async () => {
    const h = harness({ focusTerminal: true }, platform);
    const muted = h.terminal('agent');
    const other = h.terminal('agent');
    h.run('muteTerminal', muted);
    await h.start(muted, ['Proceed?']);
    assert.equal(h.alerts().length, 0);
    assert.equal(h.processes.length, 0);
    assert.equal(muted.shown, 0);
    await h.start(other, ['Proceed?']);
    assert.equal(h.alerts().length, 1);
    assert.equal(h.alerts()[0].type, 'pattern');
    assert.equal(other.shown, 1);
    assert.equal(h.processes.length, 2);
    assert.match(h.status.tooltip, /Muted terminals: agent/);
    h.tick(2000);
    assert.match(h.status.tooltip, /1 alert this session/);
    assert.match(h.status.tooltip, /Muted terminals: agent/);
  });
}

test('completion alerts are suppressed only for muted terminals, including failed commands', async () => {
  const h = harness({ focusTerminal: true });
  const muted = h.terminal('watch');
  const other = h.terminal('build');
  h.run('muteTerminal', muted);
  await h.start(muted);
  await h.start(other);
  h.tick(5000);
  h.finish(muted, 1);
  assert.equal(h.alerts().length, 0);
  assert.equal(h.processes.length, 0);
  assert.equal(muted.shown, 0);
  h.finish(other, 1);
  assert.equal(h.alerts().length, 1);
  assert.equal(h.alerts()[0].source, 'build');
  assert.equal(h.alerts()[0].type, 'command-end');
  assert.match(h.alerts()[0].detail, /exit 1/);
});

test('unmute restores prompt alerts without consuming debounce while muted', async () => {
  const h = harness();
  const terminal = h.terminal('agent');
  h.run('muteTerminal', terminal);
  await h.start(terminal, ['Proceed?']);
  h.run('unmuteTerminal', terminal);
  await h.start(terminal, ['Proceed?']);
  assert.equal(h.alerts().length, 1);
  assert.doesNotMatch(h.status.tooltip, /Muted terminals/);
});

test('mute and unmute take effect during an already-running output stream', async () => {
  const h = harness({ debounceMs: 0 });
  const terminal = h.terminal('watch');
  let push;
  const pending = () => new Promise((resolve) => { push = resolve; });
  h.events.start({ terminal, execution: { async *read() {
    while (true) { yield await pending(); }
  } } });
  const emit = async () => {
    push('Continue (y/n)');
    for (let i = 0; i < 10; i++) { await Promise.resolve(); }
  };
  await emit();
  assert.equal(h.alerts().length, 1);
  h.run('muteTerminal', terminal);
  await emit();
  assert.equal(h.alerts().length, 1);
  h.run('unmuteTerminal', terminal);
  await emit();
  assert.equal(h.alerts().length, 2);
  h.events.close(terminal);
  await emit();
  assert.equal(h.alerts().length, 2);
});

test('unmute restores completion alerts and does not resurrect a finished muted command', async () => {
  const h = harness();
  const terminal = h.terminal('build');
  h.run('muteTerminal', terminal);
  await h.start(terminal);
  h.tick(5000);
  h.finish(terminal);
  h.run('unmuteTerminal', terminal);
  h.finish(terminal);
  assert.equal(h.alerts().length, 0);
  await h.start(terminal);
  h.tick(5000);
  h.finish(terminal);
  assert.equal(h.alerts().length, 1);
});

test('mute and unmute are idempotent; tooltip lists all muted terminals even while paused', () => {
  const h = harness();
  const a = h.terminal('watch');
  const b = h.terminal('build');
  h.run('muteTerminal', a);
  h.run('muteTerminal', a);
  h.run('muteTerminal', b);
  assert.match(h.status.tooltip, /Muted terminals: watch, build$/);
  h.run('toggle');
  assert.match(h.status.tooltip, /paused/);
  assert.match(h.status.tooltip, /Muted terminals: watch, build$/);
  h.run('unmuteTerminal', a);
  h.run('unmuteTerminal', a);
  assert.match(h.status.tooltip, /Muted terminals: build$/);
  assert.deepEqual(h.writes, []);
});

test('muting during an alert flash updates its tooltip immediately and cancels its reminder', async () => {
  const h = harness({ reminderIntervalMs: 3000 });
  const terminal = h.terminal('agent');
  await h.start(terminal, ['Proceed?']);
  const before = h.processes.length;
  h.run('muteTerminal', terminal);
  assert.match(h.status.tooltip, /Last alert:.*\nMuted terminals: agent/);
  h.tick(10_000);
  assert.equal(h.processes.length, before);
  assert.ok(!h.logs.some((line) => line.startsWith('[reminder]')));
});

test('muting another terminal does not cancel an unrelated reminder', async () => {
  const h = harness({ reminderIntervalMs: 3000, reminderMaxCount: 1 });
  await h.start(h.terminal('agent'), ['Proceed?']);
  h.run('muteTerminal', h.terminal('watch'));
  const before = h.processes.length;
  h.tick(3000);
  assert.equal(h.processes.length, before + 2);
  assert.match(h.status.tooltip, /Muted terminals: watch/);
});

test('closing a terminal clears its mute and a new terminal with the same name alerts', async () => {
  const h = harness();
  const old = h.terminal('watch');
  h.run('muteTerminal', old);
  h.events.close(old);
  assert.doesNotMatch(h.status.tooltip, /Muted terminals/);
  await h.start(h.terminal('watch'), ['Proceed?']);
  assert.equal(h.alerts().length, 1);
});

test('closing the reminder terminal cancels reminders', async () => {
  const h = harness({ reminderIntervalMs: 3000 });
  const terminal = h.terminal('agent');
  await h.start(terminal, ['Proceed?']);
  const before = h.processes.length;
  h.events.close(terminal);
  h.tick(10_000);
  assert.equal(h.processes.length, before);
});

test('unmuting does not bypass global pause, name filters, or trigger settings', async () => {
  for (const config of [{ enabled: false }, { terminalNameFilter: ['other'] }, { alertOn: [] }]) {
    const h = harness(config);
    const terminal = h.terminal('agent');
    h.run('muteTerminal', terminal);
    h.run('unmuteTerminal', terminal);
    await h.start(terminal, ['Proceed?']);
    h.tick(5000);
    h.finish(terminal);
    assert.equal(h.alerts().length, 0);
    assert.equal(h.processes.length, 0);
  }
});

test('deactivation clears session-only mutes and leaves no timers running', async () => {
  const h = harness({ reminderIntervalMs: 3000 });
  const terminal = h.terminal('agent');
  await h.start(terminal, ['Proceed?']);
  h.run('muteTerminal', terminal);
  h.stop();
  const before = h.processes.length;
  h.tick(10_000);
  assert.equal(h.processes.length, before);
  assert.ok(h.writes.every((key) => key === 'alertHistory'));
  const reloaded = harness();
  await reloaded.start(terminal, ['Proceed?']);
  assert.equal(reloaded.alerts().length, 1);
});

import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let watching = false;

// Compiled patterns cache — invalidated on config change.
let cachedPatterns: RegExp[] | null = null;

// Tracks last trigger time per terminal for debouncing. Cleaned up on terminal close.
const lastTriggerAt = new Map<vscode.Terminal, number>();

function stripAnsi(input: string): string {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getConfig() {
  return vscode.workspace.getConfiguration('agentConfirmSound');
}

function getPatterns(): RegExp[] {
  if (cachedPatterns) {
    return cachedPatterns;
  }
  const raw = getConfig().get<string[]>('patterns', []);
  const compiled: RegExp[] = [];
  for (const p of raw) {
    try {
      compiled.push(new RegExp(p, 'i'));
    } catch (e) {
      outputChannel.appendLine(`[warn] invalid pattern skipped: ${p} — ${e}`);
    }
  }
  cachedPatterns = compiled;
  return compiled;
}

function terminalPassesNameFilter(terminal: vscode.Terminal): boolean {
  const filters = getConfig().get<string[]>('terminalNameFilter', []);
  if (!filters.length) {
    return true;
  }
  const name = terminal.name.toLowerCase();
  return filters.some((f) => name.includes(f.toLowerCase()));
}

function playSound(context: vscode.ExtensionContext) {
  const customPath = getConfig().get<string>('soundPath', '').trim();
  const soundFile =
    customPath.length > 0
      ? customPath
      : path.join(context.extensionPath, 'media', 'notify.wav');

  const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
  const platform = os.platform();

  let cmd: string;
  let args: string[];
  let spawnOpts: cp.SpawnOptions;

  if (platform === 'darwin') {
    cmd = 'afplay';
    args = [soundFile, '-v', String(volume)];
    spawnOpts = { stdio: 'ignore', detached: true };
  } else if (platform === 'win32') {
    const psPath = soundFile.replace(/'/g, "''");
    cmd = 'powershell';
    args = ['-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${psPath}').PlaySync();`];
    // Do NOT detach on Windows — detached processes in a new group can lose audio device access.
    spawnOpts = { stdio: 'ignore' };
  } else {
    const paVol = Math.round(volume * 65536);
    const escaped = soundFile.replace(/'/g, String.raw`'\''`);
    cmd = 'sh';
    args = ['-c', `paplay --volume=${paVol} '${escaped}' 2>/dev/null || aplay '${escaped}' 2>/dev/null`];
    spawnOpts = { stdio: 'ignore', detached: true };
  }

  const child = cp.spawn(cmd, args, spawnOpts);
  child.on('error', (err) => {
    outputChannel.appendLine(`[error] sound playback failed (${cmd}): ${err.message}`);
    outputChannel.appendLine(`[hint] set agentConfirmSound.soundPath to a .wav your system can play, or check that ${cmd} is available.`);
  });
  child.unref();
}

function maybeTrigger(context: vscode.ExtensionContext, terminal: vscode.Terminal, chunk: string) {
  if (!watching) {
    return;
  }
  if (!terminalPassesNameFilter(terminal)) {
    return;
  }
  const patterns = getPatterns();
  if (!patterns.length) {
    return;
  }

  const matched = patterns.find((re) => re.test(stripAnsi(chunk)));
  if (!matched) {
    return;
  }

  const debounceMs = getConfig().get<number>('debounceMs', 4000);
  const now = Date.now();
  if ((lastTriggerAt.get(terminal) ?? 0) + debounceMs > now) {
    return;
  }
  lastTriggerAt.set(terminal, now);

  outputChannel.appendLine(`[match] "${terminal.name}" matched ${matched} at ${new Date(now).toISOString()}`);
  playSound(context);
}

async function watchExecution(
  context: vscode.ExtensionContext,
  terminal: vscode.Terminal,
  execution: vscode.TerminalShellExecution
) {
  try {
    for await (const chunk of execution.read()) {
      maybeTrigger(context, terminal, chunk);
    }
  } catch (e) {
    outputChannel.appendLine(`[error] stream read failed: ${e}`);
  }
}

function updateStatusBar() {
  statusBarItem.text = watching ? '$(bell) Agent Bell' : '$(bell-slash) Agent Bell';
  statusBarItem.tooltip = watching
    ? 'Agent Bell is watching terminals. Click to pause.'
    : 'Agent Bell is paused. Click to start watching.';
  statusBarItem.color = watching ? undefined : new vscode.ThemeColor('statusBarItem.warningForeground');
}

function setWatching(value: boolean) {
  watching = value;
  updateStatusBar();
  outputChannel.appendLine(value ? '[info] watching started.' : '[info] watching paused.');
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Agent Bell');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'agentConfirmSound.toggle';
  statusBarItem.show();

  // Start in the state the user last set, defaulting to enabled.
  setWatching(getConfig().get<boolean>('enabled', true));

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentConfirmSound.patterns')) {
        cachedPatterns = null;
        outputChannel.appendLine('[info] pattern cache cleared.');
      }
      if (e.affectsConfiguration('agentConfirmSound.enabled')) {
        setWatching(getConfig().get<boolean>('enabled', true));
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      lastTriggerAt.delete(terminal);
    }),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      watchExecution(context, event.terminal, event.execution);
    }),
    vscode.commands.registerCommand('agentConfirmSound.toggle', () => {
      setWatching(!watching);
      vscode.window.setStatusBarMessage(
        watching ? 'Agent Bell: watching' : 'Agent Bell: paused',
        2000
      );
    }),
    vscode.commands.registerCommand('agentConfirmSound.testSound', () => {
      outputChannel.appendLine('[info] test sound triggered.');
      playSound(context);
    }),
    vscode.commands.registerCommand('agentConfirmSound.showLog', () => {
      outputChannel.show();
    })
  );

  outputChannel.appendLine(`[info] Agent Bell activated. Watching: ${watching}`);
}

export function deactivate() {
  lastTriggerAt.clear();
}

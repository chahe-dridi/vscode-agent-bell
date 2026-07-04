import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let watching = false;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

let cachedPatterns: RegExp[] | null = null;
const lastTriggerAt = new Map<vscode.Terminal, number>();

// Stable sound path that doesn't change across extension updates.
const STABLE_SOUND_PATH = path.join(os.homedir(), '.claude', 'agent-bell-notify.wav');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_MARKER = 'agent-bell-notify';

// ─── Sound ───────────────────────────────────────────────────────────────────

function stripAnsi(input: string): string {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getConfig() {
  return vscode.workspace.getConfiguration('agentConfirmSound');
}

function buildHookCommand(soundFile: string): string {
  const platform = os.platform();
  if (platform === 'darwin') {
    return `afplay "${soundFile}"`;
  } else if (platform === 'win32') {
    const ps = soundFile.replace(/'/g, "''");
    return `powershell -NoProfile -NonInteractive -Command "(New-Object Media.SoundPlayer '${ps}').PlaySync();"`;
  } else {
    return `paplay "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null`;
  }
}

function playSound(soundFile: string) {
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
    outputChannel.appendLine(`[hint] set agentConfirmSound.soundPath to a .wav your system can play.`);
  });
  child.unref();
}

function triggerSound(context: vscode.ExtensionContext) {
  const customPath = getConfig().get<string>('soundPath', '').trim();
  const soundFile = customPath.length > 0
    ? customPath
    : path.join(context.extensionPath, 'media', 'notify.wav');
  playSound(soundFile);
}

// ─── Claude Code hook integration ────────────────────────────────────────────

function readClaudeSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    // corrupt or missing — start fresh
  }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// Hook event types we install into.
const HOOK_EVENTS = ['Stop', 'Notification'] as const;

type HookGroup = { matcher: string; hooks: Array<{ type: string; command: string }> };
type HookGroupRead = { hooks?: Array<{ command?: string }> };

function isHookInstalled(): boolean {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (!hooks) {
    return false;
  }
  return HOOK_EVENTS.some((event) => {
    const groups = hooks[event] as HookGroupRead[] | undefined;
    return groups?.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));
  });
}

async function installClaudeHook(context: vscode.ExtensionContext): Promise<void> {
  const bundled = path.join(context.extensionPath, 'media', 'notify.wav');
  try {
    const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.copyFileSync(bundled, STABLE_SOUND_PATH);
    outputChannel.appendLine(`[hook] sound copied to ${STABLE_SOUND_PATH}`);
  } catch (e) {
    outputChannel.appendLine(`[hook] failed to copy sound: ${e}`);
    throw e;
  }

  const settings = readClaudeSettings();
  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const entry: HookGroup = {
    matcher: '',
    hooks: [{ type: 'command', command: buildHookCommand(STABLE_SOUND_PATH) }],
  };

  for (const event of HOOK_EVENTS) {
    const existing = (hooks[event] ?? []) as HookGroup[];
    const alreadyThere = existing.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));
    if (!alreadyThere) {
      existing.push(entry);
      hooks[event] = existing;
    }
  }

  settings['hooks'] = hooks;
  writeClaudeSettings(settings);
  outputChannel.appendLine('[hook] Claude Code Stop + Notification hooks installed.');
}

async function removeClaudeHook(): Promise<void> {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (!hooks) {
    return;
  }

  for (const event of HOOK_EVENTS) {
    const groups = hooks[event] as HookGroupRead[] | undefined;
    if (groups) {
      hooks[event] = groups
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(HOOK_MARKER)) }))
        .filter((g) => (g.hooks as unknown[]).length > 0);
    }
  }

  try {
    if (fs.existsSync(STABLE_SOUND_PATH)) {
      fs.unlinkSync(STABLE_SOUND_PATH);
    }
  } catch { /* ignore */ }

  settings['hooks'] = hooks;
  writeClaudeSettings(settings);
  outputChannel.appendLine('[hook] Claude Code hooks removed.');
}

// ─── Terminal watching ────────────────────────────────────────────────────────

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

function flashStatusBar() {
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  statusBarItem.text = '$(bell-dot) Agent Bell';
  statusBarItem.color = new vscode.ThemeColor('notificationsInfoIcon.foreground');
  flashTimer = setTimeout(() => {
    updateStatusBar();
    flashTimer = undefined;
  }, 1500);
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

  const clean = stripAnsi(chunk);

  if (getConfig().get<boolean>('debugLog', false)) {
    outputChannel.appendLine(`[debug] terminal="${terminal.name}" chunk=${JSON.stringify(clean.slice(0, 200))}`);
  }

  const matched = patterns.find((re) => re.test(clean));
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

  if (getConfig().get<boolean>('focusTerminal', false)) {
    terminal.show(true);
  }

  flashStatusBar();
  triggerSound(context);
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

// ─── Status bar ──────────────────────────────────────────────────────────────

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

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Agent Bell');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'agentConfirmSound.toggle';
  statusBarItem.show();

  setWatching(getConfig().get<boolean>('enabled', true));

  // Offer Claude Code hook setup on first install (non-blocking).
  if (!isHookInstalled()) {
    vscode.window.showInformationMessage(
      'Agent Bell: Set up Claude Code integration? This adds a sound alert whenever Claude Code finishes its turn.',
      'Yes, set it up',
      'Not now'
    ).then((choice) => {
      if (choice === 'Yes, set it up') {
        installClaudeHook(context).then(() => {
          vscode.window.showInformationMessage('Agent Bell: Claude Code integration ready. You\'ll hear a sound when Claude finishes.');
        }).catch((e) => {
          vscode.window.showErrorMessage(`Agent Bell: failed to install hook — ${e}`);
        });
      }
    });
  }

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
      flashStatusBar();
      triggerSound(context);
    }),
    vscode.commands.registerCommand('agentConfirmSound.showLog', () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand('agentConfirmSound.setupClaudeHook', async () => {
      if (isHookInstalled()) {
        vscode.window.showInformationMessage('Agent Bell: Claude Code hook is already installed.');
        return;
      }
      try {
        await installClaudeHook(context);
        vscode.window.showInformationMessage('Agent Bell: Claude Code integration ready.');
      } catch (e) {
        vscode.window.showErrorMessage(`Agent Bell: failed to install hook — ${e}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.removeClaudeHook', async () => {
      if (!isHookInstalled()) {
        vscode.window.showInformationMessage('Agent Bell: no Claude Code hook found.');
        return;
      }
      try {
        await removeClaudeHook();
        vscode.window.showInformationMessage('Agent Bell: Claude Code hook removed.');
      } catch (e) {
        vscode.window.showErrorMessage(`Agent Bell: failed to remove hook — ${e}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.testPattern', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Paste a line of terminal output to test against your patterns',
        placeHolder: 'e.g. Allow this action? (y/n)',
      });
      if (input === undefined) {
        return;
      }
      const clean = stripAnsi(input);
      const matched = getPatterns().find((re) => re.test(clean));
      if (matched) {
        outputChannel.appendLine(`[test] ✅ MATCH — pattern: ${matched}`);
        outputChannel.show();
        vscode.window.showInformationMessage(`Agent Bell: matched — ${matched}`);
      } else {
        outputChannel.appendLine(`[test] ❌ no match for: ${clean}`);
        outputChannel.show();
        vscode.window.showWarningMessage('Agent Bell: no pattern matched. Check the log and adjust your patterns.');
      }
    })
  );

  outputChannel.appendLine(`[info] Agent Bell ${context.extension.packageJSON.version} activated. Watching: ${watching}`);
  outputChannel.appendLine(`[info] Claude Code hook: ${isHookInstalled() ? 'installed' : 'not installed'}`);
}

export function deactivate() {
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  lastTriggerAt.clear();
}

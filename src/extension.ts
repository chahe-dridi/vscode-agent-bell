import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let watching = false;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let lastMatchLabel = '';
let extensionContext: vscode.ExtensionContext;

let cachedPatterns: RegExp[] | null = null;
const lastTriggerAt = new Map<vscode.Terminal, number>();

const STABLE_SOUND_PATH = path.join(os.homedir(), '.claude', 'agent-bell-notify.wav');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_MARKER = 'agent-bell-notify';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAnsi(input: string): string {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getConfig() {
  return vscode.workspace.getConfiguration('agentConfirmSound');
}

// ─── Sound selection ─────────────────────────────────────────────────────────

function pickSoundFile(context: vscode.ExtensionContext): string {
  const bundled = path.join(context.extensionPath, 'media', 'notify.wav');
  const sounds = getConfig().get<string[]>('sounds', []).filter((s) => s.trim().length > 0);

  if (sounds.length === 0) {
    return bundled;
  }

  const mode = getConfig().get<string>('soundMode', 'fixed');
  if (mode === 'random') {
    const pool = [bundled, ...sounds];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return sounds[0];
}

// ─── Sound playback ──────────────────────────────────────────────────────────

function buildHookCommand(soundFile: string): string {
  const platform = os.platform();
  const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));

  if (platform === 'darwin') {
    return `afplay -v ${volume} "${soundFile}"`;
  } else if (platform === 'win32') {
    const ps = soundFile.replace(/'/g, "''");
    return `powershell -NoProfile -NonInteractive -Command "(New-Object Media.SoundPlayer '${ps}').PlaySync();"`;
  } else {
    const paVol = Math.round(volume * 65536);
    return `paplay --volume=${paVol} "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null`;
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
  });
  child.unref();
}

function triggerSound(context: vscode.ExtensionContext) {
  playSound(pickSoundFile(context));
}

// ─── Claude Code hook integration ────────────────────────────────────────────

function readClaudeSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    // corrupt or missing
  }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

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
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.copyFileSync(bundled, STABLE_SOUND_PATH);
  outputChannel.appendLine(`[hook] sound copied to ${STABLE_SOUND_PATH}`);

  const settings = readClaudeSettings();
  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const entry: HookGroup = {
    matcher: '',
    hooks: [{ type: 'command', command: buildHookCommand(STABLE_SOUND_PATH) }],
  };

  for (const event of HOOK_EVENTS) {
    const existing = (hooks[event] ?? []) as HookGroup[];
    if (!existing.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)))) {
      existing.push(entry);
      hooks[event] = existing;
    }
  }

  settings['hooks'] = hooks;
  writeClaudeSettings(settings);
  outputChannel.appendLine('[hook] Claude Code Stop + Notification hooks installed.');
  await context.globalState.update('hookDecision', 'installed');
}

async function removeClaudeHook(context: vscode.ExtensionContext): Promise<void> {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (hooks) {
    for (const event of HOOK_EVENTS) {
      const groups = hooks[event] as HookGroupRead[] | undefined;
      if (groups) {
        hooks[event] = groups
          .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(HOOK_MARKER)) }))
          .filter((g) => (g.hooks as unknown[]).length > 0);
      }
    }
    settings['hooks'] = hooks;
    writeClaudeSettings(settings);
  }

  try {
    if (fs.existsSync(STABLE_SOUND_PATH)) {
      fs.unlinkSync(STABLE_SOUND_PATH);
    }
  } catch { /* ignore */ }

  outputChannel.appendLine('[hook] Claude Code hooks removed.');
  await context.globalState.update('hookDecision', 'removed');
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

// ─── Status bar ──────────────────────────────────────────────────────────────

function updateStatusBar() {
  if (flashTimer) {
    return;
  }
  if (watching) {
    statusBarItem.text = lastMatchLabel
      ? `$(bell) Agent Bell  ·  last alert ${lastMatchLabel}`
      : '$(bell) Agent Bell: On';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = 'Agent Bell is watching terminals. Click to pause.';
  } else {
    statusBarItem.text = '$(bell-slash) Agent Bell: Off';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = 'Agent Bell is paused. Click to resume watching.';
  }
  statusBarItem.show();
}

function flashStatusBar(label: string) {
  lastMatchLabel = label;
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  statusBarItem.text = `$(bell-dot) Agent Bell: Alert!`;
  statusBarItem.color = undefined;
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  statusBarItem.tooltip = `Last alert: ${label}`;
  statusBarItem.show();
  flashTimer = setTimeout(() => {
    flashTimer = undefined;
    updateStatusBar();
  }, 2000);
}

function setWatching(value: boolean) {
  watching = value;
  updateStatusBar();
  outputChannel.appendLine(value ? '[info] watching started.' : '[info] watching paused.');
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Agent Bell');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.command = 'agentConfirmSound.toggle';
  statusBarItem.show();

  setWatching(getConfig().get<boolean>('enabled', true));

  // Only show the setup modal if the user hasn't made a decision yet
  const hookDecision = context.globalState.get<string>('hookDecision');
  if (!hookDecision && !isHookInstalled()) {
    vscode.window.showInformationMessage(
      [
        'Agent Bell — Claude Code Integration',
        '',
        'This will make two changes on your local machine:',
        '',
        '1. Copy the notification sound to:',
        `   ${STABLE_SOUND_PATH}`,
        '',
        '2. Add Stop + Notification hooks to:',
        `   ${CLAUDE_SETTINGS_PATH}`,
        '',
        '• Stop hook        → plays when Claude finishes its turn',
        '• Notification hook → plays when Claude needs your approval',
        '',
        'Nothing is sent externally. Fully reversible via:',
        '"Agent Bell: Remove Claude Code Integration"',
      ].join('\n'),
      { modal: true },
      'Set it up',
      'Not now'
    ).then(async (choice) => {
      if (choice === 'Set it up') {
        try {
          await installClaudeHook(context);
          vscode.window.showInformationMessage("Agent Bell: Claude Code integration ready. You'll hear a sound when Claude finishes or needs your input.");
        } catch (e) {
          vscode.window.showErrorMessage(`Agent Bell: failed to install hook — ${e}`);
        }
      } else if (choice === 'Not now') {
        await context.globalState.update('hookDecision', 'declined');
      }
      // If dismissed (undefined), don't record a decision so we ask again next time
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
      // Clear any active flash before toggling so the state change is immediate
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = undefined;
      }
      setWatching(!watching);
    }),
    vscode.commands.registerCommand('agentConfirmSound.testSound', () => {
      const file = pickSoundFile(context);
      outputChannel.appendLine(`[info] test sound → ${path.basename(file)}`);
      flashStatusBar('test');
      playSound(file);
    }),
    vscode.commands.registerCommand('agentConfirmSound.showLog', () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand('agentConfirmSound.addSound', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { 'Sound files': ['wav', 'mp3', 'aiff', 'ogg', 'flac'] },
        title: 'Add sound files to Agent Bell',
      });
      if (!uris || uris.length === 0) {
        return;
      }
      const current = getConfig().get<string[]>('sounds', []);
      const added = uris.map((u) => u.fsPath).filter((p) => !current.includes(p));
      await getConfig().update('sounds', [...current, ...added], vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Agent Bell: added ${added.length} sound file(s). Mode: ${getConfig().get('soundMode', 'fixed')}.`);
    }),
    vscode.commands.registerCommand('agentConfirmSound.chooseSounds', async () => {
      const sounds = getConfig().get<string[]>('sounds', []);
      const bundledLabel = '$(file-media) Bundled (default)';
      const mode = getConfig().get<string>('soundMode', 'fixed');

      const items: vscode.QuickPickItem[] = [
        {
          label: bundledLabel,
          description: 'notify.wav included with Agent Bell',
          picked: sounds.length === 0,
        },
        ...sounds.map((s) => ({
          label: `$(file-media) ${path.basename(s)}`,
          description: s,
          picked: true,
        })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
          label: `$(add) Add sound file…`,
          description: 'Pick a .wav / .mp3 / .aiff file',
        },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        {
          label: mode === 'random' ? '$(check) Random mode: On' : '$(circle-slash) Random mode: Off',
          description: mode === 'random' ? 'Click to use fixed (first) sound' : 'Click to pick randomly from all sounds',
        },
      ];

      const pick = await vscode.window.showQuickPick(items, {
        title: 'Agent Bell — Manage Sounds',
        placeHolder: 'Select an action',
      });

      if (!pick) {
        return;
      }

      if (pick.label.includes('Add sound file')) {
        await vscode.commands.executeCommand('agentConfirmSound.addSound');
      } else if (pick.label.includes('Random mode')) {
        const newMode = mode === 'random' ? 'fixed' : 'random';
        await getConfig().update('soundMode', newMode, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Agent Bell: sound mode set to ${newMode}.`);
      } else if (pick.description && pick.description !== 'notify.wav included with Agent Bell') {
        const remove = await vscode.window.showWarningMessage(
          `Remove "${path.basename(pick.description)}" from the list?`,
          'Remove', 'Cancel'
        );
        if (remove === 'Remove') {
          const updated = sounds.filter((s) => s !== pick.description);
          await getConfig().update('sounds', updated, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage('Agent Bell: sound removed.');
        }
      }
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
        await removeClaudeHook(context);
        vscode.window.showInformationMessage('Agent Bell: Claude Code hook removed. Safe to uninstall the extension now.');
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
  outputChannel.appendLine(`[info] Sound mode: ${getConfig().get('soundMode', 'fixed')} | Sounds: ${getConfig().get<string[]>('sounds', []).length} custom`);
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

  const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  outputChannel.appendLine(`[match] "${terminal.name}" matched ${matched} at ${new Date(now).toISOString()}`);

  if (getConfig().get<boolean>('focusTerminal', false)) {
    terminal.show(true);
  }

  flashStatusBar(timeLabel);
  triggerSound(context);
}

export function deactivate() {
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  lastTriggerAt.clear();
}

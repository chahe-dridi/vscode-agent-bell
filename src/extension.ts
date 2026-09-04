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
let tempFileCounter = 0;
let hookSignalWatcher: fs.FSWatcher | undefined;
let lastHookSignalTs = 0;

// ─── Alert history ────────────────────────────────────────────────────────────

interface AlertRecord {
  ts: number;
  source: string;
  type: 'hook' | 'pattern' | 'command-end';
  detail: string;
}
const MAX_HISTORY = 50;
const alertHistory: AlertRecord[] = [];

function addAlert(record: AlertRecord) {
  alertHistory.unshift(record);
  if (alertHistory.length > MAX_HISTORY) { alertHistory.length = MAX_HISTORY; }
  updateStatusBar();
}

// ─── Reminder escalation ──────────────────────────────────────────────────────

let reminderTimer: ReturnType<typeof setTimeout> | undefined;
let reminderCount = 0;
let reminderSource = '';
let reminderTerminal: vscode.Terminal | undefined;

function scheduleReminder(source: string, terminal?: vscode.Terminal) {
  clearReminder();
  const intervalMs = getConfig().get<number>('reminderIntervalMs', 0);
  const maxCount   = getConfig().get<number>('reminderMaxCount', 3);
  if (intervalMs <= 0 || maxCount <= 0) { return; }
  reminderSource   = source;
  reminderTerminal = terminal;
  reminderCount    = 0;

  function fire() {
    reminderCount++;
    outputChannel.appendLine(`[reminder] #${reminderCount}/${maxCount} — ${reminderSource}`);
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flashStatusBar(timeLabel);
    triggerSound(extensionContext);
    if (!vscode.window.state.focused) {
      showOsNotification(`Still waiting: ${reminderSource}`);
    }
    reminderTimer = reminderCount < maxCount ? setTimeout(fire, intervalMs) : undefined;
  }
  reminderTimer = setTimeout(fire, intervalMs);
}

function clearReminder() {
  if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = undefined; }
  reminderSource   = '';
  reminderTerminal = undefined;
  reminderCount    = 0;
}

const lastTriggerAt   = new Map<vscode.Terminal, number>();
const commandStartAt  = new Map<vscode.Terminal, number>();
const terminalExecutionControllers = new Map<vscode.Terminal, AbortController>();

const STABLE_SOUND_PATH  = path.join(os.homedir(), '.claude', 'agent-bell-notify.wav');
const MUTE_FLAG_PATH     = path.join(os.homedir(), '.claude', 'agent-bell-mute');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
// Written by each hook command so the extension can flash the status bar and
// show an OS notification even when VSCode is not the source of the event.
const HOOK_SIGNAL_PATH   = path.join(os.homedir(), '.claude', 'agent-bell-signal');
const HOOK_MARKER = 'agent-bell-notify';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAnsi(input: string): string {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function getConfig() {
  return vscode.workspace.getConfiguration('agentConfirmSound');
}

function getAlertOn(): string[] {
  return getConfig().get<string[]>('alertOn', ['confirmation', 'completion']);
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
    const pool = Array.from(new Set([bundled, ...sounds]));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return sounds[0];
}

// ─── OS notification ─────────────────────────────────────────────────────────

function showOsNotification(message: string) {
  if (!getConfig().get<boolean>('osNotification', true)) { return; }
  const platform = os.platform();
  if (platform === 'win32') {
    // Single-quoted PS strings are literal — only single-quotes in the message need escaping.
    const msg = message.replace(/'/g, "''");
    const script = [
      `Add-Type -AssemblyName System.Windows.Forms`,
      `$n = New-Object System.Windows.Forms.NotifyIcon`,
      `$n.Icon = [System.Drawing.SystemIcons]::Information`,
      `$n.Visible = $true`,
      `$n.BalloonTipTitle = 'Notification Bell'`,
      `$n.BalloonTipText = '${msg}'`,
      `$n.BalloonTipIcon = 'Info'`,
      `$n.ShowBalloonTip(5000)`,
      `Start-Sleep -Seconds 5`,
      `$n.Dispose()`,
    ].join('; ');
    cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    // Escape both " and \ — AppleScript string delimiters are " and \ is the only escape char.
    const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    cp.spawn('osascript', ['-e', `display notification "${escaped}" with title "Notification Bell"`],
      { stdio: 'ignore', detached: true }).unref();
  } else {
    const child = cp.spawn('notify-send', ['Notification Bell', message, '--expire-time=5000'],
      { stdio: 'ignore', detached: true });
    child.on('error', () => {
      outputChannel.appendLine('[warn] notify-send not found — install libnotify-bin for OS notifications on Linux');
    });
    child.unref();
  }
}

// ─── Sound playback ──────────────────────────────────────────────────────────

// Scale 16-bit PCM WAV samples in-memory.
// Returns the original buffer unchanged if it is not a standard 16-bit PCM WAV
// (bad RIFF/WAVE magic, non-PCM format, or non-16-bit depth) or if factor ≈ 1.0.
function scaleWavBuffer(buf: Buffer, factor: number): Buffer {
  if (factor >= 0.999) { return buf; }
  // Validate RIFF/WAVE container header
  if (buf.length < 44) { return buf; }
  if (buf.toString('ascii', 0, 4) !== 'RIFF') { return buf; }
  if (buf.toString('ascii', 8, 12) !== 'WAVE') { return buf; }
  // fmt chunk at offset 12: audio format (offset 20) must be 1 (PCM),
  // and bits-per-sample (offset 34) must be 16. Other depths (8, 24, 32f) are not scaled.
  const audioFormat   = buf.readUInt16LE(20);
  const bitsPerSample = buf.readUInt16LE(34);
  if (audioFormat !== 1 || bitsPerSample !== 16) { return buf; }

  const out = Buffer.from(buf);
  for (let i = 44; i < buf.length - 1; i += 2) {
    const s = buf.readInt16LE(i);
    let n = Math.round(s * factor);
    if (n > 32767)  { n = 32767; }
    if (n < -32768) { n = -32768; }
    out.writeInt16LE(n, i);
  }
  return out;
}

// hookEvent is embedded literally into the command string so each hook event
// writes a different label to the signal file, letting the extension show the
// right notification text (e.g. "Claude finished" vs "Claude notification").
function buildHookCommand(soundFile: string, hookEvent: string): string {
  const platform = os.platform();
  const mutePs = MUTE_FLAG_PATH.replace(/\\/g, '\\\\');
  // Signal path is plain ASCII — no escaping needed for the shell echo.
  const signalPath = HOOK_SIGNAL_PATH;

  if (platform === 'darwin') {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    // Semicolon runs the signal write unconditionally (muted or not) so the
    // status-bar flash still appears even if audio is suppressed.
    return `(test -f "${MUTE_FLAG_PATH}" || afplay -v ${volume} "${soundFile}"); printf '%s' "${hookEvent}" > "${signalPath}"`;
  } else if (platform === 'win32') {
    // Volume is baked into STABLE_SOUND_PATH by syncHookSound; SoundPlayer has no volume API.
    const ps = soundFile.replace(/'/g, "''");
    const signalPs = signalPath.replace(/'/g, "''");
    return `powershell -NoProfile -NonInteractive -Command "if (-not (Test-Path '${mutePs}')) { (New-Object Media.SoundPlayer '${ps}').PlaySync() }; [IO.File]::WriteAllText('${signalPs}', '${hookEvent}')"`;
  } else {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    const paVol = Math.round(volume * 65536);
    return `(test -f "${MUTE_FLAG_PATH}" || (paplay --volume=${paVol} "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null)); printf '%s' "${hookEvent}" > "${signalPath}"`;
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
    // SoundPlayer has no volume API — scale WAV bytes in memory instead.
    // Combine timestamp + monotonic counter so concurrent calls can't share the same temp path.
    let playPath = soundFile;
    if (volume < 0.999 && soundFile.toLowerCase().endsWith('.wav')) {
      try {
        const raw = fs.readFileSync(soundFile);
        const scaled = scaleWavBuffer(raw, volume);
        const tmp = path.join(os.tmpdir(), `agent-bell-${Date.now()}-${++tempFileCounter}.wav`);
        fs.writeFileSync(tmp, scaled);
        playPath = tmp;
      } catch { /* fall back to original file */ }
    }
    const psPath = playPath.replace(/'/g, "''");
    const isTemp = playPath !== soundFile;
    cmd = 'powershell';
    args = ['-NoProfile', '-NonInteractive', '-Command',
      isTemp
        ? `(New-Object Media.SoundPlayer '${psPath}').PlaySync(); Remove-Item '${psPath}' -ErrorAction SilentlyContinue`
        : `(New-Object Media.SoundPlayer '${psPath}').PlaySync()`
    ];
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
    // corrupt or missing — return empty so callers degrade gracefully
  }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// Each entry: which Claude Code hook event to register, and what matcher to use.
// PreToolUse is kept here so isHookInstalled() and removeClaudeHook() cover existing installs,
// but installClaudeHook() only adds it when agentConfirmSound.hookPreToolUse is true.
const HOOK_CONFIGS = [
  { event: 'Stop',        matcher: '' },
  { event: 'Notification', matcher: '' },
  { event: 'PreToolUse',  matcher: 'Bash' },
] as const;

type HookGroup = { matcher: string; hooks: Array<{ type: string; command: string }> };
type HookGroupRead = { hooks?: Array<{ command?: string }> };

// Always reads from disk so external edits to settings.json (other Claude Code sessions,
// manual edits) are reflected immediately without stale cache mismatches.
function isHookInstalled(): boolean {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (!hooks) { return false; }
  return HOOK_CONFIGS.some(({ event }) => {
    const groups = hooks[event] as HookGroupRead[] | undefined;
    return groups?.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));
  });
}

// Copy the given sound (or the currently active one) scaled by volume to the stable hook path.
// Pass `sourcePath` explicitly whenever you already know which file should be active — this avoids
// reading config that may not have been committed to disk yet.
function syncHookSound(context: vscode.ExtensionContext, sourcePath?: string) {
  try {
    let src = sourcePath ?? pickSoundFile(context);
    if (!fs.existsSync(src)) {
      outputChannel.appendLine(`[hook] syncHookSound skipped — file not found: ${src}`);
      return;
    }
    // Windows Media.SoundPlayer only plays uncompressed PCM WAV.
    // If the active sound is a non-WAV format, fall back to the bundled WAV for the hook.
    if (os.platform() === 'win32' && !src.toLowerCase().endsWith('.wav')) {
      outputChannel.appendLine(`[hook] non-WAV source (${path.basename(src)}) — falling back to bundled WAV for hook`);
      src = path.join(context.extensionPath, 'media', 'notify.wav');
    }
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    const raw = fs.readFileSync(src);
    const out = src.toLowerCase().endsWith('.wav') ? scaleWavBuffer(raw, volume) : raw;
    fs.writeFileSync(STABLE_SOUND_PATH, out);
    outputChannel.appendLine(`[hook] synced → ${path.basename(src)} at vol ${Math.round(volume * 100)}%`);
  } catch (e) {
    outputChannel.appendLine(`[hook] syncHookSound failed: ${e}`);
  }
}

// ─── Hook signal (IPC from Claude Code hooks back into the extension) ─────────

const HOOK_EVENT_LABELS: Record<string, string> = {
  Stop:        'Claude finished — ready for your next message',
  Notification: 'Claude sent a notification',
  PreToolUse:  'Claude is waiting for bash approval',
};

// Maps each Claude Code hook event to an alertOn trigger category.
const HOOK_TRIGGER_TYPE: Record<string, string> = {
  Stop:        'completion',
  Notification: 'completion',
  PreToolUse:  'confirmation',
};

function handleHookSignal() {
  try {
    const event = fs.readFileSync(HOOK_SIGNAL_PATH, 'utf8').trim();
    if (!event) { return; }
    const triggerType = HOOK_TRIGGER_TYPE[event];
    if (triggerType && !getAlertOn().includes(triggerType)) { return; }
    const now = Date.now();
    const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    outputChannel.appendLine(`[hook] signal: ${event} at ${timeLabel}`);
    addAlert({ ts: now, source: 'Claude Code', type: 'hook', detail: event });
    if (watching) {
      flashStatusBar(timeLabel);
      if (!vscode.window.state.focused) {
        showOsNotification(HOOK_EVENT_LABELS[event] ?? 'Claude Code needs your attention');
      }
      scheduleReminder(HOOK_EVENT_LABELS[event] ?? 'Claude Code');
    }
  } catch {
    // file may not exist yet or be mid-write — ignore
  }
}

function setupHookSignalWatcher() {
  if (hookSignalWatcher) { return; }
  const claudeDir = path.dirname(HOOK_SIGNAL_PATH);
  if (!fs.existsSync(claudeDir)) { return; }
  try {
    hookSignalWatcher = fs.watch(claudeDir, (_eventType, filename) => {
      // filename can be null on some platforms — guard against it.
      if (!filename || filename !== path.basename(HOOK_SIGNAL_PATH)) { return; }
      const now = Date.now();
      // Debounce: a single write can fire 2-3 fs events on some OSes.
      if (now - lastHookSignalTs < 400) { return; }
      lastHookSignalTs = now;
      handleHookSignal();
    });
    hookSignalWatcher.on('error', (e) => {
      outputChannel.appendLine(`[hook] signal watcher error: ${e}`);
      hookSignalWatcher = undefined;
    });
    outputChannel.appendLine('[hook] watching for hook signals.');
  } catch (e) {
    outputChannel.appendLine(`[hook] could not set up signal watcher: ${e}`);
  }
}

function teardownHookSignalWatcher() {
  if (hookSignalWatcher) {
    hookSignalWatcher.close();
    hookSignalWatcher = undefined;
  }
}

// ─── Hook command helpers ─────────────────────────────────────────────────────

// Update the command string inside already-installed hooks (e.g. after volume or sound change).
function refreshHookCommands() {
  try {
    const settings = readClaudeSettings();
    const hooks = settings['hooks'] as Record<string, HookGroupRead[]> | undefined;
    if (!hooks) { return; }
    // Build a per-event command so each hook writes its own event name to the signal file.
    for (const { event } of HOOK_CONFIGS) {
      const cmd = buildHookCommand(STABLE_SOUND_PATH, event);
      for (const g of (hooks[event] ?? [])) {
        for (const h of (g.hooks ?? [])) {
          if (h.command?.includes(HOOK_MARKER)) {
            (h as { command: string }).command = cmd;
          }
        }
      }
    }
    settings['hooks'] = hooks;
    writeClaudeSettings(settings);
    outputChannel.appendLine('[hook] commands refreshed.');
  } catch (e) {
    outputChannel.appendLine(`[hook] refreshHookCommands failed: ${e}`);
  }
}

async function installClaudeHook(context: vscode.ExtensionContext): Promise<void> {
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  syncHookSound(context);
  outputChannel.appendLine(`[hook] sound written to ${STABLE_SOUND_PATH}`);

  const settings = readClaudeSettings();
  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;

  // PreToolUse fires before every bash command — including auto-approved ones.
  // Only install it when the user explicitly opts in, to avoid sound spam.
  const includePreToolUse = getConfig().get<boolean>('hookPreToolUse', false);

  for (const { event, matcher } of HOOK_CONFIGS) {
    if (event === 'PreToolUse' && !includePreToolUse) { continue; }
    // Each event gets its own command so it writes its name to the signal file.
    const cmd = buildHookCommand(STABLE_SOUND_PATH, event);
    const entry: HookGroup = { matcher, hooks: [{ type: 'command', command: cmd }] };
    const existing = (hooks[event] ?? []) as HookGroup[];
    if (!existing.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)))) {
      existing.push(entry);
      hooks[event] = existing;
    }
  }

  setupHookSignalWatcher();

  settings['hooks'] = hooks;
  writeClaudeSettings(settings);
  const hookList = `Stop + Notification${includePreToolUse ? ' + PreToolUse(Bash)' : ''}`;
  outputChannel.appendLine(`[hook] Claude Code ${hookList} hooks installed.`);
  await context.globalState.update('hookDecision', 'installed');
}

async function removeClaudeHook(context: vscode.ExtensionContext): Promise<void> {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (hooks) {
    for (const { event } of HOOK_CONFIGS) {
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
    if (fs.existsSync(STABLE_SOUND_PATH)) { fs.unlinkSync(STABLE_SOUND_PATH); }
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
  const count = alertHistory.length;
  if (!watching) {
    statusBarItem.text = '🔕';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = 'Notification Bell — paused (click to resume)';
  } else {
    statusBarItem.text = count > 99 ? '🔔 99+' : count > 0 ? `🔔 ${count}` : '🔔';
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = count > 0
      ? `Notification Bell — ${count} alert${count === 1 ? '' : 's'} this session`
      : 'Notification Bell — watching (click to pause)';
  }
  statusBarItem.show();
}

function flashStatusBar(label: string) {
  lastMatchLabel = label;
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  statusBarItem.text = `$(bell-dot) Notification Bell: Alert!`;
  statusBarItem.color = undefined;
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  statusBarItem.tooltip = `Last alert: ${label}`;
  statusBarItem.show();
  flashTimer = setTimeout(() => {
    flashTimer = undefined;
    updateStatusBar();
  }, 2000);
}

function setMuteFlag(muted: boolean) {
  try {
    const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(claudeDir)) { return; }
    if (muted) {
      fs.writeFileSync(MUTE_FLAG_PATH, '', 'utf8');
    } else if (fs.existsSync(MUTE_FLAG_PATH)) {
      fs.unlinkSync(MUTE_FLAG_PATH);
    }
  } catch { /* ignore if .claude dir doesn't exist */ }
}

function setWatching(value: boolean) {
  watching = value;
  updateStatusBar();
  setMuteFlag(!value);
  if (!value) { clearReminder(); }
  outputChannel.appendLine(value ? '[info] watching started.' : '[info] watching paused.');
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Notification Bell');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.command = 'agentConfirmSound.toggle';
  statusBarItem.show();

  setWatching(getConfig().get<boolean>('enabled', true));

  // Migrate existing hooks to the latest command format on startup and start
  // watching for hook signals so the status bar reflects hook-triggered events.
  if (isHookInstalled()) {
    refreshHookCommands();
    setupHookSignalWatcher();
  }

  // Only show the setup modal if the user hasn't made a decision yet.
  const hookDecision = context.globalState.get<string>('hookDecision');
  if (!hookDecision && !isHookInstalled()) {
    vscode.window.showInformationMessage(
      [
        'Notification Bell — Claude Code Integration',
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
        '• Notification hook → plays when Claude sends a background notification',
        '',
        'Nothing is sent externally. Fully reversible via:',
        '"Notification Bell: Remove Claude Code Integration"',
      ].join('\n'),
      { modal: true },
      'Set it up',
      'Not now'
    ).then(async (choice) => {
      if (choice === 'Set it up') {
        try {
          await installClaudeHook(context);
          vscode.window.showInformationMessage("Notification Bell: Claude Code integration ready. You'll hear a sound when Claude finishes or needs your input.");
        } catch (e) {
          vscode.window.showErrorMessage(`Notification Bell: failed to install hook — ${e}`);
        }
      } else if (choice === 'Not now') {
        await context.globalState.update('hookDecision', 'declined');
      }
      // If dismissed (undefined), don't record a decision so we ask again next time.
    });
  }

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    { dispose: teardownHookSignalWatcher },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentConfirmSound.patterns')) {
        cachedPatterns = null;
        outputChannel.appendLine('[info] pattern cache cleared.');
      }
      if (e.affectsConfiguration('agentConfirmSound.enabled')) {
        setWatching(getConfig().get<boolean>('enabled', true));
      }
      // Re-sync the hook file whenever volume, sounds, or soundMode changes.
      if (
        (e.affectsConfiguration('agentConfirmSound.volume') ||
         e.affectsConfiguration('agentConfirmSound.sounds') ||
         e.affectsConfiguration('agentConfirmSound.soundMode')) &&
        isHookInstalled()
      ) {
        syncHookSound(context);
        refreshHookCommands();
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      lastTriggerAt.delete(terminal);
      commandStartAt.delete(terminal);
      // Abort the watchExecution loop so the async iterator does not linger.
      const ac = terminalExecutionControllers.get(terminal);
      if (ac) {
        ac.abort();
        terminalExecutionControllers.delete(terminal);
      }
    }),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      commandStartAt.set(event.terminal, Date.now());

      // If the user ran a new command in the terminal that triggered the active reminder,
      // they have responded — cancel the reminder so it doesn't keep re-alerting.
      if (reminderTerminal === event.terminal) { clearReminder(); }

      // Only stream output for terminals that could produce alerts.
      // Skipping filtered-out and pattern-free cases avoids reading their entire output.
      if (getAlertOn().includes('confirmation') && getPatterns().length > 0 && terminalPassesNameFilter(event.terminal)) {
        // Abort the previous watcher for this terminal (e.g. rapid command re-runs).
        const prev = terminalExecutionControllers.get(event.terminal);
        if (prev) { prev.abort(); }
        const ac = new AbortController();
        terminalExecutionControllers.set(event.terminal, ac);
        watchExecution(context, event.terminal, event.execution, ac.signal);
      }
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      if (!watching) { return; }
      if (!getAlertOn().includes('completion')) { return; }
      if (!getConfig().get<boolean>('alertOnCommandEnd', true)) { return; }
      if (!terminalPassesNameFilter(event.terminal)) { return; }

      const now = Date.now();
      const started = commandStartAt.get(event.terminal);
      commandStartAt.delete(event.terminal);
      if (started === undefined) { return; }  // command started before extension was active
      const elapsed = now - started;
      const minMs = getConfig().get<number>('commandEndMinDurationMs', 3000);
      if (elapsed < minMs) { return; }

      // If a pattern-match alert already fired during this command, skip — the
      // user was already notified; double-alerting for the same command would be noise.
      const lastTrigger = lastTriggerAt.get(event.terminal) ?? 0;
      if (lastTrigger >= started) { return; }

      const debounceMs = getConfig().get<number>('debounceMs', 4000);
      if (lastTrigger + debounceMs > now) { return; }
      lastTriggerAt.set(event.terminal, now);

      const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const exit = event.exitCode;
      const elapsedStr = `finished in ${Math.round(elapsed / 1000)}s`;
      outputChannel.appendLine(`[done] "${event.terminal.name}" ${elapsedStr} (exit ${exit ?? '?'})`);
      addAlert({ ts: now, source: event.terminal.name, type: 'command-end', detail: elapsedStr });

      if (getConfig().get<boolean>('focusTerminal', false)) { event.terminal.show(true); }

      flashStatusBar(timeLabel);
      triggerSound(context);

      if (!vscode.window.state.focused) {
        const label = exit !== undefined && exit !== 0
          ? `"${event.terminal.name}" failed (exit ${exit})`
          : `"${event.terminal.name}" finished`;
        showOsNotification(label);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.toggle', () => {
      // Clear any active flash before toggling so the state change is immediate.
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
    vscode.commands.registerCommand('agentConfirmSound.dismissReminder', () => {
      if (!reminderTimer) {
        vscode.window.showInformationMessage('No active reminder.');
        return;
      }
      clearReminder();
      vscode.window.showInformationMessage('Reminder dismissed.');
    }),
    vscode.commands.registerCommand('agentConfirmSound.configureAlertTriggers', async () => {
      const current = getAlertOn();
      type TriggerItem = vscode.QuickPickItem & { value: string };
      const items: TriggerItem[] = [
        {
          label: '$(bell) Confirmation prompts',
          description: 'Alert when your agent asks y/n, needs approval, or waits for input',
          picked: current.includes('confirmation'),
          value: 'confirmation',
        },
        {
          label: '$(check) Task completed',
          description: 'Alert when a long-running command or agent turn finishes',
          picked: current.includes('completion'),
          value: 'completion',
        },
      ];
      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: 'Notification Bell — When should alerts fire?',
        placeHolder: 'Space to toggle, Enter to confirm',
      });
      if (selected === undefined) { return; }
      if (selected.length === 0) {
        const confirm = await vscode.window.showWarningMessage(
          'No triggers selected — Notification Bell will never alert. Are you sure?',
          'Disable all', 'Cancel'
        );
        if (confirm !== 'Disable all') { return; }
      }
      const newValue = (selected as TriggerItem[]).map((i) => i.value);
      await getConfig().update('alertOn', newValue, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        newValue.length === 0
          ? 'Notification Bell: all alert triggers disabled.'
          : `Notification Bell: alerting on — ${(selected as TriggerItem[]).map((i) => i.label.replace(/\$\(\w[\w-]*\) /, '')).join(' + ')}.`
      );
    }),
    vscode.commands.registerCommand('agentConfirmSound.addSound', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { 'Sound files': ['wav', 'mp3', 'aiff', 'ogg', 'flac'] },
        title: 'Add sound files to Notification Bell',
      });
      if (!uris || uris.length === 0) { return; }

      const current = getConfig().get<string[]>('sounds', []);
      const added = uris.map((u) => u.fsPath).filter((p) => !current.includes(p));
      if (added.length === 0) {
        vscode.window.showInformationMessage('Notification Bell: those files are already in the list.');
        return;
      }

      const updated = [...current, ...added];
      await getConfig().update('sounds', updated, vscode.ConfigurationTarget.Global);

      const activate = await vscode.window.showInformationMessage(
        `Added: ${added.map((p) => path.basename(p)).join(', ')}`,
        'Use this sound now', 'Keep current'
      );
      if (activate === 'Use this sound now') {
        const withNew = [added[0], ...updated.filter((s) => s !== added[0])];
        await getConfig().update('sounds', withNew, vscode.ConfigurationTarget.Global);
        await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
        if (isHookInstalled()) { syncHookSound(context, added[0]); }
        vscode.window.showInformationMessage(`Notification Bell: now using ${path.basename(added[0])}.`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.chooseSounds', async () => {
      while (true) {
        const sounds = getConfig().get<string[]>('sounds', []);
        const mode = getConfig().get<string>('soundMode', 'fixed');
        const volume = getConfig().get<number>('volume', 1);
        const isRandom = mode === 'random';

        const defaultBundledPath = path.join(context.extensionPath, 'media', 'notify.wav');
        const bellBundledPath = path.join(context.extensionPath, 'media', 'notification-bell.mp3');

        // Check which sound is currently active in fixed mode
        // If sounds is empty, notify.wav is the default active sound
        const isDefaultBundledActive = !isRandom && (sounds.length === 0 || sounds[0] === defaultBundledPath);
        const isBellBundledActive = !isRandom && sounds.length > 0 && sounds[0] === bellBundledPath;

        const items: vscode.QuickPickItem[] = [];

        items.push({
          label: isDefaultBundledActive ? '$(check) Bundled — notify.wav     (default)' : '$(file-media) Bundled — notify.wav     (default)',
          description: defaultBundledPath,
          detail: isDefaultBundledActive ? 'Active — click to preview' : 'Click to switch to this sound',
        });

        items.push({
          label: isBellBundledActive ? '$(check) Bundled — notification-bell.mp3' : '$(file-media) Bundled — notification-bell.mp3',
          description: bellBundledPath,
          detail: isBellBundledActive ? 'Active — click to preview' : 'Click to switch to this sound',
        });

        // Filter out any bundled paths from custom sounds list so they aren't duplicated
        const customSounds = sounds.filter((s) => s !== defaultBundledPath && s !== bellBundledPath);

        for (let i = 0; i < customSounds.length; i++) {
          const isActive = !isRandom && sounds[0] === customSounds[i];
          items.push({
            label: isActive ? `$(check) ${path.basename(customSounds[i])}` : `$(file-media) ${path.basename(customSounds[i])}`,
            description: customSounds[i],
            detail: isActive ? 'Active — click to preview or remove' : 'Click to make this the active sound',
          });
        }

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
          label: '$(add) Add sound file…',
          description: 'Browse for .wav / .mp3 / .aiff',
        });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
          label: `$(unmute) Volume: ${Math.round(volume * 100)}%`,
          description: 'Click to change (applied via sample scaling on Windows, afplay/paplay on other platforms)',
        });
        items.push({
          label: isRandom ? '$(check) Random mode: On' : '$(circle-slash) Random mode: Off',
          description: isRandom
            ? 'Picks a random sound each time — click to use fixed'
            : 'Always plays the active sound — click to randomise',
        });

        const pick = await vscode.window.showQuickPick(items, {
          title: 'Notification Bell — Sounds',
          placeHolder: 'Click a sound to activate it, or choose an action',
        });

        if (!pick) { return; }

        if (pick.label.includes('Add sound file')) {
          await vscode.commands.executeCommand('agentConfirmSound.addSound');
          continue;
        }

        if (pick.label.includes('Volume:')) {
          const volPick = await vscode.window.showQuickPick(
            [
              { label: '25%' }, { label: '50%' }, { label: '75%' }, { label: '100%' },
              { label: 'Custom…', description: 'Enter any value 0–100' },
            ],
            { title: `Notification Bell — Volume  (current: ${Math.round(volume * 100)}%)` }
          );
          if (!volPick) { continue; }
          let newVol: number;
          if (volPick.label === 'Custom…') {
            const input = await vscode.window.showInputBox({
              prompt: 'Volume (0 = silent, 100 = full)',
              value: String(Math.round(volume * 100)),
              validateInput: (v) => {
                const n = parseInt(v, 10);
                return isNaN(n) || n < 0 || n > 100 ? 'Enter a number from 0 to 100' : undefined;
              },
            });
            if (input === undefined) { continue; }
            newVol = parseInt(input, 10) / 100;
          } else {
            newVol = parseInt(volPick.label, 10) / 100;
          }
          await getConfig().update('volume', newVol, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`Notification Bell: volume set to ${Math.round(newVol * 100)}%.`);
          continue;
        }

        if (pick.label.includes('Random mode')) {
          const newMode = isRandom ? 'fixed' : 'random';
          await getConfig().update('soundMode', newMode, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(
            newMode === 'random'
              ? 'Notification Bell: random mode on — will shuffle through all sounds.'
              : 'Notification Bell: fixed mode — will play the active sound every time.'
          );
          continue;
        }

        const soundPath = pick.description!;
        const isBundledDefault = soundPath === defaultBundledPath;
        const isBundledBell = soundPath === bellBundledPath;
        const isBundled = isBundledDefault || isBundledBell;
        const isActive = !isRandom && (
          (isBundledDefault && (sounds.length === 0 || sounds[0] === defaultBundledPath)) ||
          (sounds.length > 0 && sounds[0] === soundPath)
        );

        if (isActive) {
          if (isBundled) {
            playSound(soundPath);
            continue;
          }
          const action = await vscode.window.showQuickPick(
            [
              { label: '$(play) Preview', description: path.basename(soundPath) },
              { label: '$(trash) Remove from list', description: path.basename(soundPath) },
            ],
            { title: `${path.basename(soundPath)}` }
          );
          if (!action) { continue; }
          if (action.label.includes('Preview')) {
            playSound(soundPath);
          } else if (action.label.includes('Remove')) {
            const updated2 = sounds.filter((s) => s !== soundPath);
            await getConfig().update('sounds', updated2, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Notification Bell: removed ${path.basename(soundPath)}.`);
          }
        } else {
          if (isBundledDefault) {
            const filtered = sounds.filter((s) => s !== defaultBundledPath && s !== bellBundledPath);
            await getConfig().update('sounds', filtered, vscode.ConfigurationTarget.Global);
            await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
            if (isHookInstalled()) { syncHookSound(context, defaultBundledPath); }
            vscode.window.showInformationMessage('Notification Bell: switched to bundled sound (notify.wav).');
          } else {
            const reordered = [soundPath, ...sounds.filter((s) => s !== soundPath)];
            await getConfig().update('sounds', reordered, vscode.ConfigurationTarget.Global);
            await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
            if (isHookInstalled()) { syncHookSound(context, soundPath); }
            vscode.window.showInformationMessage(`Notification Bell: now using ${path.basename(soundPath)}.`);
          }
        }
        continue;
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.setupClaudeHook', async () => {
      if (isHookInstalled()) {
        vscode.window.showInformationMessage('Notification Bell: Claude Code hook is already installed.');
        return;
      }
      try {
        await installClaudeHook(context);
        setupHookSignalWatcher();
        vscode.window.showInformationMessage('Notification Bell: Claude Code integration ready.');
      } catch (e) {
        vscode.window.showErrorMessage(`Notification Bell: failed to install hook — ${e}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.removeClaudeHook', async () => {
      if (!isHookInstalled()) {
        vscode.window.showInformationMessage('Notification Bell: no Claude Code hook found.');
        return;
      }
      try {
        await removeClaudeHook(context);
        vscode.window.showInformationMessage('Notification Bell: Claude Code hook removed. Safe to uninstall the extension now.');
      } catch (e) {
        vscode.window.showErrorMessage(`Notification Bell: failed to remove hook — ${e}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.showHistory', () => {
      if (alertHistory.length === 0) {
        vscode.window.showInformationMessage('Notification Bell: no alerts recorded yet in this session.');
        return;
      }
      const items: vscode.QuickPickItem[] = alertHistory.map((r) => {
        const time = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const icon = r.type === 'hook' ? '$(cloud)' : r.type === 'command-end' ? '$(check)' : '$(bell)';
        return { label: `${icon}  ${time}`, description: r.source, detail: r.detail };
      });
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(trash) Clear history', description: `${alertHistory.length} alerts` }
      );
      vscode.window.showQuickPick(items, {
        title: `Notification Bell — Alert History  (${alertHistory.length})`,
        placeHolder: 'Recent alerts — read-only. Select "Clear history" to reset.',
      }).then((pick) => {
        if (pick?.label.includes('Clear history')) {
          alertHistory.length = 0;
          updateStatusBar();
          vscode.window.showInformationMessage('Notification Bell: history cleared.');
        }
      });
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
        await vscode.env.clipboard.writeText(matched.source);
        vscode.window.showInformationMessage(`Notification Bell: matched — ${matched}  (copied to clipboard)`);
      } else {
        outputChannel.appendLine(`[test] ❌ no match for: ${clean}`);
        outputChannel.show();
        vscode.window.showWarningMessage('Notification Bell: no pattern matched. Check the log and adjust your patterns.');
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.resetDefaults', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all Notification Bell settings to defaults?',
        {
          modal: true,
          detail: 'This will reset all Notification Bell settings to their defaults. Continue?',
        },
        'Reset'
      );
      if (confirm !== 'Reset') {
        return;
      }

      const config = vscode.workspace.getConfiguration();
      const keys = [
        'agentConfirmSound.enabled',
        'agentConfirmSound.alertOn',
        'agentConfirmSound.patterns',
        'agentConfirmSound.terminalNameFilter',
        'agentConfirmSound.debounceMs',
        'agentConfirmSound.volume',
        'agentConfirmSound.sounds',
        'agentConfirmSound.soundMode',
        'agentConfirmSound.focusTerminal',
        'agentConfirmSound.alertOnCommandEnd',
        'agentConfirmSound.commandEndMinDurationMs',
        'agentConfirmSound.osNotification',
        'agentConfirmSound.hookPreToolUse',
        'agentConfirmSound.reminderIntervalMs',
        'agentConfirmSound.reminderMaxCount',
        'agentConfirmSound.debugLog',
      ];
      for (const key of keys) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage('Notification Bell: settings reset to defaults.');
    })
  );

  outputChannel.appendLine(`[info] Notification Bell ${context.extension.packageJSON.version} activated. Watching: ${watching}`);
  outputChannel.appendLine(`[info] Claude Code hook: ${isHookInstalled() ? 'installed' : 'not installed'}`);
  outputChannel.appendLine(`[info] Sound mode: ${getConfig().get('soundMode', 'fixed')} | Sounds: ${getConfig().get<string[]>('sounds', []).length} custom`);
}

async function watchExecution(
  context: vscode.ExtensionContext,
  terminal: vscode.Terminal,
  execution: vscode.TerminalShellExecution,
  signal: AbortSignal
) {
  try {
    for await (const chunk of execution.read()) {
      if (signal.aborted) { break; }
      maybeTrigger(context, terminal, chunk);
    }
  } catch (e) {
    if (!signal.aborted) {
      outputChannel.appendLine(`[error] stream read failed: ${e}`);
    }
  }
}

function maybeTrigger(context: vscode.ExtensionContext, terminal: vscode.Terminal, chunk: string) {
  if (!watching) { return; }
  if (!getAlertOn().includes('confirmation')) { return; }
  const patterns = getPatterns();
  if (!patterns.length) { return; }

  // Read config once for the full evaluation of this chunk.
  const config = getConfig();

  if (!terminalPassesNameFilter(terminal)) { return; }

  const clean = stripAnsi(chunk);

  if (config.get<boolean>('debugLog', false)) {
    outputChannel.appendLine(`[debug] terminal="${terminal.name}" chunk=${JSON.stringify(clean.slice(0, 200))}`);
  }

  const matched = patterns.find((re) => re.test(clean));
  if (!matched) { return; }

  const debounceMs = config.get<number>('debounceMs', 4000);
  const now = Date.now();
  if ((lastTriggerAt.get(terminal) ?? 0) + debounceMs > now) { return; }
  lastTriggerAt.set(terminal, now);

  const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  outputChannel.appendLine(`[match] "${terminal.name}" matched ${matched} at ${new Date(now).toISOString()}`);
  addAlert({ ts: now, source: terminal.name, type: 'pattern', detail: matched.source });

  if (config.get<boolean>('focusTerminal', false)) {
    terminal.show(true);
  }

  flashStatusBar(timeLabel);
  triggerSound(context);

  if (!vscode.window.state.focused) {
    showOsNotification(`"${terminal.name}" needs your attention`);
  }

  scheduleReminder(`"${terminal.name}"`, terminal);
}

export function deactivate() {
  if (flashTimer) { clearTimeout(flashTimer); }
  lastTriggerAt.clear();
  commandStartAt.clear();
  // Abort all pending execution watchers so async iterators don't linger after unload.
  for (const ac of terminalExecutionControllers.values()) { ac.abort(); }
  terminalExecutionControllers.clear();
  clearReminder();
  teardownHookSignalWatcher();
  // Remove mute flag so hooks work if extension is unloaded/uninstalled.
  try { if (fs.existsSync(MUTE_FLAG_PATH)) { fs.unlinkSync(MUTE_FLAG_PATH); } } catch { /* ignore */ }
}

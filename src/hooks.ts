import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  getConfig, getAlertOn,
  CLAUDE_DIR, STABLE_SOUND_PATH, MUTE_FLAG_PATH, CLAUDE_SETTINGS_PATH, HOOK_SIGNAL_PATH, HOOK_MARKER,
} from './config';
import { log } from './logger';
import { scaleWavBuffer } from './sound';
import { addAlert } from './history';
import { flashStatusBar, getWatching } from './statusBar';
import { showOsNotification } from './notifications';
import { scheduleReminder } from './reminder';

// ─── Types ────────────────────────────────────────────────────────────────────

type HookGroup     = { matcher: string; hooks: Array<{ type: string; command: string }> };
type HookGroupRead = { hooks?: Array<{ command?: string }> };

const HOOK_CONFIGS = [
  { event: 'Stop',        matcher: '' },
  { event: 'Notification', matcher: '' },
  { event: 'PreToolUse',  matcher: 'Bash' },
] as const;

const HOOK_EVENT_LABELS: Record<string, string> = {
  Stop:        'Claude finished — ready for your next message',
  Notification: 'Claude sent a notification',
  PreToolUse:  'Claude is waiting for bash approval',
};

const HOOK_TRIGGER_TYPE: Record<string, string> = {
  Stop:        'completion',
  Notification: 'completion',
  PreToolUse:  'confirmation',
};

// ─── Settings I/O ─────────────────────────────────────────────────────────────

export function readClaudeSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
    }
  } catch { /* corrupt or missing */ }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// ─── Hook state ───────────────────────────────────────────────────────────────

export function isHookInstalled(): boolean {
  const settings = readClaudeSettings();
  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (!hooks) { return false; }
  return HOOK_CONFIGS.some(({ event }) => {
    const groups = hooks[event] as HookGroupRead[] | undefined;
    return groups?.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));
  });
}

// ─── Hook sound sync ──────────────────────────────────────────────────────────

// Tracks the current stable hook sound path — updated by syncHookSound,
// consumed by buildHookCommand and refreshHookCommands.
let _hookSoundPath = STABLE_SOUND_PATH;

function buildHookCommand(soundFile: string, hookEvent: string): string {
  const platform   = os.platform();
  const mutePs     = MUTE_FLAG_PATH.replace(/\\/g, '\\\\');
  const signalPath = HOOK_SIGNAL_PATH;

  if (platform === 'darwin') {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    return `(test -f "${MUTE_FLAG_PATH}" || afplay -v ${volume} "${soundFile}"); printf '%s' "${hookEvent}" > "${signalPath}"`;
  } else if (platform === 'win32') {
    const signalPs = signalPath.replace(/'/g, "''");
    if (soundFile.toLowerCase().endsWith('.wav')) {
      const ps = soundFile.replace(/'/g, "''");
      return `powershell -NoProfile -NonInteractive -Command "if (-not (Test-Path '${mutePs}')) { (New-Object Media.SoundPlayer '${ps}').PlaySync() }; [IO.File]::WriteAllText('${signalPs}', '${hookEvent}')"`;
    } else {
      // Non-WAV (MP3/OGG/etc.): use WPF MediaPlayer via STA thread
      const vol     = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
      const uriPath = soundFile.replace(/\\/g, '/').replace(/'/g, "''");
      return `powershell -NoProfile -NonInteractive -STA -Command "if (-not (Test-Path '${mutePs}')) { Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Volume = ${vol}; $p.Open([uri][uri]::EscapeUriString('file:///${uriPath}')); $p.Play(); Start-Sleep -Seconds 5; $p.Close() }; [IO.File]::WriteAllText('${signalPs}', '${hookEvent}')"`;
    }
  } else {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    const paVol  = Math.round(volume * 65536);
    return `(test -f "${MUTE_FLAG_PATH}" || (paplay --volume=${paVol} "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null)); printf '%s' "${hookEvent}" > "${signalPath}"`;
  }
}

export function syncHookSound(ctx: vscode.ExtensionContext, sourcePath?: string) {
  try {
    const src = sourcePath ?? pickSoundFileForHook(ctx);
    if (!fs.existsSync(src)) {
      log(`[hook] syncHookSound skipped — file not found: ${src}`);
      return;
    }
    const volume = Math.max(0, Math.min(2, getConfig().get<number>('volume', 1)));
    const isWav  = src.toLowerCase().endsWith('.wav');

    if (isWav) {
      // Scale WAV samples in-memory and write to the stable WAV path.
      const raw = fs.readFileSync(src);
      fs.writeFileSync(STABLE_SOUND_PATH, scaleWavBuffer(raw, volume));
      _hookSoundPath = STABLE_SOUND_PATH;
    } else {
      // Copy non-WAV to a stable path under ~/.claude/ with the original extension.
      // The hook command will play it via WPF MediaPlayer (Windows) or afplay/paplay.
      const ext        = path.extname(src).toLowerCase();
      const stablePath = path.join(CLAUDE_DIR, `agent-bell-sound${ext}`);
      fs.copyFileSync(src, stablePath);
      _hookSoundPath = stablePath;
    }

    log(`[hook] synced → ${path.basename(src)} at vol ${Math.round(volume * 100)}%`);
  } catch (e) {
    log(`[hook] syncHookSound failed: ${e}`);
  }
}

function pickSoundFileForHook(ctx: vscode.ExtensionContext): string {
  const bundled = path.join(ctx.extensionPath, 'media', 'notify.wav');
  const sounds  = getConfig().get<string[]>('sounds', []).filter((s) => s.trim().length > 0);
  if (sounds.length === 0) { return bundled; }
  return sounds[0];
}

// ─── Hook commands refresh ────────────────────────────────────────────────────

export function refreshHookCommands() {
  try {
    const settings = readClaudeSettings();
    const hooks = settings['hooks'] as Record<string, HookGroupRead[]> | undefined;
    if (!hooks) { return; }
    for (const { event } of HOOK_CONFIGS) {
      const cmd = buildHookCommand(_hookSoundPath, event);
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
    log('[hook] commands refreshed.');
  } catch (e) {
    log(`[hook] refreshHookCommands failed: ${e}`);
  }
}

// ─── Install / remove ─────────────────────────────────────────────────────────

export async function installClaudeHook(ctx: vscode.ExtensionContext): Promise<void> {
  if (!fs.existsSync(CLAUDE_DIR)) { fs.mkdirSync(CLAUDE_DIR, { recursive: true }); }
  syncHookSound(ctx);
  log(`[hook] sound written to ${_hookSoundPath}`);

  const settings = readClaudeSettings();
  const hooks    = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const includePreToolUse = getConfig().get<boolean>('hookPreToolUse', false);

  for (const { event, matcher } of HOOK_CONFIGS) {
    if (event === 'PreToolUse' && !includePreToolUse) { continue; }
    const cmd   = buildHookCommand(_hookSoundPath, event);
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
  log(`[hook] Claude Code ${hookList} hooks installed.`);
  await ctx.globalState.update('hookDecision', 'installed');
}

export async function removeClaudeHook(ctx: vscode.ExtensionContext): Promise<void> {
  const settings = readClaudeSettings();
  const hooks    = settings['hooks'] as Record<string, unknown> | undefined;
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
  try { if (fs.existsSync(STABLE_SOUND_PATH)) { fs.unlinkSync(STABLE_SOUND_PATH); } } catch { /* ignore */ }
  log('[hook] Claude Code hooks removed.');
  await ctx.globalState.update('hookDecision', 'removed');
}

// ─── Signal watcher (IPC from Claude Code back into the extension) ────────────

let _hookSignalWatcher: fs.FSWatcher | undefined;
let _lastHookSignalTs  = 0;

function handleHookSignal() {
  try {
    const event = fs.readFileSync(HOOK_SIGNAL_PATH, 'utf8').trim();
    if (!event) { return; }
    const triggerType = HOOK_TRIGGER_TYPE[event];
    if (triggerType && !getAlertOn().includes(triggerType)) { return; }
    const now = Date.now();
    const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    log(`[hook] signal: ${event} at ${timeLabel}`);
    addAlert({ ts: now, source: 'Claude Code', type: 'hook', detail: event });
    if (getWatching()) {
      flashStatusBar(timeLabel);
      if (!vscode.window.state.focused) {
        showOsNotification(HOOK_EVENT_LABELS[event] ?? 'Claude Code needs your attention');
      }
      scheduleReminder(HOOK_EVENT_LABELS[event] ?? 'Claude Code');
    }
  } catch { /* file may not exist yet or be mid-write */ }
}

export function setupHookSignalWatcher() {
  if (_hookSignalWatcher) { return; }
  if (!fs.existsSync(CLAUDE_DIR)) { return; }
  try {
    _hookSignalWatcher = fs.watch(CLAUDE_DIR, (_type, filename) => {
      if (!filename || filename !== path.basename(HOOK_SIGNAL_PATH)) { return; }
      const now = Date.now();
      if (now - _lastHookSignalTs < 400) { return; }
      _lastHookSignalTs = now;
      handleHookSignal();
    });
    _hookSignalWatcher.on('error', (e) => {
      log(`[hook] signal watcher error: ${e}`);
      _hookSignalWatcher = undefined;
    });
    log('[hook] watching for hook signals.');
  } catch (e) {
    log(`[hook] could not set up signal watcher: ${e}`);
  }
}

export function teardownHookSignalWatcher() {
  if (_hookSignalWatcher) {
    _hookSignalWatcher.close();
    _hookSignalWatcher = undefined;
  }
}

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  getConfig, getAlertOn,
  CLAUDE_DIR, STABLE_SOUND_PATH, MUTE_FLAG_PATH, CLAUDE_SETTINGS_PATH,
  HOOK_SIGNAL_PATH, HOOK_MARKER,
} from './config';
import { log } from './logger';
import { scaleWavBuffer, activeSoundFile } from './sound';
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

// Lenient read for detection only (isHookInstalled). Returns {} if the file is
// missing OR unparseable. NEVER use this as the base for a write — see below.
function readClaudeSettingsSafe(): Record<string, unknown> {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
    }
  } catch { /* corrupt — treated as "unknown", never written back */ }
  return {};
}

// Strict read for every write path. Returns {} only when the file is genuinely
// absent; throws if it exists but is not valid JSON. This is the guard that
// prevents us from silently overwriting a real (but momentarily malformed)
// settings.json with just our hooks and wiping the user's other settings.
export function readClaudeSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) { return {}; }
  const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `~/.claude/settings.json is not valid JSON — refusing to modify it to avoid data loss. ` +
      `Fix or remove the file, then retry. (${e})`
    );
  }
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  const data   = JSON.stringify(settings, null, 2) + '\n';
  const backup = CLAUDE_SETTINGS_PATH + '.agent-bell.bak';
  // One-time recovery snapshot from before we ever touched the file.
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH) && !fs.existsSync(backup)) {
      fs.copyFileSync(CLAUDE_SETTINGS_PATH, backup);
    }
  } catch { /* backup is best-effort */ }
  // Atomic write: a crash mid-write leaves the original intact.
  const tmp = CLAUDE_SETTINGS_PATH + '.agent-bell.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, CLAUDE_SETTINGS_PATH);
}

// ─── Hook state ───────────────────────────────────────────────────────────────

export function isHookInstalled(): boolean {
  const settings = readClaudeSettingsSafe();
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
  const platform = os.platform();

  if (platform === 'win32') {
    const mutePs = MUTE_FLAG_PATH.replace(/\\/g, '/');
    const sigPs  = HOOK_SIGNAL_PATH.replace(/\\/g, '/').replace(/'/g, "''");
    const vol    = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));

    if (soundFile.toLowerCase().endsWith('.wav')) {
      const ps = soundFile.replace(/\\/g, '/').replace(/'/g, "''");
      return `powershell -NoProfile -NonInteractive -Command "if (-not (Test-Path '${mutePs}')) { (New-Object Media.SoundPlayer '${ps}').PlaySync() }; [IO.File]::WriteAllText('${sigPs}', '${hookEvent}')"`;
    } else {
      // Inline MCI via Add-Type -Name/-MemberDefinition (winmm.dll) — no helper file needed.
      // cmd.exe collapses each "" to " before PowerShell sees the -Command string, so the C# DllImport
      // attribute and the mciSendString "open" call receive correct double-quotes after parsing.
      const sndFwd = soundFile.replace(/\\/g, '/');
      const volMci = Math.round(vol * 1000);
      return `powershell -NoProfile -NonInteractive -Command "if (-not (Test-Path '${mutePs}')) { if (-not ([System.Management.Automation.PSTypeName]'W.MCI').Type) { Add-Type -Name MCI -MemberDefinition '[DllImport(""winmm.dll"",CharSet=CharSet.Auto)] public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int cch, IntPtr hwnd);' -Namespace W }; $f = '${sndFwd}'; [W.MCI]::mciSendString(""open \`""$f\`"" type mpegvideo alias m"", $null, 0, [IntPtr]::Zero) | Out-Null; [W.MCI]::mciSendString('setaudio m volume to ${volMci}', $null, 0, [IntPtr]::Zero) | Out-Null; [W.MCI]::mciSendString('play m wait', $null, 0, [IntPtr]::Zero) | Out-Null; [W.MCI]::mciSendString('close m', $null, 0, [IntPtr]::Zero) | Out-Null }; [IO.File]::WriteAllText('${sigPs}', '${hookEvent}')"`;
    }
  } else if (platform === 'darwin') {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    return `(test -f "${MUTE_FLAG_PATH}" || afplay -v ${volume} "${soundFile}"); printf '%s' "${hookEvent}" > "${HOOK_SIGNAL_PATH}"`;
  } else {
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    const paVol  = Math.round(volume * 65536);
    return `(test -f "${MUTE_FLAG_PATH}" || (paplay --volume=${paVol} "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null)); printf '%s' "${hookEvent}" > "${HOOK_SIGNAL_PATH}"`;
  }
}

export function syncHookSound(ctx: vscode.ExtensionContext, sourcePath?: string) {
  try {
    const src = sourcePath ?? activeSoundFile(ctx);
    if (!fs.existsSync(src)) {
      log(`[hook] syncHookSound skipped — file not found: ${src}`);
      return;
    }
    const volume = Math.max(0, Math.min(2, getConfig().get<number>('volume', 1)));
    const isWav  = src.toLowerCase().endsWith('.wav');

    if (isWav) {
      const raw = fs.readFileSync(src);
      fs.writeFileSync(STABLE_SOUND_PATH, scaleWavBuffer(raw, volume));
      _hookSoundPath = STABLE_SOUND_PATH;
    } else {
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

// ─── Hook commands refresh ────────────────────────────────────────────────────

export function refreshHookCommands() {
  try {
    const settings = readClaudeSettings();
    const hooks = settings['hooks'] as Record<string, HookGroupRead[]> | undefined;
    if (!hooks) { return; }
    for (const { event } of HOOK_CONFIGS) {
      const cmd = buildHookCommand(_hookSoundPath, event);
      let seenBell = false;
      // Update command in every matching group, then collapse duplicates (keep first bell group only)
      hooks[event] = (hooks[event] ?? [])
        .map((g) => ({
          ...g,
          hooks: (g.hooks ?? []).map((h) =>
            h.command?.includes(HOOK_MARKER) ? { ...h, command: cmd } : h
          ),
        }))
        .filter((g) => {
          const hasBell = (g.hooks ?? []).some((h) => h.command?.includes(HOOK_MARKER));
          if (!hasBell) { return true; }
          if (seenBell) { return false; }
          seenBell = true;
          return true;
        });
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
  // Remove stable hook sound file and all non-WAV copies we may have written under ~/.claude/.
  // Also clean up agent-bell-play.ps1 if it was written by an earlier version (0.5.16).
  try { if (fs.existsSync(STABLE_SOUND_PATH)) { fs.unlinkSync(STABLE_SOUND_PATH); } } catch { /* ignore */ }
  try {
    for (const f of fs.readdirSync(CLAUDE_DIR).filter((n) => /^agent-bell-(sound\..+|play\.ps1)$/.test(n))) {
      fs.unlinkSync(path.join(CLAUDE_DIR, f));
    }
  } catch { /* ignore */ }
  log('[hook] Claude Code hooks removed.');
  await ctx.globalState.update('hookDecision', 'removed');
}

// ─── Signal watcher (IPC from Claude Code back into the extension) ────────────

let _hookSignalWatcher: fs.FSWatcher | undefined;
let _lastHookEvent     = '';
let _lastHookMtime     = 0;

export function handleHookSignal() {
  try {
    const stat  = fs.statSync(HOOK_SIGNAL_PATH);
    const event = fs.readFileSync(HOOK_SIGNAL_PATH, 'utf8').slice(0, 64).trim();
    if (!event) { return; }
    if (event === _lastHookEvent && stat.mtimeMs === _lastHookMtime) { return; }
    _lastHookEvent = event;
    _lastHookMtime = stat.mtimeMs;

    // Only act on events we wrote. Any other local process can write this file;
    // ignoring unknown content prevents spoofed/arbitrary alerts.
    const triggerType = HOOK_TRIGGER_TYPE[event];
    if (!triggerType) { return; }
    if (!getAlertOn().includes(triggerType)) { return; }
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
  _lastHookEvent = '';
  _lastHookMtime = 0;
}


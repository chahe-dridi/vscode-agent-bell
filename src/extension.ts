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
const lastTriggerAt   = new Map<vscode.Terminal, number>();
const commandStartAt  = new Map<vscode.Terminal, number>();

const STABLE_SOUND_PATH = path.join(os.homedir(), '.claude', 'agent-bell-notify.wav');
const MUTE_FLAG_PATH    = path.join(os.homedir(), '.claude', 'agent-bell-mute');
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

// ─── OS notification ─────────────────────────────────────────────────────────

function showOsNotification(message: string) {
  if (!getConfig().get<boolean>('osNotification', true)) { return; }
  const platform = os.platform();
  if (platform === 'win32') {
    // Balloon tip via System.Windows.Forms — works on all Windows versions
    const msg = message.replace(/'/g, "''");
    const script = [
      `Add-Type -AssemblyName System.Windows.Forms`,
      `$n = New-Object System.Windows.Forms.NotifyIcon`,
      `$n.Icon = [System.Drawing.SystemIcons]::Information`,
      `$n.Visible = $true`,
      `$n.BalloonTipTitle = 'Agent Bell'`,
      `$n.BalloonTipText = '${msg}'`,
      `$n.BalloonTipIcon = 'Info'`,
      `$n.ShowBalloonTip(5000)`,
      `Start-Sleep -Seconds 5`,
      `$n.Dispose()`,
    ].join('; ');
    cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    cp.spawn('osascript', ['-e', `display notification "${message.replace(/"/g, '\\"')}" with title "Agent Bell"`],
      { stdio: 'ignore', detached: true }).unref();
  } else {
    cp.spawn('notify-send', ['Agent Bell', message, '--expire-time=5000'],
      { stdio: 'ignore', detached: true }).unref();
  }
}

// ─── Sound playback ──────────────────────────────────────────────────────────

// Scale 16-bit PCM WAV samples in memory (works for WAV files only).
function scaleWavBuffer(buf: Buffer, factor: number): Buffer {
  if (factor >= 0.999) { return buf; }
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

function buildHookCommand(soundFile: string): string {
  const platform = os.platform();
  const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
  // Mute check: hook skips playback when the mute flag file exists (extension toggled off)
  const mutePs = MUTE_FLAG_PATH.replace(/\\/g, '\\\\');

  if (platform === 'darwin') {
    return `test -f "${MUTE_FLAG_PATH}" || afplay -v ${volume} "${soundFile}"`;
  } else if (platform === 'win32') {
    const ps = soundFile.replace(/'/g, "''");
    return `powershell -NoProfile -NonInteractive -Command "if (-not (Test-Path '${mutePs}')) { (New-Object Media.SoundPlayer '${ps}').PlaySync() }"`;
  } else {
    const paVol = Math.round(volume * 65536);
    return `test -f "${MUTE_FLAG_PATH}" || (paplay --volume=${paVol} "${soundFile}" 2>/dev/null || aplay "${soundFile}" 2>/dev/null)`;
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
    // SoundPlayer has no volume API — scale WAV bytes in memory instead
    let playPath = soundFile;
    if (volume < 0.999 && soundFile.toLowerCase().endsWith('.wav')) {
      try {
        const raw = fs.readFileSync(soundFile);
        const scaled = scaleWavBuffer(raw, volume);
        const tmp = path.join(os.tmpdir(), 'agent-bell-play.wav');
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
    // corrupt or missing
  }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// Each entry: which Claude Code hook event to register, and what matcher to use.
// PreToolUse fires right before Claude executes a tool — this is when permission dialogs appear.
const HOOK_CONFIGS = [
  { event: 'Stop',        matcher: '' },
  { event: 'Notification', matcher: '' },
  { event: 'PreToolUse',  matcher: 'Bash' },
] as const;

type HookGroup = { matcher: string; hooks: Array<{ type: string; command: string }> };
type HookGroupRead = { hooks?: Array<{ command?: string }> };

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
    const src = sourcePath ?? pickSoundFile(context);
    if (!fs.existsSync(src)) {
      outputChannel.appendLine(`[hook] syncHookSound skipped — file not found: ${src}`);
      return;
    }
    const volume = Math.min(1, Math.max(0, getConfig().get<number>('volume', 1)));
    const raw = fs.readFileSync(src);
    const out = src.toLowerCase().endsWith('.wav') ? scaleWavBuffer(raw, volume) : raw;
    fs.writeFileSync(STABLE_SOUND_PATH, out);
    outputChannel.appendLine(`[hook] synced → ${src} at vol ${Math.round(volume * 100)}%`);
  } catch (e) {
    outputChannel.appendLine(`[hook] syncHookSound failed: ${e}`);
  }
}

// Update the command string inside already-installed hooks (e.g. after volume or mute logic change).
function refreshHookCommands() {
  try {
    const settings = readClaudeSettings();
    const hooks = settings['hooks'] as Record<string, HookGroupRead[]> | undefined;
    if (!hooks) { return; }
    const cmd = buildHookCommand(STABLE_SOUND_PATH);
    for (const { event } of HOOK_CONFIGS) {
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
  const cmd = buildHookCommand(STABLE_SOUND_PATH);

  for (const { event, matcher } of HOOK_CONFIGS) {
    const entry: HookGroup = { matcher, hooks: [{ type: 'command', command: cmd }] };
    const existing = (hooks[event] ?? []) as HookGroup[];
    if (!existing.some((g) => g.hooks?.some((h) => h.command?.includes(HOOK_MARKER)))) {
      existing.push(entry);
      hooks[event] = existing;
    }
  }

  settings['hooks'] = hooks;
  writeClaudeSettings(settings);
  outputChannel.appendLine('[hook] Claude Code Stop + Notification + PreToolUse(Bash) hooks installed.');
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

  // Migrate existing hooks to the latest command format (adds mute-flag check).
  if (isHookInstalled()) {
    refreshHookCommands();
  }

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
        '• Notification hook → plays when Claude sends a background notification',
        '• PreToolUse hook  → plays when Claude is about to run a Bash command',
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
      // Volume changes need a re-sync so the hook file gets re-scaled with the new amplitude.
      // Sounds/soundMode are NOT synced here — chooseSounds and addSound pass the explicit path
      // directly to syncHookSound to avoid reading config that may not have settled yet.
      if (e.affectsConfiguration('agentConfirmSound.volume') && isHookInstalled()) {
        syncHookSound(context);
        refreshHookCommands();
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      lastTriggerAt.delete(terminal);
      commandStartAt.delete(terminal);
    }),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      commandStartAt.set(event.terminal, Date.now());
      watchExecution(context, event.terminal, event.execution);
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      if (!watching) { return; }
      if (!getConfig().get<boolean>('alertOnCommandEnd', true)) { return; }
      if (!terminalPassesNameFilter(event.terminal)) { return; }

      const started = commandStartAt.get(event.terminal);
      commandStartAt.delete(event.terminal);
      if (started === undefined) { return; }  // command started before extension was active
      const elapsed = Date.now() - started;
      const minMs = getConfig().get<number>('commandEndMinDurationMs', 3000);
      if (elapsed < minMs) { return; }

      const debounceMs = getConfig().get<number>('debounceMs', 4000);
      const now = Date.now();
      if ((lastTriggerAt.get(event.terminal) ?? 0) + debounceMs > now) { return; }
      lastTriggerAt.set(event.terminal, now);

      const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const exit = event.exitCode;
      outputChannel.appendLine(`[done] "${event.terminal.name}" finished in ${Math.round(elapsed / 1000)}s (exit ${exit ?? '?'})`);

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
      if (!uris || uris.length === 0) { return; }

      const current = getConfig().get<string[]>('sounds', []);
      const added = uris.map((u) => u.fsPath).filter((p) => !current.includes(p));
      if (added.length === 0) {
        vscode.window.showInformationMessage('Agent Bell: those files are already in the list.');
        return;
      }

      // Add to list
      const updated = [...current, ...added];
      await getConfig().update('sounds', updated, vscode.ConfigurationTarget.Global);

      // Ask if they want to activate the first added sound
      const activate = await vscode.window.showInformationMessage(
        `Added: ${added.map((p) => path.basename(p)).join(', ')}`,
        'Use this sound now', 'Keep current'
      );
      if (activate === 'Use this sound now') {
        // Move new sound to front, switch to fixed mode
        const withNew = [added[0], ...updated.filter((s) => s !== added[0])];
        await getConfig().update('sounds', withNew, vscode.ConfigurationTarget.Global);
        await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
        if (isHookInstalled()) { syncHookSound(context, added[0]); }
        vscode.window.showInformationMessage(`Agent Bell: now using ${path.basename(added[0])}.`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.chooseSounds', async () => {
      // Loop so the menu re-opens after each action (shows updated state)
      while (true) {
        const sounds = getConfig().get<string[]>('sounds', []);
        const mode = getConfig().get<string>('soundMode', 'fixed');
        const volume = getConfig().get<number>('volume', 1);
        const isRandom = mode === 'random';
        const isBundledActive = !isRandom && sounds.length === 0;

        const items: vscode.QuickPickItem[] = [];

        // ── Sounds ──────────────────────────────────────────────────────────
        items.push({
          label: isBundledActive ? '$(check) Bundled  (default)' : '$(file-media) Bundled  (default)',
          description: 'notify.wav included with Agent Bell',
          detail: isBundledActive ? 'Active' : 'Click to switch to this sound',
        });

        for (let i = 0; i < sounds.length; i++) {
          const isActive = !isRandom && i === 0;
          items.push({
            label: isActive ? `$(check) ${path.basename(sounds[i])}` : `$(file-media) ${path.basename(sounds[i])}`,
            description: sounds[i],
            detail: isActive ? 'Active — click to preview or remove' : 'Click to make this the active sound',
          });
        }

        // ── Actions ──────────────────────────────────────────────────────────
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
          label: '$(add) Add sound file…',
          description: 'Browse for .wav / .mp3 / .aiff',
        });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
          label: `$(unmute) Volume: ${Math.round(volume * 100)}%`,
          description: os.platform() === 'win32'
            ? 'Works on macOS / Linux — Windows uses system volume'
            : 'Click to change',
        });
        items.push({
          label: isRandom ? '$(check) Random mode: On' : '$(circle-slash) Random mode: Off',
          description: isRandom
            ? 'Picks a random sound each time — click to use fixed'
            : 'Always plays the active sound — click to randomise',
        });

        const pick = await vscode.window.showQuickPick(items, {
          title: 'Agent Bell — Sounds',
          placeHolder: 'Click a sound to activate it, or choose an action',
        });

        if (!pick) { return; }

        // ── Add sound ────────────────────────────────────────────────────────
        if (pick.label.includes('Add sound file')) {
          await vscode.commands.executeCommand('agentConfirmSound.addSound');
          continue;
        }

        // ── Volume ───────────────────────────────────────────────────────────
        if (pick.label.includes('Volume:')) {
          const volPick = await vscode.window.showQuickPick(
            [
              { label: '25%' }, { label: '50%' }, { label: '75%' }, { label: '100%' },
              { label: 'Custom…', description: 'Enter any value 0–100' },
            ],
            { title: `Agent Bell — Volume  (current: ${Math.round(volume * 100)}%)` }
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
          vscode.window.showInformationMessage(`Agent Bell: volume set to ${Math.round(newVol * 100)}%.`);
          continue;
        }

        // ── Random mode toggle ────────────────────────────────────────────────
        if (pick.label.includes('Random mode')) {
          const newMode = isRandom ? 'fixed' : 'random';
          await getConfig().update('soundMode', newMode, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(
            newMode === 'random'
              ? 'Agent Bell: random mode on — will shuffle through all sounds.'
              : 'Agent Bell: fixed mode — will play the active sound every time.'
          );
          continue;
        }

        // ── Sound clicked ─────────────────────────────────────────────────────
        const isBundled = pick.description === 'notify.wav included with Agent Bell';

        if (isBundled) {
          if (!isBundledActive) {
            // Switch to bundled: clear the list
            await getConfig().update('sounds', [], vscode.ConfigurationTarget.Global);
            await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
            if (isHookInstalled()) {
              syncHookSound(context, path.join(context.extensionPath, 'media', 'notify.wav'));
            }
            vscode.window.showInformationMessage('Agent Bell: switched to bundled sound.');
          }
          return;
        }

        // Custom sound
        const soundPath = pick.description!;
        const isActive = !isRandom && sounds[0] === soundPath;

        if (isActive) {
          // Active sound: offer preview or remove
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
            vscode.window.showInformationMessage(`Agent Bell: removed ${path.basename(soundPath)}.`);
          }
        } else {
          // Inactive sound: make it active (move to front)
          const reordered = [soundPath, ...sounds.filter((s) => s !== soundPath)];
          await getConfig().update('sounds', reordered, vscode.ConfigurationTarget.Global);
          await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
          if (isHookInstalled()) { syncHookSound(context, soundPath); }
          vscode.window.showInformationMessage(`Agent Bell: now using ${path.basename(soundPath)}.`);
        }
        continue;
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

  if (!vscode.window.state.focused) {
    showOsNotification(`"${terminal.name}" needs your attention`);
  }
}

export function deactivate() {
  if (flashTimer) { clearTimeout(flashTimer); }
  lastTriggerAt.clear();
  // Remove mute flag so hooks work if extension is unloaded/uninstalled
  try { if (fs.existsSync(MUTE_FLAG_PATH)) { fs.unlinkSync(MUTE_FLAG_PATH); } } catch { /* ignore */ }
}

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { getConfig, getAlertOn, MUTE_FLAG_PATH, STABLE_SOUND_PATH } from './config';
import { initLogger, log } from './logger';
import { initHistory, addAlert, alertHistory, clearHistory, relativeTime } from './history';
import { initStatusBar, updateStatusBar, flashStatusBar, setWatching, getWatching, setMutedNames } from './statusBar';
import { initReminder, clearReminder, hasActiveReminder, getReminderTerminal } from './reminder';
import { playSound, pickSoundFile, triggerSound, BUILTIN_SOUNDS, resolveBuiltinSound } from './sound';
import { showOsNotification } from './notifications';
import {
  isHookInstalled, installClaudeHook, removeClaudeHook,
  syncHookSound, refreshHookCommands, setupHookSignalWatcher, teardownHookSignalWatcher,
} from './hooks';
import {
  getPatterns, terminalPassesNameFilter, invalidatePatternCache, stripAnsi,
  watchExecution, lastTriggerAt, commandStartAt, executionControllers, mutedTerminals,
} from './terminal';
import { SettingsViewProvider } from './panel';

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Notification Bell');
  initLogger(outputChannel);

  initHistory(ctx, updateStatusBar);
  initReminder(ctx);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.command = 'agentConfirmSound.showHistory';
  statusBarItem.show();
  initStatusBar(statusBarItem);

  const gearItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -101);
  gearItem.text = '$(gear)';
  gearItem.command = 'agentConfirmSound.openPanel';
  gearItem.tooltip = 'Notification Bell — Open Settings Panel';
  gearItem.show();
  ctx.subscriptions.push(gearItem);

  setWatching(getConfig().get<boolean>('enabled', true));

  if (isHookInstalled()) {
    syncHookSound(ctx);   // must run before refreshHookCommands to set _hookSoundPath
    refreshHookCommands();
    setupHookSignalWatcher();
  }

  // Ask once if the user hasn't decided about Claude Code integration.
  const hookDecision = ctx.globalState.get<string>('hookDecision');
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
        `   ${path.join(os.homedir(), '.claude', 'settings.json')}`,
        '',
        '• Stop hook        → plays when Claude finishes its turn',
        '• Notification hook → plays when Claude sends a background notification',
        '',
        'Nothing is sent externally. Fully reversible via:',
        '"Notification Bell: Remove Claude Code Integration"',
      ].join('\n'),
      { modal: true },
      'Set it up', 'Not now'
    ).then(async (choice) => {
      if (choice === 'Set it up') {
        try {
          await installClaudeHook(ctx);
          vscode.window.showInformationMessage("Notification Bell: Claude Code integration ready. You'll hear a sound when Claude finishes or needs your input.");
        } catch (e) {
          vscode.window.showErrorMessage(`Notification Bell: failed to install hook — ${e}`);
        }
      } else if (choice === 'Not now') {
        await ctx.globalState.update('hookDecision', 'declined');
      }
    });
  }

  ctx.subscriptions.push(
    outputChannel,
    statusBarItem,
    { dispose: teardownHookSignalWatcher },

    // ─── Config change handlers ────────────────────────────────────────────────
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentConfirmSound.patterns')) {
        invalidatePatternCache();
        log('[info] pattern cache cleared.');
      }
      if (e.affectsConfiguration('agentConfirmSound.enabled')) {
        setWatching(getConfig().get<boolean>('enabled', true));
      }
      if (
        (e.affectsConfiguration('agentConfirmSound.volume') ||
         e.affectsConfiguration('agentConfirmSound.sounds') ||
         e.affectsConfiguration('agentConfirmSound.soundMode')) &&
        isHookInstalled()
      ) {
        syncHookSound(ctx);
        refreshHookCommands();
      }
      if (e.affectsConfiguration('agentConfirmSound.hookPreToolUse') && isHookInstalled()) {
        refreshHookCommands();
      }
    }),

    // ─── Terminal lifecycle ────────────────────────────────────────────────────
    vscode.window.onDidCloseTerminal((terminal) => {
      lastTriggerAt.delete(terminal);
      commandStartAt.delete(terminal);
      const ac = executionControllers.get(terminal);
      if (ac) { ac.abort(); executionControllers.delete(terminal); }
      if (mutedTerminals.delete(terminal)) {
        setMutedNames([...mutedTerminals].map((t) => t.name));
        updateStatusBar();
      }
    }),
    vscode.window.onDidStartTerminalShellExecution((event) => {
      commandStartAt.set(event.terminal, Date.now());
      if (getReminderTerminal() === event.terminal) { clearReminder(); }
      if (getWatching() && getConfig().get<boolean>('soundOnCommandStart', false) && terminalPassesNameFilter(event.terminal)) {
        triggerSound(ctx);
      }
      if (getAlertOn().includes('confirmation') && getPatterns().length > 0 && terminalPassesNameFilter(event.terminal)) {
        const prev = executionControllers.get(event.terminal);
        if (prev) { prev.abort(); }
        const ac = new AbortController();
        executionControllers.set(event.terminal, ac);
        watchExecution(ctx, event.terminal, event.execution, ac.signal);
      }
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      if (!getWatching()) { return; }
      if (mutedTerminals.has(event.terminal)) { return; }
      if (!getAlertOn().includes('completion')) { return; }
      if (!getConfig().get<boolean>('alertOnCommandEnd', true)) { return; }
      if (!terminalPassesNameFilter(event.terminal)) { return; }

      const now     = Date.now();
      const started = commandStartAt.get(event.terminal);
      commandStartAt.delete(event.terminal);
      if (started === undefined) { return; }

      const elapsed = now - started;
      const minMs   = getConfig().get<number>('commandEndMinDurationMs', 3000);
      if (elapsed < minMs) { return; }

      const lastTrigger = lastTriggerAt.get(event.terminal) ?? 0;
      if (lastTrigger >= started) { return; }  // pattern alert already fired this command

      const debounceMs = getConfig().get<number>('debounceMs', 4000);
      if (lastTrigger + debounceMs > now) { return; }
      lastTriggerAt.set(event.terminal, now);

      const timeLabel  = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const exit       = event.exitCode;
      const elapsedStr = `finished in ${Math.round(elapsed / 1000)}s`;
      log(`[done] "${event.terminal.name}" ${elapsedStr} (exit ${exit ?? '?'})`);
      addAlert({ ts: now, source: event.terminal.name, type: 'command-end', detail: `${elapsedStr} (exit ${exit ?? '?'})` });

      if (getConfig().get<boolean>('focusTerminal', false)) { event.terminal.show(true); }
      flashStatusBar(timeLabel);
      triggerSound(ctx);

      if (!vscode.window.state.focused) {
        const label = exit !== undefined && exit !== 0
          ? `"${event.terminal.name}" failed (exit ${exit})`
          : `"${event.terminal.name}" finished`;
        showOsNotification(label);
      }
    }),

    // ─── Commands ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('agentConfirmSound.toggle', () => {
      setWatching(!getWatching());
      if (!getWatching()) { clearReminder(); }
    }),
    vscode.commands.registerCommand('agentConfirmSound.muteTerminal', () => {
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        vscode.window.showWarningMessage('Notification Bell: no active terminal to mute.');
        return;
      }
      mutedTerminals.add(terminal);
      if (getReminderTerminal() === terminal) { clearReminder(); }
      setMutedNames([...mutedTerminals].map((t) => t.name));
      updateStatusBar();
      log(`[info] muted terminal: "${terminal.name}"`);
      vscode.window.showInformationMessage(`Notification Bell: alerts muted for "${terminal.name}". Use "Unmute This Terminal" to restore.`);
    }),
    vscode.commands.registerCommand('agentConfirmSound.unmuteTerminal', () => {
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        vscode.window.showWarningMessage('Notification Bell: no active terminal to unmute.');
        return;
      }
      if (!mutedTerminals.has(terminal)) {
        vscode.window.showInformationMessage(`Notification Bell: "${terminal.name}" is not muted.`);
        return;
      }
      mutedTerminals.delete(terminal);
      setMutedNames([...mutedTerminals].map((t) => t.name));
      updateStatusBar();
      log(`[info] unmuted terminal: "${terminal.name}"`);
      vscode.window.showInformationMessage(`Notification Bell: alerts restored for "${terminal.name}".`);
    }),
    vscode.commands.registerCommand('agentConfirmSound.testSound', () => {
      const file = pickSoundFile(ctx);
      log(`[info] test sound → ${path.basename(file)}`);
      flashStatusBar('test');
      playSound(file);
    }),
    vscode.commands.registerCommand('agentConfirmSound.showLog', () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand('agentConfirmSound.dismissReminder', () => {
      if (!hasActiveReminder()) {
        vscode.window.showInformationMessage('No active reminder.');
        return;
      }
      clearReminder();
      vscode.window.showInformationMessage('Reminder dismissed.');
    }),
    vscode.commands.registerCommand('agentConfirmSound.setupClaudeHook', async () => {
      if (isHookInstalled()) {
        vscode.window.showInformationMessage('Notification Bell: Claude Code hook is already installed.');
        return;
      }
      try {
        await installClaudeHook(ctx);
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
        await removeClaudeHook(ctx);
        vscode.window.showInformationMessage('Notification Bell: Claude Code hook removed. Safe to uninstall the extension now.');
      } catch (e) {
        vscode.window.showErrorMessage(`Notification Bell: failed to remove hook — ${e}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.testPattern', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Paste a line of terminal output to test against your patterns',
        placeHolder: 'e.g. Allow this action? (y/n)',
      });
      if (input === undefined) { return; }
      const clean   = stripAnsi(input);
      const matched = getPatterns().find((re) => re.test(clean));
      if (matched) {
        log(`[test] ✅ MATCH — pattern: ${matched}`);
        outputChannel.show();
        await vscode.env.clipboard.writeText(matched.source);
        vscode.window.showInformationMessage(`Notification Bell: matched — ${matched}  (copied to clipboard)`);
      } else {
        log(`[test] ❌ no match for: ${clean}`);
        outputChannel.show();
        vscode.window.showWarningMessage('Notification Bell: no pattern matched. Check the log and adjust your patterns.');
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.resetDefaults', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all Notification Bell settings to defaults?',
        { modal: true, detail: 'This will reset all Notification Bell settings to their defaults. Continue?' },
        'Reset'
      );
      if (confirm !== 'Reset') { return; }
      const config = vscode.workspace.getConfiguration();
      const keys = [
        'agentConfirmSound.enabled', 'agentConfirmSound.alertOn', 'agentConfirmSound.patterns',
        'agentConfirmSound.terminalNameFilter', 'agentConfirmSound.debounceMs', 'agentConfirmSound.volume',
        'agentConfirmSound.sounds', 'agentConfirmSound.soundMode', 'agentConfirmSound.focusTerminal',
        'agentConfirmSound.alertOnCommandEnd', 'agentConfirmSound.commandEndMinDurationMs',
        'agentConfirmSound.osNotification', 'agentConfirmSound.hookPreToolUse',
        'agentConfirmSound.muteWhenFocused', 'agentConfirmSound.focusMode',
        'agentConfirmSound.reminderIntervalMs', 'agentConfirmSound.reminderMaxCount',
        'agentConfirmSound.debugLog', 'agentConfirmSound.soundOnCommandStart',
      ];
      for (const key of keys) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage('Notification Bell: settings reset to defaults.');
    }),
    vscode.commands.registerCommand('agentConfirmSound.configureAlertTriggers', async () => {
      const current = getAlertOn();
      type TriggerItem = vscode.QuickPickItem & { value: string };
      const items: TriggerItem[] = [
        { label: '$(bell) Confirmation prompts', description: 'Alert when your agent asks y/n, needs approval, or waits for input', picked: current.includes('confirmation'), value: 'confirmation' },
        { label: '$(check) Task completed',      description: 'Alert when a long-running command or agent turn finishes',           picked: current.includes('completion'),   value: 'completion' },
      ];
      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: 'Notification Bell — When should alerts fire?',
        placeHolder: 'Space to toggle, Enter to confirm',
      });
      if (selected === undefined) { return; }
      if (selected.length === 0) {
        const ok = await vscode.window.showWarningMessage(
          'No triggers selected — Notification Bell will never alert. Are you sure?',
          'Disable all', 'Cancel'
        );
        if (ok !== 'Disable all') { return; }
      }
      type ScopeItem = vscode.QuickPickItem & { value: vscode.ConfigurationTarget };
      const scope = await vscode.window.showQuickPick<ScopeItem>([
        { label: 'All workspaces (global)', value: vscode.ConfigurationTarget.Global },
        { label: 'This workspace only',     value: vscode.ConfigurationTarget.Workspace },
      ], { title: 'Apply to…' });
      if (scope === undefined) { return; }
      const newValue = (selected as TriggerItem[]).map((i) => i.value);
      await getConfig().update('alertOn', newValue, scope.value);
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
      const added   = uris.map((u) => u.fsPath).filter((p) => !current.includes(p));
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
        await getConfig().update('activeSoundId', 'custom', vscode.ConfigurationTarget.Global);
        await getConfig().update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
        if (isHookInstalled()) { syncHookSound(ctx, added[0]); }
        vscode.window.showInformationMessage(`Notification Bell: now using ${path.basename(added[0])}.`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.chooseSounds', async () => {
      while (true) {
        const cfg           = getConfig();
        const activeSoundId = cfg.get<string>('activeSoundId', 'notify');
        const sounds        = cfg.get<string[]>('sounds', []).filter((s) => s.trim().length > 0);
        const mode          = cfg.get<string>('soundMode', 'fixed');
        const volume        = cfg.get<number>('volume', 1);
        const isRandom      = mode === 'random';

        // ── Built-in sounds section ──────────────────────────────────────────
        const items: vscode.QuickPickItem[] = [
          { label: 'Built-in sounds', kind: vscode.QuickPickItemKind.Separator },
        ];
        for (const entry of BUILTIN_SOUNDS) {
          const available = resolveBuiltinSound(ctx, entry.id) !== undefined;
          const isActive  = !isRandom && activeSoundId === entry.id;
          items.push({
            label: isActive
              ? `$(check) ${entry.label}`
              : available ? `$(file-media) ${entry.label}` : `$(circle-slash) ${entry.label}`,
            description: entry.description,
            detail: isActive
              ? 'Active — click to preview'
              : available ? 'Click to use this sound' : 'Coming soon — drop the file into media/ to enable',
          });
        }

        // ── Custom sounds section ────────────────────────────────────────────
        if (sounds.length > 0) {
          items.push({ label: 'Custom sounds', kind: vscode.QuickPickItemKind.Separator });
          for (const s of sounds) {
            const isActive = !isRandom && activeSoundId === 'custom' && sounds[0] === s;
            items.push({
              label: isActive ? `$(check) ${path.basename(s)}` : `$(file-media) ${path.basename(s)}`,
              description: s,
              detail: isActive ? 'Active — click to preview or remove' : 'Click to make this the active sound',
            });
          }
        }

        // ── Actions ──────────────────────────────────────────────────────────
        items.push(
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(add) Add custom sound file…', description: 'Browse for .wav / .mp3 / .aiff / .ogg / .flac' },
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: `$(unmute) Volume: ${Math.round(volume * 100)}%`, description: 'Click to change' },
          {
            label: isRandom ? '$(check) Random mode: On' : '$(circle-slash) Random mode: Off',
            description: isRandom
              ? 'Picks a random sound each time — click to use fixed'
              : 'Always plays the active sound — click to randomise',
          },
        );

        const pick = await vscode.window.showQuickPick(items, {
          title: 'Notification Bell — Sounds',
          placeHolder: 'Pick a sound or choose an action',
        });
        if (!pick) { return; }

        // ── Handle actions ───────────────────────────────────────────────────
        if (pick.label.includes('Add custom sound file')) {
          await vscode.commands.executeCommand('agentConfirmSound.addSound');
          continue;
        }

        if (pick.label.includes('Volume:')) {
          const volPick = await vscode.window.showQuickPick(
            [
              { label: '25%' }, { label: '50%' }, { label: '75%' }, { label: '100%' },
              { label: '150%', description: 'Digital amplification' },
              { label: '200%', description: 'Digital amplification — may clip loud files' },
              { label: 'Custom…', description: 'Enter any value 0–200' },
            ],
            { title: `Notification Bell — Volume  (current: ${Math.round(volume * 100)}%)` }
          );
          if (!volPick) { continue; }
          let newVol: number;
          if (volPick.label === 'Custom…') {
            const input = await vscode.window.showInputBox({
              prompt: 'Volume (0 = silent, 100 = full, up to 200 for amplification)',
              value: String(Math.round(volume * 100)),
              validateInput: (v) => {
                const n = parseInt(v, 10);
                return isNaN(n) || n < 0 || n > 200 ? 'Enter a number from 0 to 200' : undefined;
              },
            });
            if (input === undefined) { continue; }
            newVol = parseInt(input, 10) / 100;
          } else {
            newVol = parseInt(volPick.label, 10) / 100;
          }
          await cfg.update('volume', newVol, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(`Notification Bell: volume set to ${Math.round(newVol * 100)}%.`);
          continue;
        }

        if (pick.label.includes('Random mode')) {
          const newMode = isRandom ? 'fixed' : 'random';
          await cfg.update('soundMode', newMode, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage(
            newMode === 'random'
              ? 'Notification Bell: random mode on — will shuffle through all sounds.'
              : 'Notification Bell: fixed mode — will play the active sound every time.'
          );
          continue;
        }

        // ── Handle built-in selection ────────────────────────────────────────
        const matchedBuiltin = BUILTIN_SOUNDS.find(
          (e) => pick.label.replace(/^\$\(\S+\) /, '') === e.label
        );
        if (matchedBuiltin) {
          const resolvedPath = resolveBuiltinSound(ctx, matchedBuiltin.id);
          if (!resolvedPath) {
            vscode.window.showInformationMessage(
              `Notification Bell: "${matchedBuiltin.label}" isn't bundled yet — drop ${matchedBuiltin.file} into the media/ folder to enable it.`
            );
            continue;
          }
          if (!isRandom && activeSoundId === matchedBuiltin.id) {
            playSound(resolvedPath);
            continue;
          }
          await cfg.update('activeSoundId', matchedBuiltin.id, vscode.ConfigurationTarget.Global);
          await cfg.update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
          if (isHookInstalled()) { syncHookSound(ctx, resolvedPath); }
          vscode.window.showInformationMessage(`Notification Bell: now using ${matchedBuiltin.label}.`);
          continue;
        }

        // ── Handle custom sound selection ────────────────────────────────────
        const soundPath = pick.description!;
        const isActive  = !isRandom && activeSoundId === 'custom' && sounds[0] === soundPath;
        if (isActive) {
          const action = await vscode.window.showQuickPick(
            [
              { label: '$(play) Preview', description: path.basename(soundPath) },
              { label: '$(trash) Remove from list', description: path.basename(soundPath) },
            ],
            { title: path.basename(soundPath) }
          );
          if (!action) { continue; }
          if (action.label.includes('Preview')) {
            playSound(soundPath);
          } else if (action.label.includes('Remove')) {
            const updated2 = sounds.filter((s) => s !== soundPath);
            await cfg.update('sounds', updated2, vscode.ConfigurationTarget.Global);
            if (updated2.length === 0) {
              await cfg.update('activeSoundId', 'notify', vscode.ConfigurationTarget.Global);
            }
            vscode.window.showInformationMessage(`Notification Bell: removed ${path.basename(soundPath)}.`);
          }
        } else {
          const reordered = [soundPath, ...sounds.filter((s) => s !== soundPath)];
          await cfg.update('sounds', reordered, vscode.ConfigurationTarget.Global);
          await cfg.update('activeSoundId', 'custom', vscode.ConfigurationTarget.Global);
          await cfg.update('soundMode', 'fixed', vscode.ConfigurationTarget.Global);
          if (isHookInstalled()) { syncHookSound(ctx, soundPath); }
          vscode.window.showInformationMessage(`Notification Bell: now using ${path.basename(soundPath)}.`);
        }
        continue;
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.showHistory', async () => {
      if (alertHistory.length === 0) {
        vscode.window.showInformationMessage('Notification Bell: no alerts recorded yet.');
        return;
      }

      const HOOK_EVENT_LABELS: Record<string, string> = {
        Stop:        'Claude finished — ready for your next message',
        Notification: 'Claude sent a notification',
        PreToolUse:  'Claude is waiting for bash approval',
      };

      const buildItems = (): vscode.QuickPickItem[] => {
        const rows: vscode.QuickPickItem[] = alertHistory.map((r): vscode.QuickPickItem => {
          const absTime = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          let icon = r.type === 'hook' ? '$(cloud)' : '$(bell)';
          let summary: string;
          let copyText: string;
          if (r.type === 'hook') {
            summary  = `Claude Code — ${r.detail}`;
            copyText = HOOK_EVENT_LABELS[r.detail] ?? r.detail;
          } else if (r.type === 'command-end') {
            const exitMatch = r.detail.match(/exit (\d+|\?)/);
            const exitCode  = exitMatch ? exitMatch[1] : null;
            const failed    = exitCode !== null && exitCode !== '0' && exitCode !== '?';
            const unknown   = exitCode === '?';
            icon     = failed ? '$(error)' : unknown ? '$(warning)' : '$(check)';
            summary  = `Command ${failed ? 'failed' : unknown ? 'ended' : 'done'} — ${r.source}`;
            copyText = r.detail;
          } else {
            summary  = `Pattern match — ${r.source}`;
            copyText = r.detail;
          }
          return {
            label: `${icon}  ${summary}`,
            description: `${relativeTime(r.ts)} · ${absTime}`,
            detail: copyText,
          };
        });
        rows.push(
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(trash) Clear history', description: `${alertHistory.length} alert${alertHistory.length === 1 ? '' : 's'}` }
        );
        return rows;
      };

      const pick = await vscode.window.showQuickPick(buildItems(), {
        title: `Notification Bell — Alert History  (${alertHistory.length})`,
        placeHolder: 'Select an alert to copy its detail · Clear history at the bottom',
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!pick) { return; }

      if (pick.label.includes('Clear history')) {
        clearHistory();
        vscode.window.showInformationMessage('Notification Bell: history cleared.');
        return;
      }

      if (pick.detail) {
        await vscode.env.clipboard.writeText(pick.detail);
        vscode.window.showInformationMessage(`Notification Bell: copied — ${pick.detail}`);
      }
    }),
    vscode.commands.registerCommand('agentConfirmSound.openPanel', () => {
      vscode.commands.executeCommand('agentConfirmSound.settingsView.focus');
    }),
  );

  const settingsProvider = new SettingsViewProvider(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentConfirmSound')) { settingsProvider.refresh(); }
    })
  );

  log(`[info] Notification Bell ${ctx.extension.packageJSON.version} activated. Watching: ${getWatching()}`);
  log(`[info] Claude Code hook: ${isHookInstalled() ? 'installed' : 'not installed'}`);
  log(`[info] Sound mode: ${getConfig().get('soundMode', 'fixed')} | Sounds: ${getConfig().get<string[]>('sounds', []).length} custom`);
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate() {
  for (const ac of executionControllers.values()) { ac.abort(); }
  executionControllers.clear();
  lastTriggerAt.clear();
  commandStartAt.clear();
  mutedTerminals.clear();
  clearReminder();
  teardownHookSignalWatcher();
  try { if (fs.existsSync(MUTE_FLAG_PATH)) { fs.unlinkSync(MUTE_FLAG_PATH); } } catch { /* ignore */ }
}

import * as vscode from 'vscode';
import * as path from 'node:path';
import { getConfig, getAlertOn } from './config';
import { log } from './logger';
import { getWatching } from './statusBar';
import { pickSoundFile, triggerSound } from './sound';
import { isHookInstalled } from './hooks';

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'agentConfirmSound.settingsView';
  private _view?: vscode.WebviewView;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildPanelHtml(this.ctx);

    view.onDidChangeVisibility(() => {
      if (view.visible) { view.webview.html = buildPanelHtml(this.ctx); }
    });

    view.webview.onDidReceiveMessage(async (msg) => {
      const cfg = getConfig();
      switch (msg.command) {
        case 'setEnabled':
          await cfg.update('enabled', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setVolume':
          await cfg.update('volume', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setMuteWhenFocused':
          await cfg.update('muteWhenFocused', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setFocusMode':
          await cfg.update('focusMode', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setOsNotification':
          await cfg.update('osNotification', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setFocusTerminal':
          await cfg.update('focusTerminal', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setDebugLog':
          await cfg.update('debugLog', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setAlertOnConfirmation': {
          const cur = cfg.get<string[]>('alertOn', ['confirmation', 'completion']);
          const next = msg.value
            ? [...new Set([...cur, 'confirmation'])]
            : cur.filter((v: string) => v !== 'confirmation');
          await cfg.update('alertOn', next, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        }
        case 'setAlertOnCompletion': {
          const cur = cfg.get<string[]>('alertOn', ['confirmation', 'completion']);
          const next = msg.value
            ? [...new Set([...cur, 'completion'])]
            : cur.filter((v: string) => v !== 'completion');
          await cfg.update('alertOn', next, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        }
        case 'setAlertOnCommandEnd':
          await cfg.update('alertOnCommandEnd', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setMinDuration':
          await cfg.update('commandEndMinDurationMs', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setHookPreToolUse':
          await cfg.update('hookPreToolUse', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setSoundOnCommandStart':
          await cfg.update('soundOnCommandStart', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setReminderInterval':
          await cfg.update('reminderIntervalMs', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setReminderMax':
          await cfg.update('reminderMaxCount', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setDebounce':
          await cfg.update('debounceMs', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'previewSound':
          triggerSound(this.ctx);
          break;
        case 'manageSounds':
          vscode.commands.executeCommand('agentConfirmSound.chooseSounds');
          break;
        case 'setupHook':
          await vscode.commands.executeCommand('agentConfirmSound.setupClaudeHook');
          this.refresh();
          break;
        case 'removeHook':
          await vscode.commands.executeCommand('agentConfirmSound.removeClaudeHook');
          this.refresh();
          break;
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'agentConfirmSound');
          break;
      }
    }, undefined, this.ctx.subscriptions);
  }

  refresh() {
    if (this._view?.visible) { this._view.webview.html = buildPanelHtml(this.ctx); }
  }
}

function pill(label: string, active: boolean, cmd: string, arg: unknown, small = false): string {
  const cls = `pill${small ? ' pill-sm' : ''}${active ? ' active' : ''}`;
  return `<button class="${cls}" onclick="send('${cmd}',${JSON.stringify(arg)})">${active ? '✓ ' : ''}${label}</button>`;
}

function toggleRow(label: string, tip: string, cmd: string, value: boolean): string {
  return `<div class="row">
    <span class="row-label">${label}</span>
    <span class="info" data-tip="${tip}">!</span>
    <input type="checkbox" class="toggle" ${value ? 'checked' : ''} onchange="send('${cmd}', this.checked)">
    <span class="val-label">${value ? 'On' : 'Off'}</span>
  </div>`;
}

function buildConfirmRow(on: boolean): string {
  const chk = on ? 'checked' : '';
  const val = on ? 'On' : 'Off';
  return `
<div class="event-row">
  <span class="event-icon">❓</span>
  <span class="event-label">Confirmation prompt</span>
  <span class="info" data-tip="Sound + notification when your agent asks y/n, needs approval, or waits for input. Matched against terminal output in real time using configurable patterns.">!</span>
  <input type="checkbox" class="toggle" ${chk} onchange="send('setAlertOnConfirmation', this.checked)">
  <span class="val-label">${val}</span>
</div>`;
}

function buildTaskRow(completionOn: boolean, alertOnCommandEnd: boolean, minDurPills: string): string {
  const chk    = completionOn ? 'checked' : '';
  const val    = completionOn ? 'On' : 'Off';
  const cmdChk = alertOnCommandEnd ? 'checked' : '';
  const cmdVal = alertOnCommandEnd ? 'On' : 'Off';
  const minSubRow = alertOnCommandEnd
    ? `<div class="sub-row">
  <span class="sub-label">Min duration</span>
  <span class="info" data-tip="Only alert if the command ran longer than this. Ignores quick commands like ls, cd.">!</span>
  ${minDurPills}
</div>`
    : '';
  const completionSubRows = completionOn
    ? `<div class="sub-row">
  <span class="sub-label">Command-end alert</span>
  <span class="info" data-tip="Alert when any terminal command finishes (separate from the Claude Code Stop hook).">!</span>
  <input type="checkbox" class="toggle" ${cmdChk} onchange="send('setAlertOnCommandEnd', this.checked)">
  <span class="val-label">${cmdVal}</span>
</div>${minSubRow}`
    : '';
  return `
<div class="event-row">
  <span class="event-icon">✅</span>
  <span class="event-label">Task completed</span>
  <span class="info" data-tip="Sound when a long-running command or Claude Code agent turn finishes.">!</span>
  <input type="checkbox" class="toggle" ${chk} onchange="send('setAlertOnCompletion', this.checked)">
  <span class="val-label">${val}</span>
</div>${completionSubRows}`;
}

function buildHookRow(hookInstalled: boolean, hookPreToolUse: boolean): string {
  const status      = hookInstalled ? 'Installed' : 'Not installed';
  const btnCmd      = hookInstalled ? 'removeHook' : 'setupHook';
  const btnLabel    = hookInstalled ? '✕ Remove' : '+ Set up';
  const preChk      = hookPreToolUse ? 'checked' : '';
  const preVal      = hookPreToolUse ? 'On' : 'Off';
  const preSubRow   = hookInstalled
    ? `<div class="sub-row">
  <span class="sub-label">PreToolUse (bash)</span>
  <span class="info" data-tip="Also fire before each bash command Claude runs. Enable only if you use manual bash approval — otherwise every command triggers a sound.">!</span>
  <input type="checkbox" class="toggle" ${preChk} onchange="send('setHookPreToolUse', this.checked)">
  <span class="val-label">${preVal}</span>
</div>`
    : '';
  return `
<div class="event-row">
  <span class="event-icon">☁️</span>
  <span class="event-label">Claude Code hook</span>
  <span class="info" data-tip="Installs Stop + Notification hooks into ~/.claude/settings.json. Fires when Claude finishes a turn or sends a background notification.">!</span>
  <span class="val-label" style="flex:1;font-size:0.85em">${status}</span>
  <button class="link-btn" onclick="send('${btnCmd}')">${btnLabel}</button>
</div>${preSubRow}`;
}

function buildEveryCommandRow(on: boolean): string {
  const chk = on ? 'checked' : '';
  const val = on ? 'On' : 'Off';
  return `
<div class="event-row">
  <span class="event-icon">⌨</span>
  <span class="event-label">Every command</span>
  <span class="info" data-tip="Play a sound every time a terminal command starts executing. Lets you hear when Claude Code fires off a bash command. Respects the terminal name filter.">!</span>
  <input type="checkbox" class="toggle" ${chk} onchange="send('setSoundOnCommandStart', this.checked)">
  <span class="val-label">${val}</span>
</div>`;
}

function buildReminderRow(reminderMs: number, reminderPills: string, reminderMaxPills: string): string {
  const maxSubRow = reminderMs > 0
    ? `<div class="sub-row">
  <span class="sub-label">Max repeats</span>
  <span class="info" data-tip="Stop reminding after this many re-alerts.">!</span>
  ${reminderMaxPills}
</div>`
    : '';
  return `
<div class="event-row">
  <span class="event-icon">🔔</span>
  <span class="event-label">Reminder</span>
  <span class="info" data-tip="Re-alert after this interval if the agent is still waiting. Cancelled automatically when you run the next command in that terminal.">!</span>
  ${reminderPills}
</div>${maxSubRow}`;
}

function buildPanelHtml(ctx: vscode.ExtensionContext): string {
  const cfg = getConfig();

  const volume            = cfg.get<number>('volume', 1);
  const volPct            = Math.round(volume * 100);
  const muted             = cfg.get<boolean>('muteWhenFocused', false);
  const focusMode         = cfg.get<boolean>('focusMode', false);
  const osNotification    = cfg.get<boolean>('osNotification', true);
  const focusTerminal     = cfg.get<boolean>('focusTerminal', false);
  const debugLog          = cfg.get<boolean>('debugLog', false);
  const alertOn           = getAlertOn();
  const confirmOn         = alertOn.includes('confirmation');
  const completionOn      = alertOn.includes('completion');
  const alertOnCommandEnd = cfg.get<boolean>('alertOnCommandEnd', true);
  const minDurMs          = cfg.get<number>('commandEndMinDurationMs', 3000);
  const hookInstalled     = isHookInstalled();
  const hookPreToolUse    = cfg.get<boolean>('hookPreToolUse', false);
  const soundOnCmdStart   = cfg.get<boolean>('soundOnCommandStart', false);
  const reminderMs        = cfg.get<number>('reminderIntervalMs', 0);
  const reminderMax       = cfg.get<number>('reminderMaxCount', 3);
  const debounceMs        = cfg.get<number>('debounceMs', 4000);
  const termFilter        = cfg.get<string[]>('terminalNameFilter', []);
  const termFilterLabel   = termFilter.length > 0 ? termFilter.join(', ') : 'All terminals';
  const watching          = getWatching();
  const soundName         = path.basename(pickSoundFile(ctx));

  log(`[panel] refresh — watching:${watching} hook:${hookInstalled} reminder:${reminderMs}ms`);

  // Volume pills — call setVolPill so clicking also moves the slider
  const volPills = [0, 25, 50, 75, 100, 150, 200]
    .map(v => {
      const active = volPct === v;
      const cls = `pill pill-sm${active ? ' active' : ''}`;
      return `<button class="${cls}" onclick="setVolPill(${v / 100})">${active ? '✓ ' : ''}${v}%</button>`;
    })
    .join('');
  const volFill = Math.round(volPct / 2);

  // Min duration pills (inside task completed sub-row)
  const minDurMap: [number, string][] = [[0,'Off'],[1000,'1s'],[3000,'3s'],[5000,'5s'],[10000,'10s'],[30000,'30s']];
  const minDurPills = minDurMap
    .map(([v, lbl]) => pill(lbl, minDurMs === v, 'setMinDuration', v, true))
    .join('');

  // Reminder interval pills
  const reminderMap: [number, string][] = [[0,'Off'],[60000,'1m'],[120000,'2m'],[300000,'5m'],[600000,'10m']];
  const reminderPills = reminderMap
    .map(([v, lbl]) => pill(lbl, reminderMs === v, 'setReminderInterval', v, true))
    .join('');

  // Reminder max pills (only shown when reminder is active)
  const reminderMaxPills = [1, 2, 3, 5]
    .map(v => pill(String(v), reminderMax === v, 'setReminderMax', v, true))
    .join('');

  // Debounce pills
  const debouncePills = ([1000, 2000, 4000, 8000] as const)
    .map(v => pill(v < 1000 ? `${v}ms` : `${v / 1000}s`, debounceMs === v, 'setDebounce', v, true))
    .join('');

  // ── Event rows ──────────────────────────────────────────────────────────────

  const confirmRow    = buildConfirmRow(confirmOn);
  const taskRow       = buildTaskRow(completionOn, alertOnCommandEnd, minDurPills);
  const hookRow       = buildHookRow(hookInstalled, hookPreToolUse);
  const everyCommandRow = buildEveryCommandRow(soundOnCmdStart);
  const reminderRow   = buildReminderRow(reminderMs, reminderPills, reminderMaxPills);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px 24px;
    max-width: 480px;
  }
  h1 { font-size: 1em; font-weight: 600; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${watching ? '#4caf50' : '#f44336'}; }
  .section { margin-bottom: 18px; }
  .section-title { font-weight: 600; font-size: 0.88em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .row-label { font-weight: 500; min-width: 178px; color: var(--vscode-foreground); }
  .val-label { font-size: 0.88em; color: var(--vscode-descriptionForeground); }
  .pill {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #cccccc);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 3px; padding: 2px 8px; font-size: 0.85em; cursor: pointer;
  }
  .pill-sm { font-size: 0.78em; padding: 1px 6px; }
  .pill:hover { background: var(--vscode-button-secondaryHoverBackground, #505050); }
  .pill.active { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
  .link-btn { background: none; border: none; color: var(--vscode-textLink-foreground, #4fc1ff); cursor: pointer; font-size: 0.9em; padding: 0 4px; white-space: nowrap; }
  .link-btn:hover { text-decoration: underline; }
  .toggle {
    appearance: none; width: 32px; height: 16px;
    background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 8px; position: relative; cursor: pointer; transition: background 0.15s; flex-shrink: 0;
  }
  .toggle:checked { background: var(--vscode-button-background, #0e639c); border-color: transparent; }
  .toggle::after { content: ''; position: absolute; width: 12px; height: 12px; background: #fff; border-radius: 50%; top: 1px; left: 1px; transition: transform 0.15s; }
  .toggle:checked::after { transform: translateX(16px); }
  .events-title { font-weight: 600; font-size: 0.88em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .event-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a); flex-wrap: wrap; }
  .event-icon { font-size: 1em; width: 20px; flex-shrink: 0; }
  .event-label { font-weight: 500; flex: 1; }
  .sub-row { display: flex; align-items: center; gap: 6px; padding: 5px 0 5px 28px; border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a); flex-wrap: wrap; }
  .sub-label { font-size: 0.88em; color: var(--vscode-descriptionForeground); min-width: 130px; }
  .sound-chip { font-size: 0.82em; color: var(--vscode-descriptionForeground); background: var(--vscode-input-background,#3c3c3c); border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
  .footer { margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border, #2a2a2a); margin: 14px 0; }
  .vol-row-inner { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  .vol-track { display: flex; align-items: center; gap: 8px; }
  .vol-slider {
    -webkit-appearance: none; appearance: none;
    flex: 1; height: 4px; border-radius: 2px; outline: none; cursor: pointer;
  }
  .vol-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--vscode-button-background, #0e639c);
    cursor: pointer;
    border: 2px solid var(--vscode-editor-background, #1e1e1e);
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    transition: transform 0.1s;
  }
  .vol-slider::-webkit-slider-thumb:hover { transform: scale(1.25); }
  .vol-pct { font-size: 0.88em; font-weight: 600; min-width: 38px; text-align: right; color: var(--vscode-foreground); }
  .vol-pills { display: flex; gap: 4px; flex-wrap: wrap; }
  .info {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff);
    font-size: 0.7em; font-weight: 700; cursor: help; position: relative; flex-shrink: 0; user-select: none;
  }
  .info::after {
    content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 0;
    background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #d4d4d4);
    border: 1px solid var(--vscode-focusBorder, #007acc); border-radius: 6px; padding: 8px 12px;
    font-size: 0.9em; width: max-content; max-width: 240px; white-space: normal; line-height: 1.5;
    pointer-events: none; opacity: 0; transition: opacity 0.2s; z-index: 1000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
  .info:hover::after { opacity: 1; }
</style>
</head>
<body>

<h1>
  <span class="status-dot"></span>
  Notification Bell
  <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
    <input type="checkbox" class="toggle" ${watching ? 'checked' : ''} onchange="send('setEnabled', this.checked)">
    <span class="val-label">${watching ? 'ON' : 'OFF'}</span>
  </span>
</h1>

<!-- ── Sound ── -->
<div class="section">
  <div class="row">
    <span class="row-label">Volume</span>
    <span class="info" data-tip="Scale the alert volume from 0% (silent) to 200%. Values above 100% digitally amplify the signal — may clip very loud source files.">!</span>
    <div class="vol-row-inner">
      <div class="vol-track">
        <input type="range" id="vol-slider" class="vol-slider" min="0" max="200" value="${volPct}"
               style="background:linear-gradient(to right,var(--vscode-button-background,#0e639c) ${volFill}%,var(--vscode-input-background,#3c3c3c) ${volFill}%)"
               oninput="onVolInput(this.value)" onchange="send('setVolume',this.value/100)">
        <span class="vol-pct" id="vol-pct">${volPct}%</span>
      </div>
      <div class="vol-pills">${volPills}</div>
    </div>
  </div>
  <div class="row">
    <span class="row-label">Sound</span>
    <span class="info" data-tip="Active sound file. Add custom .wav/.mp3/.ogg/.flac files or pick from the bundled options.">!</span>
    <span class="sound-chip">${soundName}</span>
    <button class="link-btn" onclick="send('previewSound')">▷ Preview</button>
    <button class="link-btn" onclick="send('manageSounds')">› Change</button>
  </div>
</div>

<hr>

<!-- ── Behavior ── -->
<div class="section">
  <div class="section-title">Behavior</div>
  ${toggleRow('Auto-mute when focused', 'Suppress the alert sound while VS Code is your active window. History and status bar still update.', 'setMuteWhenFocused', muted)}
  ${toggleRow('OS notifications', 'Show a Windows balloon tip / macOS notification banner / Linux notify-send when VS Code is not in focus.', 'setOsNotification', osNotification)}
  ${toggleRow('Focus terminal on alert', 'Bring the matching terminal into view when a confirmation pattern fires.', 'setFocusTerminal', focusTerminal)}
  ${toggleRow('Focus mode', 'Keep the sound but hide OS popup notifications. Useful when you can hear the bell but don\'t want notification spam.', 'setFocusMode', focusMode)}
  <div class="row">
    <span class="row-label">Terminal filter</span>
    <span class="info" data-tip="Only watch terminals whose name contains one of these strings (case-insensitive). Leave empty to watch all terminals. Edit in full settings.">!</span>
    <span class="sound-chip">${termFilterLabel}</span>
    <button class="link-btn" onclick="send('openSettings')">› Change</button>
  </div>
  <div class="row">
    <span class="row-label">Debounce</span>
    <span class="info" data-tip="Minimum time between two alert sounds for the same terminal. Prevents repeated sounds from the same prompt.">!</span>
    ${debouncePills}
  </div>
  ${toggleRow('Debug log', 'Log every terminal chunk to the output channel (after ANSI stripping). Use to tune patterns. Disable when done — it is verbose.', 'setDebugLog', debugLog)}
</div>

<hr>

<!-- ── Events ── -->
<div class="section">
  <div class="events-title">Events</div>
  ${confirmRow}
  ${taskRow}
  ${hookRow}
  ${everyCommandRow}
  ${reminderRow}
</div>

<div class="footer">
  <button class="link-btn" onclick="send('openSettings')">⚙ Open full settings</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function send(command, value) { vscode.postMessage({ command, value }); }

  function updateVolSlider(pct) {
    const fill = Math.round(pct / 2);
    const s = document.getElementById('vol-slider');
    if (s) s.style.background =
      'linear-gradient(to right,var(--vscode-button-background,#0e639c) ' + fill + '%,var(--vscode-input-background,#3c3c3c) ' + fill + '%)';
  }
  function onVolInput(val) {
    const pct = parseInt(val, 10);
    const el = document.getElementById('vol-pct');
    if (el) el.textContent = pct + '%';
    updateVolSlider(pct);
  }
  function setVolPill(val) {
    const pct = Math.round(val * 100);
    const s = document.getElementById('vol-slider');
    if (s) s.value = pct;
    onVolInput(pct);
    send('setVolume', val);
  }
</script>
</body>
</html>`;
}

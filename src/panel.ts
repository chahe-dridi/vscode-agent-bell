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
        case 'setVolume':
          await cfg.update('volume', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setMuteWhenFocused':
          await cfg.update('muteWhenFocused', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setMinDuration':
          await cfg.update('commandEndMinDurationMs', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setFocusMode':
          await cfg.update('focusMode', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'setSoundOnCommandStart':
          await cfg.update('soundOnCommandStart', msg.value, vscode.ConfigurationTarget.Global);
          this.refresh();
          break;
        case 'previewSound':
          triggerSound(this.ctx);
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

function buildPanelHtml(ctx: vscode.ExtensionContext): string {
  const cfg = getConfig();
  const volume      = cfg.get<number>('volume', 1);
  const volPct      = Math.round(volume * 100);
  const minDurMs    = cfg.get<number>('commandEndMinDurationMs', 3000);
  const minDurLabel = minDurMs === 0 ? 'off' : minDurMs < 1000 ? `${minDurMs}ms` : `${minDurMs / 1000}s`;
  const muted       = cfg.get<boolean>('muteWhenFocused', false);
  const focusMode   = cfg.get<boolean>('focusMode', false);
  const alertOn            = getAlertOn();
  const soundName          = path.basename(pickSoundFile(ctx));
  const hookInstalled      = isHookInstalled();
  const watching           = getWatching();
  const soundOnCmdStart    = cfg.get<boolean>('soundOnCommandStart', false);

  const volSteps = [0, 25, 50, 75, 100, 150, 200];
  const volPills = volSteps.map(v => {
    const active = volPct === v;
    return `<button class="pill${active ? ' active' : ''}" onclick="send('setVolume', ${v / 100})">${active ? '✓ ' : ''}${v}%</button>`;
  }).join('');

  const events = [
    { label: 'Confirmation prompt', icon: '❓', enabled: alertOn.includes('confirmation') },
    { label: 'Task completed',      icon: '✅', enabled: alertOn.includes('completion') },
    { label: 'Claude Code hook',    icon: '☁️',  enabled: hookInstalled },
  ];

  const eventRows = [
    ...events.map(e => `
    <div class="event-row">
      <span class="event-icon">${e.icon}</span>
      <span class="event-label">${e.label}</span>
      <span class="event-sound">${e.enabled ? soundName : '<em>disabled</em>'}</span>
      ${e.enabled ? `<button class="link-btn" onclick="send('previewSound')">▷ Preview</button>` : ''}
      <button class="link-btn" onclick="send('openSettings')">› Change</button>
    </div>`),
    `<div class="event-row">
      <span class="event-icon">⌨</span>
      <span class="event-label">Every command</span>
      <span class="info" data-tip="Play a sound every time a terminal command starts. Lets you hear when Claude Code fires off a bash command. Respects the terminal name filter.">!</span>
      <input type="checkbox" class="toggle" ${soundOnCmdStart ? 'checked' : ''} onchange="send('setSoundOnCommandStart', this.checked)">
      <span style="font-size:0.88em;color:var(--vscode-descriptionForeground)">${soundOnCmdStart ? 'On' : 'Off'}</span>
    </div>`,
  ].join('');

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
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${watching ? '#4caf50' : '#f44336'}; }
  .section { margin-bottom: 18px; }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .row-label { font-weight: 600; min-width: 160px; color: var(--vscode-foreground); }
  .pill {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #cccccc);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 3px; padding: 2px 8px; font-size: 0.85em; cursor: pointer;
  }
  .pill:hover { background: var(--vscode-button-secondaryHoverBackground, #505050); }
  .pill.active { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
  .link-btn { background: none; border: none; color: var(--vscode-textLink-foreground, #4fc1ff); cursor: pointer; font-size: 0.9em; padding: 0 4px; }
  .link-btn:hover { text-decoration: underline; }
  .toggle {
    appearance: none; width: 32px; height: 16px;
    background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 8px; position: relative; cursor: pointer; transition: background 0.15s; flex-shrink: 0;
  }
  .toggle:checked { background: var(--vscode-button-background, #0e639c); border-color: transparent; }
  .toggle::after { content: ''; position: absolute; width: 12px; height: 12px; background: #fff; border-radius: 50%; top: 1px; left: 1px; transition: transform 0.15s; }
  .toggle:checked::after { transform: translateX(16px); }
  .events-title { font-weight: 600; margin-bottom: 10px; }
  .event-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a); }
  .event-icon { font-size: 1em; width: 20px; }
  .event-label { font-weight: 500; flex: 1; }
  .event-sound { color: var(--vscode-descriptionForeground, #858585); font-size: 0.88em; }
  .footer { margin-top: 20px; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border, #2a2a2a); margin: 16px 0; }
  .info {
    display: inline-flex; align-items: center; justify-content: center;
    width: 15px; height: 15px; border-radius: 50%;
    background: var(--vscode-descriptionForeground, #666); color: var(--vscode-editor-background, #1e1e1e);
    font-size: 0.65em; font-weight: 800; cursor: help; position: relative; flex-shrink: 0; user-select: none;
  }
  .info::after {
    content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
    background: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545); border-radius: 4px; padding: 6px 10px;
    font-size: 0.85em; width: max-content; max-width: 210px; white-space: normal; line-height: 1.4;
    pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 100;
  }
  .info:hover::after { opacity: 1; }
</style>
</head>
<body>
<h1>
  <span class="status-dot"></span>
  Notification Bell — Sound ${watching ? 'ON' : 'OFF'}
</h1>

<div class="section">
  <div class="row">
    <span class="row-label">Volume:</span>
    <span class="info" data-tip="Scale the alert volume from 0% (silent) to 200%. Values above 100% boost the WAV digitally.">!</span>
    ${volPills}
  </div>
  <div class="row">
    <span class="row-label">Min task duration:</span>
    <span class="info" data-tip="Only alert on command-end if the command ran longer than this. Ignores quick commands like ls or cd.">!</span>
    <span>${minDurLabel}</span>
    <button class="link-btn" onclick="send('openSettings')">Change…</button>
  </div>
  <div class="row">
    <span class="row-label">Auto-mute when focused:</span>
    <span class="info" data-tip="Suppresses the alert sound while VS Code is your active window. History and status bar still update.">!</span>
    <input type="checkbox" class="toggle" ${muted ? 'checked' : ''} onchange="send('setMuteWhenFocused', this.checked)">
    <span style="font-size:0.88em;color:var(--vscode-descriptionForeground)">${muted ? 'On' : 'Off'}</span>
  </div>
  <div class="row">
    <span class="row-label">Focus mode:</span>
    <span class="info" data-tip="Keeps the sound but hides OS popup notifications (Windows balloon, macOS banner). Useful when you can hear the bell but don't want notification spam.">!</span>
    <input type="checkbox" class="toggle" ${focusMode ? 'checked' : ''} onchange="send('setFocusMode', this.checked)">
    <span style="font-size:0.88em;color:var(--vscode-descriptionForeground)">${focusMode ? 'On' : 'Off'}</span>
  </div>
</div>

<hr>

<div class="section">
  <div class="events-title">Events</div>
  ${eventRows}
</div>

<div class="footer">
  <button class="link-btn" style="font-size:0.9em" onclick="send('openSettings')">⚙ Open full settings</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function send(command, value) { vscode.postMessage({ command, value }); }
</script>
</body>
</html>`;
}

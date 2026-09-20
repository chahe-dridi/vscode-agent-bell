import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { getConfig, CLAUDE_DIR, MUTE_FLAG_PATH } from './config';
import { log } from './logger';
import { getSessionAlertCount } from './history';

let _item: vscode.StatusBarItem;
let _flashTimer: ReturnType<typeof setTimeout> | undefined;
let _watching = false;

export function initStatusBar(item: vscode.StatusBarItem) {
  _item = item;
}

export function getWatching() { return _watching; }

export function updateStatusBar() {
  if (_flashTimer) { return; }
  const count = getSessionAlertCount();
  const filter = getConfig().get<string[]>('terminalNameFilter', []);
  const filterLabel = filter.length > 0
    ? `watching: ${filter.join(', ')} only`
    : 'watching all terminals';
  if (!_watching) {
    _item.text = '🔕';
    _item.color = undefined;
    _item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    _item.tooltip = 'Notification Bell — paused (click to view alert history)';
  } else {
    _item.text = count > 99 ? '🔔 99+' : count > 0 ? `🔔 ${count}` : '🔔';
    _item.color = undefined;
    _item.backgroundColor = undefined;
    _item.tooltip = count > 0
      ? `Notification Bell — ${count} alert${count === 1 ? '' : 's'} this session · ${filterLabel}`
      : `Notification Bell — ${filterLabel} (click to view alert history)`;
  }
  _item.show();
}

export function flashStatusBar(label: string) {
  if (_flashTimer) { clearTimeout(_flashTimer); }
  _item.text = `$(bell-dot) Notification Bell: Alert!`;
  _item.color = undefined;
  _item.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  _item.tooltip = `Last alert: ${label}`;
  _item.show();
  _flashTimer = setTimeout(() => {
    _flashTimer = undefined;
    updateStatusBar();
  }, 2000);
}

export function setMuteFlag(muted: boolean) {
  try {
    if (!fs.existsSync(CLAUDE_DIR)) { return; }
    if (muted) {
      fs.writeFileSync(MUTE_FLAG_PATH, '', 'utf8');
    } else if (fs.existsSync(MUTE_FLAG_PATH)) {
      fs.unlinkSync(MUTE_FLAG_PATH);
    }
  } catch { /* ignore */ }
}

export function setWatching(value: boolean) {
  _watching = value;
  updateStatusBar();
  setMuteFlag(!value);
  log(value ? '[info] watching started.' : '[info] watching paused.');
}

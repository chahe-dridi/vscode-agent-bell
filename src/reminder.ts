import * as vscode from 'vscode';
import { getConfig } from './config';
import { log } from './logger';
import { flashStatusBar } from './statusBar';
import { triggerSound } from './sound';
import { showOsNotification } from './notifications';

let _ctx: vscode.ExtensionContext;
let _timer: ReturnType<typeof setTimeout> | undefined;
let _count = 0;
let _source = '';
let _reminderTerminal: vscode.Terminal | undefined;
export function getReminderTerminal() { return _reminderTerminal; }

export function initReminder(ctx: vscode.ExtensionContext) {
  _ctx = ctx;
}

export function scheduleReminder(source: string, terminal?: vscode.Terminal) {
  clearReminder();
  const intervalMs = getConfig().get<number>('reminderIntervalMs', 0);
  const maxCount   = getConfig().get<number>('reminderMaxCount', 3);
  if (intervalMs <= 0 || maxCount <= 0) { return; }
  _source          = source;
  _reminderTerminal = terminal;
  _count           = 0;

  function fire() {
    _count++;
    log(`[reminder] #${_count}/${maxCount} — ${_source}`);
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flashStatusBar(timeLabel);
    triggerSound(_ctx);
    if (!vscode.window.state.focused) {
      showOsNotification(`Still waiting: ${_source}`);
    }
    _timer = _count < maxCount ? setTimeout(fire, intervalMs) : undefined;
  }
  _timer = setTimeout(fire, intervalMs);
}

export function hasActiveReminder() { return _timer !== undefined; }

export function clearReminder() {
  if (_timer) { clearTimeout(_timer); _timer = undefined; }
  _source           = '';
  _reminderTerminal = undefined;
  _count           = 0;
}

import * as vscode from 'vscode';
import { log } from './logger';

export interface AlertRecord {
  ts: number;
  source: string;
  type: 'hook' | 'pattern' | 'command-end';
  detail: string;
}

export const MAX_HISTORY = 100;
export const alertHistory: AlertRecord[] = [];
let _sessionAlertCount = 0;

let _ctx: vscode.ExtensionContext;
let _onUpdate: () => void;

export function initHistory(ctx: vscode.ExtensionContext, onUpdate: () => void) {
  _ctx = ctx;
  _onUpdate = onUpdate;
  const saved = ctx.globalState.get<AlertRecord[]>('alertHistory', []);
  alertHistory.push(...saved.slice(0, MAX_HISTORY));
  _sessionAlertCount = 0;
}

export function getSessionAlertCount() { return _sessionAlertCount; }

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)     { return 'just now'; }
  if (diff < 3_600_000)  { return `${Math.floor(diff / 60_000)}m ago`; }
  if (diff < 86_400_000) { return `${Math.floor(diff / 3_600_000)}h ago`; }
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function addAlert(record: AlertRecord) {
  alertHistory.unshift(record);
  if (alertHistory.length > MAX_HISTORY) { alertHistory.length = MAX_HISTORY; }
  _sessionAlertCount++;
  _ctx.globalState.update('alertHistory', alertHistory);
  _onUpdate();
}

export function clearHistory() {
  alertHistory.length = 0;
  _ctx.globalState.update('alertHistory', []);
  _onUpdate();
}

import * as vscode from 'vscode';
import { getConfig, getAlertOn } from './config';
import { log } from './logger';
import { addAlert } from './history';
import { flashStatusBar, getWatching } from './statusBar';
import { triggerSound } from './sound';
import { showOsNotification } from './notifications';
import { scheduleReminder } from './reminder';

let _cachedPatterns: RegExp[] | null = null;

// Constructed programmatically to avoid embedding the ESC control character (0x1B) as a literal.
const ANSI_RE = new RegExp(String.fromCodePoint(0x1B) + String.raw`(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`, 'g');

export function stripAnsi(input: string): string {
  ANSI_RE.lastIndex = 0;
  return input.replace(ANSI_RE, '');
}

export function getPatterns(): RegExp[] {
  if (_cachedPatterns) { return _cachedPatterns; }
  const raw = getConfig().get<string[]>('patterns', []);
  const compiled: RegExp[] = [];
  for (const p of raw) {
    try {
      compiled.push(new RegExp(p, 'i'));
    } catch (e) {
      log(`[warn] invalid pattern skipped: ${p} -- ${e}`);
    }
  }
  _cachedPatterns = compiled;
  return _cachedPatterns;
}

export function invalidatePatternCache() {
  _cachedPatterns = null;
}

export function terminalPassesNameFilter(terminal: vscode.Terminal): boolean {
  const filters = getConfig().get<string[]>('terminalNameFilter', []);
  if (!filters.length) { return true; }
  const name = terminal.name.toLowerCase();
  return filters.some((f) => name.includes(f.toLowerCase()));
}

export const lastTriggerAt        = new Map<vscode.Terminal, number>();
export const commandStartAt       = new Map<vscode.Terminal, number>();
export const executionControllers = new Map<vscode.Terminal, AbortController>();
export const mutedTerminals       = new Set<vscode.Terminal>();

export async function watchExecution(
  ctx: vscode.ExtensionContext,
  terminal: vscode.Terminal,
  execution: vscode.TerminalShellExecution,
  signal: AbortSignal
) {
  try {
    for await (const chunk of execution.read()) {
      if (signal.aborted) { break; }
      maybeTrigger(ctx, terminal, chunk);
    }
  } catch (e) {
    if (!signal.aborted) {
      log(`[error] stream read failed: ${e}`);
    }
  }
}

export function maybeTrigger(
  ctx: vscode.ExtensionContext,
  terminal: vscode.Terminal,
  chunk: string
) {
  if (!getWatching()) { return; }
  if (mutedTerminals.has(terminal)) { return; }
  if (!getAlertOn().includes('confirmation')) { return; }
  const patterns = getPatterns();
  if (!patterns.length) { return; }
  if (!terminalPassesNameFilter(terminal)) { return; }

  const clean  = stripAnsi(chunk);
  const config = getConfig();

  if (config.get<boolean>('debugLog', false)) {
    log(`[debug] terminal="${terminal.name}" chunk=${JSON.stringify(clean.slice(0, 200))}`);
  }

  const matched = patterns.find((re) => re.test(clean));
  if (!matched) { return; }

  const debounceMs = config.get<number>('debounceMs', 4000);
  const now = Date.now();
  if ((lastTriggerAt.get(terminal) ?? 0) + debounceMs > now) { return; }
  lastTriggerAt.set(terminal, now);

  const timeLabel = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  log(`[match] "${terminal.name}" matched ${matched} at ${new Date(now).toISOString()}`);
  addAlert({ ts: now, source: terminal.name, type: 'pattern', detail: matched.source });

  if (config.get<boolean>('focusTerminal', false)) { terminal.show(true); }

  flashStatusBar(timeLabel);
  triggerSound(ctx);

  if (!vscode.window.state.focused) {
    showOsNotification(`"${terminal.name}" needs your attention`);
  }

  scheduleReminder(`"${terminal.name}"`, terminal);
}

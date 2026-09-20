import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';

export const CLAUDE_DIR           = path.join(os.homedir(), '.claude');
export const STABLE_SOUND_PATH    = path.join(CLAUDE_DIR, 'agent-bell-notify.wav');
export const MUTE_FLAG_PATH       = path.join(CLAUDE_DIR, 'agent-bell-mute');
export const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
export const HOOK_SIGNAL_PATH     = path.join(CLAUDE_DIR, 'agent-bell-signal');
// Broad prefix — present in every file we write to ~/.claude (notify.wav, sound.*, signal, mute)
export const HOOK_MARKER          = 'agent-bell';

export function getConfig() {
  return vscode.workspace.getConfiguration('agentConfirmSound');
}

export function getAlertOn(): string[] {
  return getConfig().get<string[]>('alertOn', ['confirmation', 'completion']);
}

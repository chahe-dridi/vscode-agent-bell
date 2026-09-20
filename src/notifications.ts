import * as cp from 'node:child_process';
import * as os from 'node:os';
import { getConfig } from './config';
import { log } from './logger';

export function showOsNotification(message: string) {
  if (!getConfig().get<boolean>('osNotification', true)) { return; }
  if (getConfig().get<boolean>('focusMode', false)) { return; }
  const platform = os.platform();
  if (platform === 'win32') {
    const msg = message.replace(/'/g, "''");
    const script = [
      `Add-Type -AssemblyName System.Windows.Forms`,
      `$n = New-Object System.Windows.Forms.NotifyIcon`,
      `$n.Icon = [System.Drawing.SystemIcons]::Information`,
      `$n.Visible = $true`,
      `$n.BalloonTipTitle = 'Notification Bell'`,
      `$n.BalloonTipText = '${msg}'`,
      `$n.BalloonTipIcon = 'Info'`,
      `$n.ShowBalloonTip(5000)`,
      `Start-Sleep -Seconds 5`,
      `$n.Dispose()`,
    ].join('; ');
    cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    cp.spawn('osascript', ['-e', `display notification "${escaped}" with title "Notification Bell"`],
      { stdio: 'ignore', detached: true }).unref();
  } else {
    const child = cp.spawn('notify-send', ['Notification Bell', message, '--expire-time=5000'],
      { stdio: 'ignore', detached: true });
    child.on('error', () => {
      log('[warn] notify-send not found — install libnotify-bin for OS notifications on Linux');
    });
    child.unref();
  }
}

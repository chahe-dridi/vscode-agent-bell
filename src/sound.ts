import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { getConfig } from './config';
import { log } from './logger';

let tempFileCounter = 0;

export function pickSoundFile(ctx: vscode.ExtensionContext): string {
  const bundled = path.join(ctx.extensionPath, 'media', 'notify.wav');
  const sounds = getConfig().get<string[]>('sounds', []).filter((s) => s.trim().length > 0);
  if (sounds.length === 0) { return bundled; }
  const mode = getConfig().get<string>('soundMode', 'fixed');
  if (mode === 'random') {
    const pool = Array.from(new Set([bundled, ...sounds]));
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return sounds[0];
}

// Scale 16-bit PCM WAV samples in-memory.
// Returns the original buffer unchanged if not standard 16-bit PCM WAV, or if factor ≈ 1.0.
export function scaleWavBuffer(buf: Buffer, factor: number): Buffer {
  if (Math.abs(factor - 1.0) < 0.001) { return buf; }
  if (buf.length < 44) { return buf; }
  if (buf.toString('ascii', 0, 4) !== 'RIFF') { return buf; }
  if (buf.toString('ascii', 8, 12) !== 'WAVE') { return buf; }
  // fmt chunk at offset 12: audioFormat (offset 20) must be 1 (PCM), bitsPerSample (offset 34) must be 16.
  const audioFormat   = buf.readUInt16LE(20);
  const bitsPerSample = buf.readUInt16LE(34);
  if (audioFormat !== 1 || bitsPerSample !== 16) { return buf; }
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

export function playSound(soundFile: string) {
  const volume = Math.max(0, Math.min(2, getConfig().get<number>('volume', 1)));
  const platform = os.platform();

  let cmd: string;
  let args: string[];
  let spawnOpts: cp.SpawnOptions;

  if (platform === 'darwin') {
    cmd = 'afplay';
    args = [soundFile, '-v', String(volume)];
    spawnOpts = { stdio: 'ignore', detached: true };
  } else if (platform === 'win32') {
    const isWav = soundFile.toLowerCase().endsWith('.wav');
    let playPath = soundFile;

    if (isWav && Math.abs(volume - 1.0) > 0.001) {
      try {
        const raw = fs.readFileSync(soundFile);
        const scaled = scaleWavBuffer(raw, volume);
        const tmp = path.join(os.tmpdir(), `agent-bell-${Date.now()}-${++tempFileCounter}.wav`);
        fs.writeFileSync(tmp, scaled);
        playPath = tmp;
      } catch { /* fall back to original */ }
    }

    const isTemp = playPath !== soundFile;
    const psPath = playPath.replace(/'/g, "''");

    if (playPath.toLowerCase().endsWith('.wav')) {
      cmd = 'powershell';
      args = ['-NoProfile', '-NonInteractive', '-Command',
        isTemp
          ? `(New-Object Media.SoundPlayer '${psPath}').PlaySync(); Remove-Item '${psPath}' -ErrorAction SilentlyContinue`
          : `(New-Object Media.SoundPlayer '${psPath}').PlaySync()`
      ];
    } else {
      // MP3 / other: WPF MediaPlayer supports more codecs (requires STA + presentationCore)
      const vol = Math.min(1, volume);
      const uriPath = soundFile.replace(/\\/g, '/').replace(/'/g, "''");
      cmd = 'powershell';
      args = ['-NoProfile', '-NonInteractive', '-STA', '-Command',
        `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Volume = ${vol}; $p.Open([uri][uri]::EscapeUriString('file:///${uriPath}')); $p.Play(); Start-Sleep -Seconds 5; $p.Close()`
      ];
    }
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
    log(`[error] sound playback failed (${cmd}): ${err.message}`);
  });
  child.unref();
}

export function triggerSound(ctx: vscode.ExtensionContext) {
  if (getConfig().get<boolean>('muteWhenFocused', false) && vscode.window.state.focused) {
    log('[info] sound suppressed — VS Code is focused (muteWhenFocused)');
    return;
  }
  playSound(pickSoundFile(ctx));
}

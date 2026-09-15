import * as vscode from 'vscode';

let soundPlaying = false;
const soundQueue: (() => Promise<void>)[] = [];

async function enqueueSoundPlay(soundFile: string) {
  if (soundQueue.length >= 3) return;
  soundQueue.push(() => _playSound(soundFile));
  if (!soundPlaying) drainQueue();
}

async function drainQueue() {
  soundPlaying = true;
  while (soundQueue.length > 0) {
    await soundQueue.shift()!();
    await new Promise(r => setTimeout(r, 200));
  }
  soundPlaying = false;
}

function _playSound(soundFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const uri = vscode.Uri.file(soundFile);
    const sound = new Audio(uri.toString(true));
    sound.addEventListener('ended', () => resolve());
    sound.addEventListener('error', (err) => reject(err));
    sound.play();
  });
}

// Replace all playSound() calls with enqueueSoundPlay()
// Example:
// Before: playSound('path/to/sound.mp3');
// After: enqueueSoundPlay('path/to/sound.mp3');
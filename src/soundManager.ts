import * as fs from 'fs';
import * as path from 'path';

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

async function _playSound(soundFile: string) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, 'sounds', soundFile);
    const readableStream = fs.createReadStream(filePath);
    readableStream.on('data', (chunk) => {
      // Simulate playing the sound
    });
    readableStream.on('end', () => {
      resolve();
    });
    readableStream.on('error', (err) => {
      reject(err);
    });
  });
}

export { enqueueSoundPlay };
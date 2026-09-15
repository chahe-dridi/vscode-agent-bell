```typescript
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

export { enqueueSoundPlay };
```
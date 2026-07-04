# Agent Bell — Roadmap

Items are sorted by priority. Each completed item gets a ✅ and a version tag.
When starting a new batch of work, create `docs/WORK-<version>.md` to track what changed.

---

## P0 — Quick wins (high value, low effort)

### 1. More Claude Code–specific patterns
Claude Code renders permission prompts with box-drawing characters and specific phrasing that current patterns miss. Add patterns for:
- `allow this action`
- `do you want to proceed`
- `bash\s+command` tool use prompts
- Box-drawing lines that appear before a `[y/n]`
- Claude Code's `> ` input cursor line

**Why chat gets "stuck":** Claude Code's prompt text goes through shell integration fine, but our regex doesn't match its exact phrasing. This is the most likely reason sounds aren't firing during Claude Code sessions.

### 2. Focus triggering terminal on alert
When a pattern matches, bring the matching terminal to the foreground (`terminal.show()`). Optional setting: `agentConfirmSound.focusTerminal` (default `false`).

### 3. Visual pulse on status bar item
Flash the status bar item briefly when a sound fires — useful when system audio is low. Use `statusBarItem.color` cycling or a temporary icon swap.

---

## P1 — Medium effort, high value

### 4. Pattern tester command
Command: **Agent Bell: Test Patterns**
Opens an input box → user pastes a line of terminal output → extension shows which pattern matched (or "no match"). Removes the guesswork when tuning patterns. Logs result to the output channel.

### 5. Repeat alert if not acknowledged
Setting: `agentConfirmSound.repeatIntervalMs` (default `0` = disabled).
If set, re-plays the sound every N ms while the terminal is still showing the same prompt (debounce timestamp hasn't been reset by a new execution). Useful when you're in a flow and miss the first ping.

### 6. Desktop (toast) notification
In addition to sound, show a VS Code information message or native OS toast when triggered. Setting: `agentConfirmSound.showNotification` (default `false`). The message shows the terminal name and matched text snippet.

### 7. Per-pattern sound files
Allow patterns to map to specific sounds instead of one global sound. Config shape:
```json
"agentConfirmSound.patternSounds": [
  { "pattern": "allow this action", "soundPath": "/sounds/urgent.wav" },
  { "pattern": "\\(y/n\\)", "soundPath": "/sounds/soft.wav" }
]
```

---

## P2 — Nice to have

### 8. Quiet hours
Settings: `agentConfirmSound.quietHoursStart` / `quietHoursEnd` (24h format strings, e.g. `"22:00"`).
No sound fires during this window. Useful when running agents overnight.

### 9. Status bar shows which terminal triggered
After a match, update the status bar tooltip to show `Last match: <terminal name> at <time>` so you know where to look.

### 10. Keyboard shortcut for toggle
Ship a default keybinding for `agentConfirmSound.toggle` (e.g. `Ctrl+Alt+B`). Let users rebind via standard VS Code keybindings.

### 11. Agent auto-detect
If the terminal name contains `claude`, `aider`, `cursor`, etc., automatically apply a stricter name filter and log which agent is being watched. No config needed.

### 12. Sound cooldown per session
Instead of per-terminal debounce, add a global cooldown so rapid fires across multiple terminals don't stack up.

---

## Completed

| Version | Item |
|---|---|
| 0.1.0 | Initial release — sound on pattern match, mute toggle, cross-platform |
| 0.1.2 | Windows sound fix, memory cleanup, toggle watching, pattern cache |

# Changelog

## [0.1.3] — 2026-07-04

- Add: status bar flashes on match (visual alert alongside sound)
- Add: `agentConfirmSound.focusTerminal` setting — auto-focus the matching terminal
- Add: **Agent Bell: Test Pattern** command — paste terminal output, see which pattern matched
- Add: more Claude Code–specific default patterns (`approve/reject`, `tool call`, `run this command`, `execute?`, `waiting for input`)
- Fix: flash timer properly cleared on deactivate

## [0.1.2] — 2026-07-04

- Fix: Windows sound now works reliably — removed `detached: true` which caused audio device access issues
- Fix: memory leak — `lastTriggerAt` map now cleans up entries when terminals are closed
- Improve: toggle command renamed to "Toggle Watching" with clearer status bar (colored when paused)
- Improve: `agentConfirmSound.enabled` setting now syncs live with the watching state
- Improve: removed noisy `onDidOpenTerminal` shell integration warning
- Improve: `deactivate` now clears the trigger map

## [0.1.1] — 2026-07-04

- Fix: pattern cache — regexes are now compiled once and invalidated on config change instead of on every terminal output chunk
- Fix: volume setting now actually applied — `afplay -v` on macOS, `paplay --volume` on Linux
- Fix: ANSI strip regex simplified and corrected
- Fix: all event subscriptions batched into a single `context.subscriptions.push()` call
- Add Claude Code–specific default patterns (`allow read/write/execute/bash`, `do you want claude`)
- Status bar and output channel renamed to "Agent Bell"

## [0.1.0] — 2026-07-04

Initial release.

- Sound alert when a terminal matches a configurable regex pattern
- Cross-platform playback: `afplay` (macOS), PowerShell `SoundPlayer` (Windows), `paplay`/`aplay` (Linux)
- Volume control on macOS and Linux
- Per-terminal debounce to avoid sound spam
- Terminal name filter to limit which terminals are watched
- Custom sound file support
- Status bar mute toggle
- Pattern cache with invalidation on config change
- Output channel for match logs and debug info
- Commands: Toggle Mute, Play Test Sound, Show Log

# Changelog

## [0.2.3] — 2026-07-04

- Add: **PreToolUse hook** — plays a sound when Claude Code is about to run a Bash command, which is exactly when permission dialogs appear. You'll now hear the bell the moment Claude needs you to approve a command.

## [0.2.2] — 2026-07-04

- Fix: status bar moved to left side so it's always visible (right side gets clipped by VS Code built-ins)
- Fix: status bar now uses warning background color when paused — more noticeable
- Fix: toggling while a sound flash was active no longer delays the visual state change
- Fix: setup modal no longer re-appears on every VS Code reload — remembers Yes/No decision in globalState
- Add: "Remove Claude Code Integration" now confirms "Safe to uninstall now" when done
- Add: **Agent Bell: Manage Sounds** and **Agent Bell: Add Sound File** commands (were missing from previous build)

## [0.2.1] — 2026-07-04

- Add: **Notification hook** — adds a second hook (`Notification` event) alongside `Stop` so you're notified when Claude Code sends background notifications
- Add: **Multi-sound support** — `agentConfirmSound.sounds[]` list + `soundMode: "fixed" | "random"`
- Add: **Agent Bell: Manage Sounds** command — QuickPick UI to add/remove sounds and toggle random mode
- Add: **Agent Bell: Add Sound File** command — file picker for adding custom sounds
- Fix: hook setup now shows a modal dialog listing exactly what will be changed before making any edits
- Fix: `agentConfirmSound.volume` setting now actually applied on macOS (`afplay -v`) and Linux (`paplay --volume`)

## [0.2.0] — 2026-07-04

- Add: **Claude Code integration** — on first install, Agent Bell offers to add a `Stop` hook to `~/.claude/settings.json` so you hear a sound every time Claude Code finishes its turn (works regardless of shell integration)
- Add: sound file copied to `~/.claude/agent-bell-notify.wav` for a stable hook path that survives extension updates
- Add: **Agent Bell: Set Up Claude Code Integration** command — install the hook manually
- Add: **Agent Bell: Remove Claude Code Integration** command — cleanly remove the hook and sound file
- Add: hook status shown in the output channel on activation

## [0.1.4] — 2026-07-04

- Add: `agentConfirmSound.debugLog` setting — logs every terminal chunk after ANSI stripping so you can see exactly what text reaches the extension and tune patterns accordingly
- Fix: log version number on activation

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

# Changelog

## [0.2.6] — 2026-07-16

- Add: **alert on any command end** — plays a sound whenever a terminal command finishes (controlled by `alertOnCommandEnd`, default on). Quick commands are filtered by `commandEndMinDurationMs` (default 5s) so only long-running tasks like builds, tests, or deploys trigger it.
- Add: **OS notification when unfocused** — when VS Code is not the active window and an alert fires, shows a system notification: balloon tip on Windows, notification center on macOS, `notify-send` on Linux. Controlled by `osNotification`, default on.

## [0.2.5] — 2026-07-06

- Fix: **Toggle off now silences Claude Code hooks** — creates a mute flag file (`~/.claude/agent-bell-mute`) that all hooks check before playing; hooks are immediately silent when you pause Agent Bell
- Fix: **Active sound now syncs to hooks** — switching to a different sound in Manage Sounds immediately copies it to `~/.claude/agent-bell-notify.wav` so hooks play the same sound
- Fix: **Volume now works on Windows** — WAV samples are scaled in memory before playback instead of relying on `SoundPlayer` (which has no volume API); hooks also get a volume-scaled copy of the sound file on install
- Fix: existing hooks auto-migrated on startup to include the mute-flag check

## [0.2.4] — 2026-07-06

- Fix: rework **Manage Sounds** UI — sounds now show an active indicator (`✓`), clicking any sound makes it the active one immediately
- Add: **volume picker** in Manage Sounds — choose 25 / 50 / 75 / 100% or a custom value (applies on macOS/Linux; Windows uses system volume)
- Add: after adding a sound file, a prompt asks "Use this sound now?" so it activates without extra steps
- Add: active sound can be previewed or removed directly from the menu
- Add: menu loops after each action so you can see the updated state without reopening

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

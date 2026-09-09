# Changelog

## [0.5.1] — 2026-09-09

- Fix: **Status bar click now opens Alert History** — clicking `🔔` opens Show Alert History instead of toggling pause; Toggle Watching remains available via the Command Palette; tooltips updated to match

## [0.5.0] — 2026-09-04

- Add: **Configure Alert Triggers** — new `agentConfirmSound.alertOn` setting and `Notification Bell: Configure Alert Triggers` command let you choose when alerts fire: **Confirmation prompts** (agent asking y/n or waiting for approval), **Task completed** (command or agent turn finished), or both. Default is both. Each trigger type independently gates pattern matching, command-end alerts, and Claude Code hook events.

## [0.4.4] — 2026-09-03

- Fix: **Linux notify-send missing now logs a warning** — when `notify-send` is not installed, the extension now logs a clear warning to the output channel instead of failing silently; the error handler is correctly attached before `.unref()` so the `ENOENT` event is captured

## [0.4.3] — 2026-09-03

- Add: **"Notification Bell: Dismiss Reminder" command** — dismisses an active reminder escalation immediately from the Command Palette; shows a message if no reminder is active

## [0.4.2] — 2026-08-30

- Add: **Test Pattern copies match to clipboard** — when a pattern matches, the regex source is automatically written to the clipboard so it can be pasted directly into `settings.json` without hunting through the log
- Docs: README overhauled — marketplace badges, feature table with icons, navigation links, common configuration examples, and cleaner layout throughout

## [0.4.1] — 2026-08-30

- Add: **"Notification Bell: Reset to Defaults" command** — resets all 15 settings keys to their defaults via a modal confirmation dialog; useful for starting fresh after heavy customisation
- Docs: added star-the-repo link to README contributing section

## [0.4.0] — 2026-08-30

- Add: **notification-bell.mp3 selectable in Manage Sounds** — the second bundled sound now appears as a proper option in the Manage Sounds quick pick alongside `notify.wav`, with active-state indicator, preview on click, and hook sync on switch
- Add: **status bar session alert count badge** — the status bar now shows `🔔 7` (capped at `🔔 99+`) so you can see how many alerts fired this session at a glance; updates on every alert and on history clear
- Add: new default patterns — `are you sure\?`, `\[A\]llow`, `press any key`
- Fix: volume setting description corrected — Windows volume control works via in-memory 16-bit PCM WAV sample scaling (not SoundPlayer, which has no volume API)

## [0.3.0] — 2026-08-29

- Rename: extension display name changed from **Agent Bell** to **Notification Bell** for better discoverability (internal package name `agent-confirm-sound` unchanged — existing installs are not affected)
- Add: **hook IPC signal file** — each Claude Code hook now also writes the event name to `~/.claude/agent-bell-signal`; the extension watches this file with `fs.watch()` to flash the status bar and show an OS notification inside VS Code even when hooks fire outside VS Code focus
- Add: **reminder escalation** — set `reminderIntervalMs` to re-alert after N milliseconds if you haven't responded; `reminderMaxCount` caps the total reminders; reminders cancel automatically when you run a new command in the waiting terminal
- Add: **alert history** — `Show Alert History` command shows the last 50 alerts (time, source, trigger type) in a quick pick; includes a "Clear history" option
- Add: `agentConfirmSound.hookPreToolUse` setting — opt-in hook that fires before every Claude Code bash command (useful only with manual bash approval; off by default)
- Add: `agentConfirmSound.reminderIntervalMs` and `agentConfirmSound.reminderMaxCount` settings
- Fix: **AbortController per terminal** — `for await` stream loops on terminal output now cancel cleanly when a terminal closes, eliminating a memory leak from dangling async iterators
- Fix: **WAV header validation before scaling** — `scaleWavBuffer` now validates RIFF/WAVE magic bytes and checks `audioFormat == 1` (PCM) and `bitsPerSample == 16` before attempting to scale samples; non-standard WAV files no longer produce corrupted audio
- Fix: **temp file race on Windows** — volume-scaled WAV temp files now use a monotonic counter (`Date.now()-${++counter}`) instead of a shared filename, eliminating corruption when two alerts arrive within one play duration
- Fix: **terminal filter applied before stream start** — `watchExecution` is no longer started for terminals that would always be filtered by `terminalNameFilter`, removing unnecessary CPU overhead
- Fix: `isHookInstalled()` cache removed — always reads from disk to avoid stale state after external edits to `~/.claude/settings.json`
- Change: removed three false-positive patterns (`approve|reject.*action`, `tool (call|use|request)`, `run this command`) and added three more precise ones (`continue\?\s*$`, `overwrite.*\?`, `enter (your )?choice`)
- Docs: added `CONTRIBUTING.md` with branch strategy, pattern guidelines, and dev setup instructions
- Build: `.vscodeignore` updated to exclude `.claude/` from VSIX bundle (prevents local `settings.local.json` from being packaged)

## [0.2.8] — 2026-08-14

- Fix: **non-WAV files (MP3, OGG, etc.) no longer break the Claude Code hook on Windows** — `Media.SoundPlayer` only supports WAV; when the active sound is a non-WAV file, the hook now falls back to the bundled WAV and logs the reason instead of writing MP3 bytes to a `.wav` path and silently failing
- Fix: **double alert on long-running commands** — if a pattern-match alert already fired during a command's execution, the command-end alert is suppressed; previously both would fire for commands running longer than `debounceMs` (4s)
- Fix: **concurrent sound plays no longer race on a shared temp file** — each Windows WAV-scaled playback now writes to a unique temp filename (`agent-bell-{timestamp}.wav`) instead of overwriting a single shared file, preventing corrupted or truncated audio when two triggers arrive within one play duration
- Fix: **macOS OS notifications with backslashes in the message no longer produce malformed AppleScript** — both `\` and `"` are now escaped before interpolation into the `display notification` string
- Fix: `commandStartAt` is now cleared in `deactivate()` (was cleared per terminal-close but not on extension unload)
- Fix: `isHookInstalled()` no longer reads and parses `settings.json` from disk on every call — result is cached after first check and invalidated only when hooks are installed or removed
- Fix: changing `agentConfirmSound.sounds` or `soundMode` directly in settings.json now re-syncs the hook sound file (the `onDidChangeConfiguration` handler was narrowed too aggressively in v0.2.7 and only responded to volume changes)
- Fix: `onDidEndTerminalShellExecution` now captures a single `Date.now()` timestamp and uses it for both elapsed-time and debounce calculations, eliminating a subtle clock-drift between the two checks
- Fix: Windows hook command comment clarifies that volume is baked into `STABLE_SOUND_PATH` by `syncHookSound` and `SoundPlayer` has no volume API — removes the dead `volume` read from the Windows branch of `buildHookCommand`

## [0.2.7] — 2026-07-22

- Fix: **changing notification sound now reliably updates the hook** — `syncHookSound` now receives the exact file path directly from the UI action instead of re-reading config that may not have settled yet; also removed redundant syncs from `onDidChangeConfiguration` that were firing with stale config values between two back-to-back updates
- Fix: **command detection no longer fires for commands that started before the extension loaded** — previously `commandStartAt.get() ?? 0` caused a huge elapsed time (always above the threshold), so orphaned command-ends would always trigger a spurious alert; now those events are silently skipped
- Change: **`commandEndMinDurationMs` default lowered from 5s to 3s** — catches more real long-running commands without catching quick ones

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

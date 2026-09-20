# Changelog

## [0.5.18] — 2026-09-20

- Fix: **"Allow this bash command?" now triggers a sound** — default pattern updated from `allow this (action|command|tool)` to include `bash`, so Claude Code's bash approval prompt is caught by the terminal watcher
- Add: **"Every command" event in settings panel** — new toggle (`agentConfirmSound.soundOnCommandStart`) plays a sound every time a terminal command starts executing; useful to hear when Claude Code fires off a bash command; off by default

## [0.5.17] — 2026-09-20

- Fix: **Windows hook plays MP3/non-WAV sounds with no helper file** — `Add-Type -Name MCI -MemberDefinition '...' -Namespace W` inlines the `winmm.dll` P/Invoke directly in the hook command string; `mciSendString('play m wait')` is synchronous and works in any Windows session type. No `agent-bell-play.ps1` is written to disk; `removeClaudeHook` still cleans it up from installs that had the v0.5.16 file

## [0.5.16] — 2026-09-20

- Fix: **Hook detection works for all sound formats** — `HOOK_MARKER` changed from `agent-bell-notify` (only present in WAV paths) to `agent-bell` (prefix of every file we write to `~/.claude/`), so `isHookInstalled()` correctly returns `true` for MP3 and WAV alike; `isHookInstalled()` returning `false` previously meant the signal watcher never started on VS Code startup
- Fix: **`removeClaudeHook` cleans up all generated hook files** — deletes any `agent-bell-sound.*` files and the v0.5.16 `agent-bell-play.ps1` if present

## [0.5.15] — 2026-09-20

- Refactor: **Split `extension.ts` into focused modules** — the single 1 549-line file is now 11 modules (`config`, `logger`, `history`, `sound`, `notifications`, `statusBar`, `reminder`, `hooks`, `terminal`, `panel`, `extension`), each under 560 lines; no behaviour changes, compiled output is identical

## [0.5.14] — 2026-09-20

- Fix: **Volume above 100% now works** — `agentConfirmSound.volume` schema raised to max 2.0; `playSound` and `syncHookSound` no longer clamp to 1.0; WAV sample scaling now correctly applies for values both below and above 1.0 (150% and 200% pills in the settings panel now have real effect)
- Fix: **MP3 plays on Windows** — non-WAV sound files on Windows now use WPF `System.Windows.Media.MediaPlayer` (STA mode, supports MP3/AIFF/OGG) instead of `Media.SoundPlayer` which only accepts WAV; switching to `notification-bell.mp3` and triggering an alert on Windows now plays audio correctly
- Improve: **Manage Sounds volume picker** — 150% and 200% options added; custom input now accepts 0–200

## [0.5.13] — 2026-09-18

- Add: **Focus mode** — new toggle in the settings panel (and `agentConfirmSound.focusMode` setting) that keeps alert sounds playing but suppresses OS popup notifications; useful when you can hear the bell but don't want balloon tips / macOS banners cluttering your screen
- Improve: **Info badges in settings panel** — every setting row now has a `!` badge that shows a plain-language description tooltip on hover, so the panel is self-documenting without opening full settings

## [0.5.12] — 2026-09-18

- Improve: **Settings panel opens in the bottom panel** — clicking the gear icon now pops up the Notification Bell settings as a tab in the bottom panel area (alongside Terminal / Output / Problems), not as a full editor tab; close it with the panel's × or Ctrl+J like any other panel

## [0.5.11] — 2026-09-18

- Improve: **Settings panel is now a popup sidebar** — clicking the gear icon (or running "Open Settings Panel") now opens the Notification Bell panel as a collapsible section in the Explorer sidebar, not a full editor tab; the panel stays out of your way and can be expanded/collapsed like any sidebar section

## [0.5.10] — 2026-09-17

- Add: **Gear icon in status bar** — a `$(gear)` button appears next to the bell in the status bar; clicking it opens the Settings Panel directly without going through the Command Palette

## [0.5.9] — 2026-09-17

- Add: **Settings Panel** — new "Notification Bell: Open Settings Panel" command opens a rich webview UI showing volume pills (click to change instantly), auto-mute when focused toggle, min task duration, and per-event sound status with Preview / Change actions
- Add: **Auto-mute when focused** — new `agentConfirmSound.muteWhenFocused` setting suppresses alert sounds when VS Code is the active window (status bar flash and history still record); also available as a toggle in the Settings Panel

## [0.5.8] — 2026-09-16

- Add: **Per-workspace alert trigger scope** — "Configure Alert Triggers" now asks whether the selected mode should apply to all workspaces (global) or only the current workspace; cancelling any step leaves the existing config untouched

## [0.5.7] — 2026-09-15

- Fix: **Alert history correctly handles unknown exit codes** — `exit ?` (shell integration couldn't determine the code) now shows `$(warning)` + "Command ended" instead of being incorrectly flagged as "Command failed"; three distinct states: done (exit 0), failed (exit N), ended (exit ?)
- Fix: **Status bar badge counts only this session's alerts** — the badge and "N alerts this session" tooltip now track a separate in-memory counter that resets on activation, so persisted history from prior sessions no longer inflates the count
- Fix: **OGG and FLAC listed as supported sound formats** — descriptions in Manage Sounds, `agentConfirmSound.sounds` setting, and README now mention `.ogg` / `.flac` (Linux/paplay only); also fixes stale "Agent Bell: Manage Sounds" reference in setting description

## [0.5.6] — 2026-09-11

- Fix: **Alert History shows failed commands** — command-end alerts now store the exit code in the detail field (`finished in 12s (exit 1)`); the history quick pick shows `$(error)` and "Command failed" for non-zero exits and `$(check)` and "Command done" for clean exits, making it easy to spot failures at a glance

## [0.5.5] — 2026-09-11

- Improve: **Status bar tooltip shows active terminal filter** — when `terminalNameFilter` is set, the tooltip now reads "watching: claude only" instead of a generic message; shows "watching all terminals" when the filter is empty
- Improve: **Command Palette grouping** — all 12 commands now use `"category": "Notification Bell"` so typing "Notification Bell" in the palette shows them all cleanly grouped together

## [0.5.4] — 2026-09-11

- Improve: **Alert History is now searchable** — type in the history quick pick to filter by terminal name, relative time, pattern text, elapsed time, or hook event; uses VS Code's built-in `matchOnDescription` and `matchOnDetail` flags

## [0.5.3] — 2026-09-11

- Docs: updated extension description — now correctly lists Gemini CLI and Codex CLI (removed erroneous "Cursor CLI" reference); added keywords: gemini, codex, cursor, copilot, productivity, monitoring, automation for better marketplace discoverability

## [0.5.2] — 2026-09-11

- Improve: **Alert History overhauled** — history now persists across VS Code reloads (restored from globalState on activation); capacity raised from 50 to 100 entries; each row shows what happened ("Pattern match — claude", "Command done — npm test", "Claude Code — Stop") with relative time ("2m ago · 10:42:33"); clicking any alert copies its detail text to the clipboard; Clear History also wipes the persisted store

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

# Notification Bell — Roadmap

Items sorted by priority. Completed items are marked ✅ with a version tag.

---

## Pending

### P1 — High value

**Per-event sound files**
Allow different sounds for confirmations vs. completions vs. hook events. Config shape:
```json
"agentConfirmSound.patternSounds": [
  { "event": "confirmation", "soundPath": "/sounds/urgent.wav" },
  { "event": "completion",   "soundPath": "/sounds/soft.wav" }
]
```
Tracked in [#195](https://github.com/chahe-dridi/vscode-agent-bell/issues/195).

**Min task duration picker in settings panel**
`commandEndMinDurationMs` currently shows the value with a "Change…" link to full settings. Replace it with inline increment/decrement buttons in the panel.
Tracked in [#198](https://github.com/chahe-dridi/vscode-agent-bell/issues/198).

### P2 — Nice to have

**Quiet hours**
Settings: `agentConfirmSound.quietHoursStart` / `quietHoursEnd` (24h strings, e.g. `"22:00"`). No sound fires during this window — useful for overnight agent runs.

**Keyboard shortcut for toggle**
Ship a default keybinding for `agentConfirmSound.toggle` (e.g. `Ctrl+Alt+B`). Let users rebind via standard VS Code keybindings.

**Sound cooldown per session**
Global cooldown so rapid fires across multiple terminals don't stack. Separate from per-terminal debounce — affects the combined alert rate.

---

## Completed

| Version | Item |
|---|---|
| 0.1.0 | Initial release — sound on pattern match, mute toggle, cross-platform |
| 0.1.2 | Windows sound fix, memory cleanup, toggle watching, pattern cache |
| 0.1.3 | Status bar flash on alert, focus terminal option, pattern tester command, more Claude Code patterns |
| 0.1.4 | Debug log mode to trace terminal chunks |
| 0.2.0 | Claude Code hook integration — auto-installs Stop hook into `~/.claude/settings.json` |
| 0.2.1 | Notification hook + multi-sound support + Manage Sounds command |
| 0.2.2 | Status bar to left side, warning color when paused, setup modal remembers decision |
| 0.2.3 | PreToolUse hook for bash approval workflows |
| 0.2.4 | Manage Sounds UI overhaul — active indicator, instant switch, volume picker |
| 0.2.5 | Mute flag synced to hooks, active sound synced to hooks, volume on Windows via WAV scaling |
| 0.2.6 | Command-end alert (alertOnCommandEnd), OS notification when VS Code unfocused |
| 0.2.7 | Hook sound sync fix, orphaned command-end fix, commandEndMinDurationMs default 5s → 3s |
| 0.2.8 | Non-WAV fallback on Windows hook, double-alert fix, temp file race fix, AppleScript escaping |
| 0.3.0 | Rename to Notification Bell, hook IPC signal file, reminder escalation, alert history (50 entries), AbortController per terminal, WAV header validation |
| 0.4.0 | notification-bell.mp3 selectable, session alert count badge, new default patterns |
| 0.4.1 | Reset to Defaults command |
| 0.4.2 | Test Pattern copies match to clipboard, README overhaul |
| 0.4.3 | Dismiss Reminder command |
| 0.4.4 | Linux notify-send missing now logs a warning |
| 0.5.0 | Configure Alert Triggers — alertOn setting, choose confirmation / completion / both |
| 0.5.1 | Status bar click opens Alert History instead of toggling |
| 0.5.2 | Alert history persisted across reloads, capacity 50 → 100, relative time display |
| 0.5.3 | README/keywords cleanup, Gemini CLI + Codex CLI listed |
| 0.5.4 | Alert History searchable |
| 0.5.5 | Status bar tooltip shows active terminal filter, all commands grouped under "Notification Bell" |
| 0.5.6 | Alert History shows failed commands (exit codes) |
| 0.5.7 | Unknown exit code (exit ?) shows warning instead of error, session badge fix |
| 0.5.8 | Configure Alert Triggers — per-workspace scope picker |
| 0.5.9 | Settings panel webview with volume pills, auto-mute toggle, event rows |
| 0.5.10 | Gear icon in status bar to open settings panel |
| 0.5.11 | Settings panel moved to Explorer sidebar (WebviewViewProvider) |
| 0.5.12 | Settings panel moved to bottom panel area |
| 0.5.13 | Focus mode (sound on, OS popups off) + info badge tooltips on every panel row |
| 0.5.14 | Volume above 100% fixed (schema + clamp + WAV scaling); MP3 playback on Windows via WPF MediaPlayer |
| 0.5.15 | Codebase split into 11 focused modules — no single file exceeds 560 lines |

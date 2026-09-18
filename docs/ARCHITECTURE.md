# Notification Bell — Architecture

## How it works

There are two independent alert paths. Both can fire simultaneously.

### Path 1 — Claude Code hooks (preferred)

```
Claude Code process
  └── ~/.claude/settings.json  (Stop / Notification / PreToolUse hooks)
        └── shell script: plays ~/.claude/agent-bell-notify.wav
                        + writes ~/.claude/agent-bell-signal

Extension (fs.watch on agent-bell-signal)
  └── reads event type from file
  └── addAlert() → history ring buffer + sessionAlertCount badge
  └── flashStatusBar()
  └── triggerSound()
  └── showOsNotification()  [if VS Code not focused and focusMode off]
  └── scheduleReminder()    [if reminderIntervalMs > 0]
```

This path works even when VS Code is not focused. The hook script runs in Claude Code's process; the extension picks it up via `fs.watch`.

### Path 2 — VS Code shell integration (other agents)

```
VS Code terminal (shell integration active)
  └── onDidStartTerminalShellExecution
        └── watchExecution()  ← async generator, one AbortController per terminal
              └── per chunk → maybeTrigger()
                    ├─ watching?
                    ├─ getAlertOn().includes('confirmation')?
                    ├─ terminalPassesNameFilter()?
                    ├─ stripAnsi(chunk) → clean text
                    ├─ getPatterns() → cached RegExp[]
                    ├─ debounce check (lastTriggerAt map)
                    └─ addAlert() / flashStatusBar() / triggerSound() / showOsNotification()

  └── onDidEndTerminalShellExecution
        └── elapsed >= commandEndMinDurationMs?
              └── getAlertOn().includes('completion')?
                    └── addAlert() / flashStatusBar() / triggerSound() / showOsNotification()
```

Requires shell integration (bash, zsh, fish, PowerShell). Full-screen TUI apps won't expose clean text — use Path 1 for Claude Code.

---

## Key design decisions

**Single file.** All extension logic lives in `src/extension.ts`. This keeps navigation simple and avoids premature abstraction for a focused tool.

**Shell integration required for Path 2.** VS Code's `onDidStartTerminalShellExecution` only fires when shell integration is active. Raw shells, WSL without integration, or full-screen TUI apps (ncurses) won't expose output — this is a VS Code API constraint.

**Pattern cache.** Regex compilation is expensive per-chunk. Patterns are compiled once into `cachedPatterns` and invalidated only when `agentConfirmSound.patterns` changes in settings.

**No `detached: true` on Windows.** Detached processes on Windows run in a new process group and can lose access to the audio device. macOS and Linux use `detached: true` so the sound process outlives the spawn.

**Per-terminal AbortController.** Each `watchExecution` async iterator is backed by an `AbortController`. When a terminal closes, the controller aborts and the `for await` loop exits cleanly — no dangling async iterators.

**Per-terminal debounce.** `lastTriggerAt` is a `Map<Terminal, number>`. Each terminal tracks its own last-trigger timestamp independently. Cleaned on `onDidCloseTerminal`.

**ANSI stripping.** Terminal output arrives with escape sequences. `stripAnsi` removes them before pattern matching so regexes work on plain text.

**WAV sample scaling on Windows.** PowerShell `SoundPlayer` has no volume API. Volume is baked into the WAV in memory by `scaleWavBuffer` (validates RIFF/WAVE magic + PCM + 16-bit before touching samples). A monotonic counter prevents temp-file races when two alerts arrive within one play duration.

**Alert history ring buffer.** `alertHistory` holds up to 100 `AlertRecord` entries, persisted to `context.globalState` on every write. `sessionAlertCount` is a separate in-memory counter (reset on activate) used for the status bar badge — prevents persisted history from inflating the session count.

**`alertOn` gating.** Both paths check `getAlertOn()` before firing. `confirmation` gates pattern matching and PreToolUse hooks. `completion` gates command-end alerts and Stop/Notification hooks. Either or both can be enabled per workspace or globally via `Configure Alert Triggers`.

**Focus mode vs. muteWhenFocused.** Two independent silence toggles:
- `muteWhenFocused` — skips the sound when VS Code is the active window (checked in `triggerSound`).
- `focusMode` — skips OS popup notifications entirely regardless of focus (checked in `showOsNotification`).

**Settings panel as WebviewView.** `SettingsViewProvider` implements `vscode.WebviewViewProvider` and is registered in the bottom panel area (`notification-bell-panel` view container). The gear icon in the status bar runs `agentConfirmSound.settingsView.focus` to reveal it. The panel refreshes on every `onDidChangeConfiguration` event and on visibility change.

---

## File structure

```
agent-confirm-sound/
├── src/
│   └── extension.ts          ← all extension logic (single file)
├── media/
│   ├── notify.wav            ← bundled default sound (16-bit PCM WAV)
│   └── notification-bell.mp3 ← second bundled sound
├── out/                      ← compiled JS (gitignored)
├── dist/                     ← packaged .vsix output (gitignored)
├── .github/
│   └── workflows/
│       ├── ci.yml            ← compile, quality, security, PR checks
│       └── codeql.yml        ← CodeQL static analysis
├── docs/
│   ├── ROADMAP.md
│   └── ARCHITECTURE.md       ← this file
├── icon.png                  ← marketplace icon (128×128)
├── package.json
├── tsconfig.json
├── .vscodeignore
└── .gitignore
```

---

## Settings namespace

All settings live under `agentConfirmSound.*`. Display name is "Notification Bell", internal package name is `agent-confirm-sound`.

## Extension ID

`chahe-dridi.agent-confirm-sound`

Publisher: `chahe-dridi`
Repo: `https://github.com/chahe-dridi/vscode-agent-bell`

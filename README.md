# Agent Bell

**Never miss an AI agent waiting on you again.**

Agent Bell watches your VS Code integrated terminals and plays a sound the moment an AI agent needs your attention — whether it's waiting for confirmation, asking permission to run a command, or finished its turn and ready for your next message.

Works with **Claude Code**, aider, Cursor CLI, and any other terminal-based AI agent.

---

## Installation

Search **"Agent Bell"** in the VS Code Extensions view, or:

```bash
code --install-extension chahe-dridi.agent-confirm-sound
```

---

## Claude Code integration

On first install, Agent Bell offers to set up a direct integration with Claude Code. Accept the prompt and it will:

1. Copy the notification sound to `~/.claude/agent-bell-notify.wav` (a stable path that survives extension updates)
2. Add two hooks to `~/.claude/settings.json`:
   - **`Stop`** — plays when Claude finishes its turn and is waiting for your next message
   - **`Notification`** — plays when Claude Code sends a background notification (e.g. when the window is not focused)

These hooks fire directly from Claude Code's process — they work even if VS Code is not in focus. Each hook also writes a signal to `~/.claude/agent-bell-signal` so the extension can flash the status bar and show an OS notification inside VS Code too, bridging the hook path back into the visual UI.

> **PreToolUse (bash approval) hook:** If you run Claude Code with manual bash approval (`requiresApproval`), you can enable an additional hook that plays before each bash approval prompt. Set `agentConfirmSound.hookPreToolUse: true` and reinstall the integration. Leave this off if bash is auto-approved — it would fire on every command.

> **Privacy note:** Agent Bell only writes to your local `~/.claude/settings.json`. No data is read, collected, or sent anywhere.

If you skip the prompt, you can set it up later:

- `Ctrl+Shift+P` → **Agent Bell: Set Up Claude Code Integration**
- To undo: **Agent Bell: Remove Claude Code Integration**

> **Before uninstalling Agent Bell:** run "Agent Bell: Remove Claude Code Integration" first so the hooks and sound file are cleaned up from `~/.claude/`.

---

## Terminal watching (other agents)

For agents that run in a standard VS Code terminal (aider, custom scripts, etc.), Agent Bell also watches terminal output and plays a sound when a line matches one of your configured patterns — things like `(y/n)`, `Allow this action?`, `Press enter to confirm`.

> Requires shell integration to be active in the terminal. It's on by default for bash, zsh, fish, and PowerShell in recent VS Code. You'll see a small decoration to the left of your prompt when it's active.

---

## How it works

```
Claude Code (UI / CLI)
  └── ~/.claude/settings.json hooks
        ├── Stop         → sound + writes ~/.claude/agent-bell-signal
        └── Notification → sound + writes ~/.claude/agent-bell-signal
              └── fs.watch() in extension → status bar flash + OS notification

Other terminal agents (aider, scripts, etc.)
  └── VS Code shell integration API
        └── pattern match on terminal output → sound + status bar flash + OS notification
```

---

## Features

- Claude Code hook integration — works even without shell integration
- Sound alert on any configurable regex pattern in terminal output
- Alert when any long-running command finishes (configurable minimum duration)
- Status bar indicator — flashes on alert, click to pause/resume
- OS-level notification when VS Code is not focused (Windows balloon tip, macOS notification, Linux notify-send)
- Multi-sound support — add your own files and use random or fixed mode
- Volume control on all platforms (macOS via afplay, Linux via paplay, Windows via WAV sample scaling)
- Terminal name filter — watch only terminals named "claude" or "aider"
- Per-terminal debounce — one alert per prompt, no spam
- Debug log mode — see exactly what text reaches the extension
- Pattern tester — paste terminal output and see which pattern matches
- Cross-platform — macOS, Windows, Linux

---

## Commands

| Command | Description |
|---|---|
| `Agent Bell: Toggle Watching` | Pause or resume terminal watching (also via status bar). |
| `Agent Bell: Play Test Sound` | Fire the sound immediately to verify audio works. |
| `Agent Bell: Show Log` | Open the output channel for match logs and debug info. |
| `Agent Bell: Test Pattern` | Paste terminal output — see which pattern matched. |
| `Agent Bell: Set Up Claude Code Integration` | Install Stop + Notification hooks into `~/.claude/settings.json`. |
| `Agent Bell: Remove Claude Code Integration` | Remove hooks and delete the copied sound file. Run this before uninstalling. |
| `Agent Bell: Manage Sounds` | Add, remove, or switch between custom sound files. Toggle random mode. |
| `Agent Bell: Add Sound File` | Browse and add a sound file (.wav / .mp3 / .aiff). |
| `Agent Bell: Show Alert History` | View the last 50 alerts this session (time, source, what triggered). |

---

## Settings

Open Settings and search **"Agent Bell"**, or edit `settings.json`:

| Setting | Default | Description |
|---|---|---|
| `agentConfirmSound.enabled` | `true` | Turn terminal watching on/off. |
| `agentConfirmSound.patterns` | *(see below)* | Case-insensitive regex array matched against terminal output. |
| `agentConfirmSound.terminalNameFilter` | `[]` | Only watch terminals whose name contains one of these strings. Empty = watch all. |
| `agentConfirmSound.sounds` | `[]` | List of sound files for multi-sound mode. Empty = bundled sound. |
| `agentConfirmSound.soundMode` | `"fixed"` | `"fixed"` plays the first sound in the list. `"random"` picks one at random each time. |
| `agentConfirmSound.debounceMs` | `4000` | Minimum ms between alerts per terminal. |
| `agentConfirmSound.volume` | `1` | Volume 0–1. Applied via afplay (macOS), paplay (Linux), and WAV sample scaling (Windows). |
| `agentConfirmSound.focusTerminal` | `false` | Auto-focus the matching terminal when an alert fires. |
| `agentConfirmSound.alertOnCommandEnd` | `true` | Play a sound when any terminal command finishes (respects `commandEndMinDurationMs`). |
| `agentConfirmSound.commandEndMinDurationMs` | `3000` | Minimum command duration before the "command finished" alert fires. Quick commands like `ls` are ignored. |
| `agentConfirmSound.osNotification` | `true` | Show an OS-level notification when an alert fires and VS Code is not focused. |
| `agentConfirmSound.hookPreToolUse` | `false` | Also install a PreToolUse(Bash) hook. Only useful if you run Claude Code with manual bash approval. |
| `agentConfirmSound.reminderIntervalMs` | `0` | Re-alert after this many ms if you haven't responded. `0` = disabled. Example: `120000` (2 min). Cancelled automatically when you run a command in the waiting terminal. |
| `agentConfirmSound.reminderMaxCount` | `3` | Maximum reminders before stopping. Only applies when `reminderIntervalMs > 0`. |
| `agentConfirmSound.debugLog` | `false` | Log every terminal chunk to the output channel. Use this to tune patterns. Disable when done. |

### Multi-sound setup

Add multiple sound files and rotate through them randomly:

```json
"agentConfirmSound.sounds": [
  "/Users/you/sounds/ping.wav",
  "/Users/you/sounds/chime.wav"
],
"agentConfirmSound.soundMode": "random"
```

Or use **Agent Bell: Manage Sounds** from the Command Palette for a UI.

### Default patterns

```json
"agentConfirmSound.patterns": [
  "\\(y\\s*/\\s*n\\)",
  "\\[y\\s*/\\s*n\\]",
  "\\(Y\\s*/\\s*n\\)",
  "\\[Y\\s*/\\s*n\\]",
  "do you want to proceed",
  "do you want to continue",
  "allow this (action|command|tool)",
  "would you like to proceed",
  "press enter to confirm",
  "confirm\\?\\s*$",
  "proceed\\?\\s*$",
  "continue\\?\\s*$",
  "\\(yes/no\\)",
  "type ['\"]?yes['\"]? to continue",
  "allow (read|write|execute|bash|edit|create|delete|tool)",
  "do you want claude",
  "waiting for (your )?input",
  "execute.*\\?",
  "overwrite.*\\?",
  "enter (your )?choice"
]
```

Patterns that were removed because they matched normal informational output:
- `"approve|reject.*action"` — the bare word `approve` matched too broadly
- `"tool (call|use|request)"` — fired on Claude Code's own log lines
- `"run this command"` — fired on "I'll run this command: …" narration

### Watch only Claude Code terminals

```json
"agentConfirmSound.terminalNameFilter": ["claude"]
```

### Custom sound at lower volume

```json
"agentConfirmSound.sounds": ["/Users/you/sounds/ping.wav"],
"agentConfirmSound.volume": 0.5
```

---

## Tuning patterns for your agent

Every agent phrases prompts differently. To find what text your agent actually outputs:

1. Enable debug mode: `"agentConfirmSound.debugLog": true`
2. Open **Agent Bell: Show Log**
3. Trigger a prompt in your agent
4. Copy the `[debug]` line text
5. Run **Agent Bell: Test Pattern** and paste it — it will tell you which pattern matched (or not)
6. Adjust your `agentConfirmSound.patterns` to match
7. Disable debug mode when done

---

## Limitations

- Terminal watching requires shell integration. Full-screen TUI apps that repaint the screen (like Claude Code CLI in interactive mode) may not expose clean text through the shell integration API — use the Claude Code hook integration instead.
- Claude Code's `PreToolUse` hook fires before every bash command, not just approval prompts. If bash is auto-approved, enabling `hookPreToolUse` will trigger a sound on every command.
- Volume scaling only applies to uncompressed 16-bit PCM WAV files. MP3 and other formats play at their encoded volume.
- The Claude Code hook integration requires Claude Code to be installed (`~/.claude/` must exist).

---

## Contributing

[github.com/chahe-dridi/vscode-agent-bell](https://github.com/chahe-dridi/vscode-agent-bell)

Issues and pull requests welcome.

### Local development

```bash
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

To package and install locally:

```bash
npm run package
code --install-extension dist/agent-confirm-sound-<version>.vsix
```

<div align="center">

# 🔔 Notification Bell

**Never miss an AI agent waiting on you again.**

[![Version](https://img.shields.io/visual-studio-marketplace/v/chahe-dridi.agent-confirm-sound?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=chahe-dridi.agent-confirm-sound)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/chahe-dridi.agent-confirm-sound?color=brightgreen)](https://marketplace.visualstudio.com/items?itemName=chahe-dridi.agent-confirm-sound)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/chahe-dridi.agent-confirm-sound)](https://marketplace.visualstudio.com/items?itemName=chahe-dridi.agent-confirm-sound)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)
[![GitHub Stars](https://img.shields.io/github/stars/chahe-dridi/vscode-agent-bell?style=social)](https://github.com/chahe-dridi/vscode-agent-bell)

Notification Bell watches your VS Code integrated terminals and **plays a sound** the moment an AI agent needs your attention — whether it's waiting for confirmation, asking to run a command, or finished its turn.

Works with **Claude Code**, **aider**, **Cursor CLI**, and any other terminal-based AI agent.

[Install from Marketplace](#installation) · [Claude Code Setup](#claude-code-integration) · [Configuration](#settings) · [Contributing](#contributing)

</div>

---

## Why Notification Bell?

When AI agents run long tasks, you switch to another window — and miss the moment they stop to ask you something. Notification Bell closes that gap:

- **Sound + OS notification** the instant an agent needs input
- **Status bar badge** showing how many alerts fired this session (`🔔 7`)
- **Reminder escalation** if you still haven't responded after N minutes
- **Two detection paths** — Claude Code hooks (no shell integration needed) and terminal pattern matching for everything else
- **Zero configuration** to get started — sensible defaults out of the box

---

## Installation

Search **"Notification Bell"** in the VS Code Extensions view (`Ctrl+Shift+X`), or install from the terminal:

```bash
code --install-extension chahe-dridi.agent-confirm-sound
```

---

## Claude Code integration

On first install, Notification Bell offers to set up a direct integration with Claude Code. Accept the prompt and it will:

1. Copy the notification sound to `~/.claude/agent-bell-notify.wav` (a stable path that survives extension updates)
2. Add two hooks to `~/.claude/settings.json`:

| Hook | Fires when |
|---|---|
| `Stop` | Claude finishes its turn and is waiting for your next message |
| `Notification` | Claude Code sends a background notification (e.g. window not focused) |

These hooks fire directly from Claude Code's process — **they work even if VS Code is not in focus**. Each hook also writes a signal to `~/.claude/agent-bell-signal` so the extension can flash the status bar and show an OS notification inside VS Code, bridging the hook path back into the visual UI.

**To set up manually:**
`Ctrl+Shift+P` → `Notification Bell: Set Up Claude Code Integration`

**To remove:**
`Ctrl+Shift+P` → `Notification Bell: Remove Claude Code Integration`

> **PreToolUse hook:** If you run Claude Code with manual bash approval (`requiresApproval`), enable `agentConfirmSound.hookPreToolUse: true` and reinstall. Leave it off if bash is auto-approved — it would fire on every command.

> **Before uninstalling:** run `Notification Bell: Remove Claude Code Integration` first to clean up hooks and the copied sound file from `~/.claude/`.

> **Privacy:** Notification Bell only writes to your local `~/.claude/settings.json`. No data is read, collected, or sent anywhere.

---

## Terminal watching (other agents)

For agents running in a standard VS Code terminal — aider, custom scripts, etc. — Notification Bell watches terminal output and plays a sound when a line matches a configured regex pattern, such as `(y/n)`, `Allow this action?`, or `Press enter to confirm`.

> Requires shell integration, which is on by default for bash, zsh, fish, and PowerShell in recent VS Code. A small decoration appears to the left of your prompt when it's active.

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

| | Feature |
|---|---|
| 🔊 | Sound alert on any configurable regex pattern in terminal output |
| 🪝 | Claude Code hook integration — works without shell integration |
| ⏱️ | Alert when long-running commands finish (configurable minimum duration) |
| 🔔 | Status bar badge showing session alert count — flashes on alert |
| 🖥️ | OS-level notification when VS Code is not focused (Windows / macOS / Linux) |
| 🔁 | Reminder escalation — re-alerts after N minutes if you haven't responded |
| 🎵 | Two bundled sounds + support for custom files with random or fixed mode |
| 🔉 | Volume control on all platforms (afplay / paplay / WAV sample scaling) |
| 🔍 | Terminal name filter — watch only terminals named "claude" or "aider" |
| 🧪 | Pattern tester — paste terminal output and see which pattern matched (copies match to clipboard) |
| 📋 | Alert history — last 50 alerts with time, source, and trigger |
| 🛠️ | Reset to Defaults command |
| 🌍 | Cross-platform — macOS, Windows, Linux |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and search "Notification Bell":

| Command | Description |
|---|---|
| `Notification Bell: Toggle Watching` | Pause or resume terminal watching (also via status bar click). |
| `Notification Bell: Play Test Sound` | Play the alert sound immediately to verify audio works. |
| `Notification Bell: Show Log` | Open the output channel for match logs and debug info. |
| `Notification Bell: Test Pattern` | Enter terminal output — see which pattern matched (copies the regex to clipboard). |
| `Notification Bell: Set Up Claude Code Integration` | Install Stop + Notification hooks into `~/.claude/settings.json`. |
| `Notification Bell: Remove Claude Code Integration` | Remove hooks and delete the copied sound file. Run this before uninstalling. |
| `Notification Bell: Manage Sounds` | Switch between bundled sounds, add custom files, toggle random mode. |
| `Notification Bell: Add Sound File` | Browse and add a sound file (.wav / .mp3 / .aiff). |
| `Notification Bell: Show Alert History` | View the last 50 alerts this session (time, source, what triggered). |
| `Notification Bell: Reset to Defaults` | Reset all Notification Bell settings to their defaults. |

---

## Settings

Open Settings (`Ctrl+,`) and search **"Notification Bell"**, or edit `settings.json` directly:

| Setting | Default | Description |
|---|---|---|
| `agentConfirmSound.enabled` | `true` | Turn terminal watching on/off. |
| `agentConfirmSound.patterns` | *(see below)* | Case-insensitive regex array matched against terminal output. |
| `agentConfirmSound.terminalNameFilter` | `[]` | Only watch terminals whose name contains one of these strings. Empty = watch all. |
| `agentConfirmSound.sounds` | `[]` | List of sound file paths. Empty = use bundled sound. |
| `agentConfirmSound.soundMode` | `"fixed"` | `"fixed"` uses the first sound. `"random"` picks one at random each alert. |
| `agentConfirmSound.debounceMs` | `4000` | Minimum ms between alerts per terminal (prevents spam on the same prompt). |
| `agentConfirmSound.volume` | `1` | Volume 0–1. Applied via afplay (macOS), paplay (Linux), WAV sample scaling (Windows). |
| `agentConfirmSound.focusTerminal` | `false` | Auto-focus the matching terminal when an alert fires. |
| `agentConfirmSound.alertOnCommandEnd` | `true` | Play a sound when any long-running terminal command finishes. |
| `agentConfirmSound.commandEndMinDurationMs` | `3000` | Minimum command duration (ms) before "command finished" fires. Quick commands like `ls` are ignored. |
| `agentConfirmSound.osNotification` | `true` | Show an OS-level notification when VS Code is not focused. |
| `agentConfirmSound.hookPreToolUse` | `false` | Also fire on Claude Code's PreToolUse(Bash) hook. Only useful with manual bash approval. |
| `agentConfirmSound.reminderIntervalMs` | `0` | Re-alert after this many ms if you haven't responded. `0` = disabled. |
| `agentConfirmSound.reminderMaxCount` | `3` | Maximum number of reminders before stopping. |
| `agentConfirmSound.debugLog` | `false` | Log every terminal chunk to the output channel. Use to tune patterns — disable when done. |

### Bundled sounds

Two sounds ship with the extension, selectable from **Notification Bell: Manage Sounds**:

- **`notify.wav`** — short, crisp chime (default)
- **`notification-bell.mp3`** — fuller bell tone

No configuration needed — open the command and click to switch.

### Multi-sound setup

Add your own files and rotate through them randomly:

```json
"agentConfirmSound.sounds": [
  "/Users/you/sounds/ping.wav",
  "/Users/you/sounds/chime.wav"
],
"agentConfirmSound.soundMode": "random"
```

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
  "enter (your )?choice",
  "are you sure\\?",
  "\\[A\\]llow",
  "press any key"
]
```

> Patterns removed for causing false positives: `"approve|reject.*action"` (bare word too broad), `"tool (call|use|request)"` (fired on Claude's log lines), `"run this command"` (fired on narration).

### Common configuration examples

**Watch only Claude Code terminals:**
```json
"agentConfirmSound.terminalNameFilter": ["claude"]
```

**Custom sound at lower volume:**
```json
"agentConfirmSound.sounds": ["/Users/you/sounds/ping.wav"],
"agentConfirmSound.volume": 0.5
```

**2-minute reminders, up to 3 times:**
```json
"agentConfirmSound.reminderIntervalMs": 120000,
"agentConfirmSound.reminderMaxCount": 3
```

---

## Tuning patterns for your agent

Every agent phrases prompts differently. To find the exact text your agent outputs:

1. Set `"agentConfirmSound.debugLog": true`
2. Open **Notification Bell: Show Log**
3. Trigger a prompt in your agent
4. Copy the `[debug]` line
5. Run **Notification Bell: Test Pattern** and paste it — it shows which pattern matched and copies the regex to your clipboard
6. Paste directly into `agentConfirmSound.patterns` in `settings.json`
7. Set `"agentConfirmSound.debugLog": false` when done

---

## Limitations

- Terminal watching requires shell integration. Full-screen TUI apps that repaint the terminal (like Claude Code CLI in interactive mode) may not expose clean text — use the Claude Code hook integration instead.
- `PreToolUse` fires before **every** bash command, not just approval prompts. Leave `hookPreToolUse` off unless you use manual approval mode.
- Volume scaling only applies to uncompressed 16-bit PCM WAV files. MP3 and other formats play at their encoded volume.
- Claude Code hook integration requires Claude Code to be installed (`~/.claude/` must exist).

---

## Support the project

If Notification Bell saves you from missing a prompt, a ⭐ on GitHub helps others find it and motivates continued development.

**[⭐ Star on GitHub](https://github.com/chahe-dridi/vscode-agent-bell)**

---

## Contributing

Found a bug or want to add support for a new agent? Contributions are welcome.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide — branch strategy, pattern rules, and how to set up the dev environment.

Look for [`good first issue`](https://github.com/chahe-dridi/vscode-agent-bell/issues?q=is%3Aopen+label%3A%22good+first+issue%22) labels if it's your first contribution.

**Branch strategy:** open all PRs against `dev`, not `master`. `master` is the stable marketplace branch.

```bash
git clone https://github.com/chahe-dridi/vscode-agent-bell.git
cd vscode-agent-bell
git checkout dev
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

```bash
# Build and install locally
npm run package
code --install-extension dist/agent-confirm-sound-<version>.vsix --force
```

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

> **Note on permission dialogs:** Claude Code's permission prompts ("Allow bash command?") are part of the interactive UI and do not fire a hook event. The Stop hook covers the most common case — Claude finishing its turn.

> **Privacy note:** Agent Bell only writes to your local `~/.claude/settings.json`. No data is read, collected, or sent anywhere. You can review or remove the hooks at any time via the commands below.

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
        ├── Stop         → sound when Claude finishes its turn
        └── Notification → sound when Claude sends a background notification

Other terminal agents (aider, scripts, etc.)
  └── VS Code shell integration API
        └── pattern match on terminal output → sound
```

---

## Features

- Claude Code hook integration — works even without shell integration
- Sound alert on any configurable regex pattern in terminal output
- Status bar indicator — flashes on alert, click to pause/resume
- Multi-sound support — add your own files and use random or fixed mode
- Auto-focus the matching terminal when an alert fires (optional)
- Volume control (macOS and Linux)
- Terminal name filter — watch only terminals named "claude" or "aider"
- Per-terminal debounce — one alert per prompt
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

---

## Settings

Open Settings and search **"Agent Bell"**, or edit `settings.json`:

| Setting | Default | Description |
|---|---|---|
| `agentConfirmSound.enabled` | `true` | Turn terminal watching on/off. |
| `agentConfirmSound.patterns` | *(see below)* | Case-insensitive regex array matched against terminal output. |
| `agentConfirmSound.terminalNameFilter` | `[]` | Only watch terminals whose name contains one of these strings. Empty = watch all. |
| `agentConfirmSound.soundPath` | `""` | Absolute path to a custom sound file. Empty = bundled sound. |
| `agentConfirmSound.sounds` | `[]` | List of sound files for multi-sound mode. Empty = bundled sound. |
| `agentConfirmSound.soundMode` | `"fixed"` | `"fixed"` plays the first sound in the list. `"random"` picks one at random each time. |
| `agentConfirmSound.debounceMs` | `4000` | Minimum ms between alerts per terminal. |
| `agentConfirmSound.volume` | `1` | Volume 0–1 (macOS / Linux only). |
| `agentConfirmSound.focusTerminal` | `false` | Auto-focus the matching terminal when an alert fires. |
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
  "\\[Y\\s*/\\s*n\\]",
  "do you want to proceed",
  "do you want to continue",
  "allow this (action|command|tool)",
  "allow (read|write|execute|bash|edit|create|delete|tool)",
  "would you like to proceed",
  "press enter to confirm",
  "confirm\\?\\s*$",
  "proceed\\?\\s*$",
  "\\(yes/no\\)",
  "type ['\"]?yes['\"]? to continue",
  "do you want claude",
  "approve|reject.*action",
  "waiting for (your )?input",
  "tool (call|use|request)",
  "run this command",
  "execute.*\\?"
]
```

### Watch only Claude Code terminals

```json
"agentConfirmSound.terminalNameFilter": ["claude"]
```

### Custom sound and lower volume

```json
"agentConfirmSound.soundPath": "/Users/you/sounds/ping.wav",
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
- Claude Code permission dialogs ("Allow bash command?") do not trigger a hookable event — only the `Stop` event (turn complete) and `Notification` event (background notification) are available.
- Windows volume control is not supported — `Media.SoundPlayer` has no volume API. Use a pre-normalised custom sound file instead.
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

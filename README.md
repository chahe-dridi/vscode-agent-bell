# Agent Bell

**Never miss an AI agent waiting on you again.**

Agent Bell watches your VS Code integrated terminals and plays a sound the moment an AI agent pauses and asks for your confirmation — so you can multitask freely without constantly glancing back at the terminal.

Works with Claude Code, aider, Cursor CLI, and any other terminal-based AI agent that prompts with `(y/n)`, `Allow this action?`, `Press enter to confirm`, etc.

---

## Installation

Search **"Agent Bell"** in the VS Code Extensions view, or install from the terminal:

```bash
code --install-extension chahe-dridi.agent-confirm-sound
```

---

## How it works

VS Code's **shell integration API** lets extensions read terminal output as it streams in. Agent Bell watches every terminal, checks each chunk of output against a configurable list of regex patterns, and plays a short sound the first time a pattern matches. A per-terminal debounce prevents sound spam on repeated prompts.

> **Note:** Shell integration must be active in the terminal. It's on by default for bash, zsh, fish, and PowerShell in recent VS Code — you'll see a small colored decoration to the left of your prompt when it's active. Terminals without shell integration can't be watched; Agent Bell logs a note about them to its output channel.

---

## Features

- Sound alert on any configurable regex pattern
- Status bar mute toggle — click `$(bell) Agent Bell: On` to mute/unmute instantly
- Per-terminal debounce — one sound per prompt, not one per output chunk
- Custom sound file — point it at any `.wav` / `.mp3` / `.aiff` on your machine
- Volume control — 0.0 to 1.0 (macOS and Linux)
- Terminal name filter — watch only terminals named "claude" or "aider", ignore the rest
- Cross-platform — macOS (`afplay`), Windows (PowerShell `SoundPlayer`), Linux (`paplay` / `aplay`)

---

## Settings

Open Settings and search **"Agent Bell"**, or edit `settings.json` directly:

| Setting | Default | Description |
|---|---|---|
| `agentConfirmSound.enabled` | `true` | Turn watching on/off entirely. |
| `agentConfirmSound.patterns` | *(see below)* | Case-insensitive regex array matched against terminal output. |
| `agentConfirmSound.terminalNameFilter` | `[]` | Only watch terminals whose name contains one of these strings. Empty = watch all. |
| `agentConfirmSound.soundPath` | `""` | Absolute path to a custom sound file. Empty = bundled sound. |
| `agentConfirmSound.debounceMs` | `4000` | Minimum ms between sounds per terminal. |
| `agentConfirmSound.volume` | `1` | Volume from 0 to 1 (macOS / Linux only). |

### Default patterns

```json
"agentConfirmSound.patterns": [
  "\\(y\\s*/\\s*n\\)",
  "\\[Y\\s*/\\s*n\\]",
  "do you want to proceed",
  "do you want to continue",
  "allow this (action|command|tool)",
  "allow (read|write|execute|bash|edit|create|delete)",
  "would you like to proceed",
  "press enter to confirm",
  "confirm\\?\\s*$",
  "proceed\\?\\s*$",
  "\\(yes/no\\)",
  "type ['\"]?yes['\"]? to continue",
  "do you want claude"
]
```

Every agent phrases prompts slightly differently. Open the output channel (**Agent Bell: Show Log** from the Command Palette) to see what text is actually coming through, then tune patterns to match.

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

## Commands

| Command | Description |
|---|---|
| `Agent Bell: Toggle Mute` | Mute or unmute (also via the status bar). |
| `Agent Bell: Play Test Sound` | Fire the sound immediately to verify your setup. |
| `Agent Bell: Show Log` | Open the output channel to see match logs and debug info. |

---

## Limitations

- Requires shell integration to be active. Full-screen TUI apps that repaint the whole screen may not expose clean matchable text.
- Windows volume control is not supported — `Media.SoundPlayer` has no volume API. Use a pre-normalised custom sound file instead.
- If playback fails, check **Agent Bell: Show Log** for details.

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

Run **Agent Bell: Play Test Sound** from the Command Palette to verify audio, or trigger a pattern match in a terminal:

```bash
read -p "Allow this action? (y/n) " ans
```

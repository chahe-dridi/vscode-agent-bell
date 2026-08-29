# Contributing to Notification Bell

Thanks for helping make Notification Bell better. This document covers how to set up the project, how branches work, and where to find good first issues.

---

## Branch strategy

```
master  ← stable, published to the VS Code marketplace
  ↑
  dev   ← integration branch, all PRs land here first
  ↑
  feature/your-thing   ← one branch per issue
```

- **Never push directly to `master`.**
- Open a PR against **`dev`**, not `master`.
- When `dev` is stable and tested, a maintainer merges `dev` → `master` and publishes a new marketplace release.

---

## Getting started

```bash
git clone https://github.com/chahe-dridi/vscode-agent-bell.git
cd vscode-agent-bell
git checkout dev          # always branch off dev
git checkout -b feature/your-branch-name

npm install
npm run compile           # compile TypeScript
```

Press **F5** in VS Code to launch the Extension Development Host with your changes live.

To test a pattern change without F5:

```
Ctrl+Shift+P → Notification Bell: Test Pattern
```

---

## Making changes

1. Pick an issue from the [issues list](https://github.com/chahe-dridi/vscode-agent-bell/issues) — look for **`good first issue`** if it's your first contribution.
2. Comment on the issue so others know it's taken.
3. Branch off `dev`:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b fix/issue-42-my-fix
   ```
4. Make your change and compile:
   ```bash
   npm run compile
   ```
5. Test manually (F5 → Extension Development Host).
6. Open a PR against **`dev`** with:
   - A clear title
   - `Fixes #<issue number>` in the body
   - A short description of what you changed and how you tested it

---

## Adding detection patterns

Patterns live in the `"default"` array of `agentConfirmSound.patterns` in [package.json](package.json). Each entry is a **case-insensitive regex**.

Before adding a pattern:

1. Enable debug mode: `"agentConfirmSound.debugLog": true`
2. Open **Notification Bell: Show Log**
3. Trigger the prompt in your agent
4. Copy the raw text from the `[debug]` line
5. Run **Notification Bell: Test Pattern** to verify the match

Rules for new patterns:
- Must end with `\?` or a similar delimiter — bare words like `approve` are too broad and cause false positives.
- Must not match normal informational output (e.g. "I'll run this command: …").
- Add a comment in the PR explaining which agent/tool produces this prompt.

---

## Adding support for a new agent

Each new agent type needs:

1. **Patterns** — regex entries in `agentConfirmSound.patterns` default list (if the agent uses a terminal).
2. **Hook integration** (optional) — if the agent exposes lifecycle hooks (like Claude Code's `Stop`/`Notification`), add a new command to install them and document it.
3. **README entry** — add the agent name to the "Works with" line and the terminal watching section.

---

## Code style

- TypeScript, strict mode.
- No new dependencies — the extension has zero runtime deps intentionally.
- No comments explaining *what* the code does; only *why* if non-obvious.
- Run `npm run compile` before committing — the CI check will catch type errors.

---

## Building a VSIX for local testing

```bash
npm run package
code --install-extension dist/agent-confirm-sound-<version>.vsix --force
```

---

## Questions

Open a [GitHub Discussion](https://github.com/chahe-dridi/vscode-agent-bell/discussions) or comment on the relevant issue.

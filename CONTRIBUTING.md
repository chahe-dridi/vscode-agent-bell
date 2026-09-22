# Contributing to Notification Bell

Thanks for helping make Notification Bell better. This document covers how to set up the project, how branches work, what the CI checks, and where to find good first issues.

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
npm test                  # compile and run terminal-mute regression tests
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
6. Bump the version in `package.json` (patch `x.x.N` for fixes, minor `x.N.0` for new features).
7. Add a `## [x.x.x] — YYYY-MM-DD` entry to `CHANGELOG.md` describing your change.
8. Open a PR against **`dev`** with:
   - A clear title using `feat:`, `fix:`, or `chore:` prefix
   - `Fixes #<issue number>` in the body
   - A short description of what you changed and how you tested it

---

## CI checks

Every PR runs the following checks automatically. All must pass before a maintainer will review:

| Check | What it verifies |
|---|---|
| **TypeScript compile** | `npm run compile` passes with no errors |
| **No dist/ files** | `dist/*.vsix` must not be committed — they are gitignored |
| **No console.log** | Use `outputChannel.appendLine()` instead |
| **No network calls** | Extension must be fully local — no `fetch`, `http`, `axios`, etc. |
| **No runtime dependencies** | `package.json` `dependencies` must remain empty |
| **npm audit** | No known vulnerabilities at moderate severity or above |
| **Version bumped** | `package.json` version must differ from the base branch |
| **CHANGELOG entry** | `CHANGELOG.md` must have a `## [x.x.x]` entry matching the new version |
| **Lock file in sync** | If `package.json` changed, `package-lock.json` must also be updated |
| **No breaking changes** | Removed commands or settings fail automatically |
| **VSIX size budget** | Built extension must stay under 2 MB |

**CodeQL** static analysis also runs on every PR to `master` and weekly, checking for injection patterns and unsafe code.

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
- No new runtime dependencies — the extension has zero intentionally. Dev-only tooling goes in `devDependencies`.
- Do not commit `dist/` files — they are gitignored. Build locally for testing only.
- No comments explaining *what* the code does; only *why* if non-obvious.
- Use `outputChannel.appendLine()` for all logging — never `console.log`.
- Run `npm run compile` before pushing — the CI will catch type errors but it's faster to catch them locally.

---

## Building a VSIX for local testing

```bash
npm run package
code --install-extension dist/agent-confirm-sound-<version>.vsix --force
```

The `dist/` folder is gitignored — do not commit the `.vsix` file.

---

## Questions

Open a [GitHub Discussion](https://github.com/chahe-dridi/vscode-agent-bell/discussions) or comment on the relevant issue.

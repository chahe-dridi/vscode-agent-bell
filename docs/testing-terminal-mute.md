# Terminal mute verification

Run `npm ci && npm test` for the regression suite. Tests execute the compiled extension with mocked VS Code events, filesystem, process spawning, and time. No extra test dependencies are needed.

## Live Extension Development Host checks

Launch this extension in VS Code and decline the optional Claude Code hook setup. Use two terminals named **Noisy watcher** and **Important build**, with shell integration enabled.

1. Select Noisy watcher and run **Notification Bell: Mute This Terminal**.
2. In Noisy watcher, run `printf 'Continue (y/n)\n'; sleep 4`. Expect no alert or history entry.
3. Run the same command in Important build. Expect one prompt alert from Important build. The status bar tooltip should still list Noisy watcher as muted.
4. In Important build, run `sleep 4`. Expect a command-completion alert.
5. Select Noisy watcher, run **Unmute This Terminal**, and repeat both commands. Expect prompt and completion alerts again.
6. Mute Noisy watcher, close it, and open a new terminal with the same name. Expect it to alert normally.
7. With a pending reminder, mute its terminal. Expect that reminder to stop. Muting a different terminal must not cancel it.
8. Reload the extension host. Mutes should be cleared. Global pause, terminal-name filters, debounce, and alert-trigger settings must still apply.

The commands affect terminal-watching alerts. Claude Code hooks do not identify a terminal and are not muted by these commands.

# Changelog

## Unreleased

- No changes yet.

## 0.3.0 - Redesign

### Added

- An update popup at launch when a newer Sable is on npm, with Update now to install it in one step; checked in the background at most once a day, and turned off with `SABLE_NO_UPDATE_CHECK=1`.
- A welcome screen for new users, and newly created workspaces now open straight away.
- When a new workspace has a `package.json`, Sable offers its scripts as services and one-shot commands (npm, pnpm, yarn, or bun, picked from the lockfile).
- One form to add or edit a service, command, or workspace, with every field visible, inline validation, and environment variables.
- Log search with `/` and `n`/`N`, `e` to jump to the next error line, and `w` to wrap long lines.
- Timestamps on every log line, a red bar for stderr, and divider lines where a process started or exited.

### Changed

- Every screen shares one frame: a header saying where you are, status symbols with words (`● running`, `○ stopped`, `✕ exited 1`, `✓ done`), and a `>` marker on the selected row so selection shows without color.
- The picker shows each workspace's folder and how many of its services are running.
- Running services and commands can now be edited; changes apply on the next restart.
- Help (`?`) and delete confirmations open as popups over the current screen, in the same box style as the update popup; deleting now says what is removed and that project files are untouched.
- Logs keep 2,000 lines per service instead of 200.

- Redesigned the keymap so the same key means the same thing on every screen: `s` starts or stops the selected item, `a` adds a workspace in the picker (was `c`), and `m` enters a move mode for reordering (was `J`/`K`).
- `q` in logs and help now goes back instead of quitting Sable; `Esc` and `q` always go back one level, and `Ctrl+C` still quits from anywhere.
- Footers now show only the keys that work for the selected item, drawn as key chips (`[s] start` without color), with arrow keys instead of `j/k`.
- The old `S`, `J`/`K`, `c`, `j`/`k` and `h`/`l` keys still work but are hidden from hints; they will be removed in 0.4.0.

### Removed

- Command mode (`:`); its only commands duplicated `?` and `q`.

### Hardened

- Workspaces now run from anywhere even when a service's folder in `workspaces.json` is relative (like `"."`): it is resolved against the workspace's project folder, not the folder you started `sable` in.
- Workspace details (`v`) now list commands as well as services.
- Key hints are shortened to fit narrow terminals instead of wrapping.

## 0.2.3 - Reliability patch

### Changed

- Restarting a workspace from the picker restarts its services only; one-shot commands are no longer re-run.

### Hardened

- Deleting the running workspace from the picker is refused with a message until it is stopped, so its processes can no longer be orphaned.
- Invalid or unparsable config files now print a readable error (with the file path and validation issues) instead of a stack trace.
- Config save or reload failures during picker and dashboard actions show a status message and keep the TUI and running services alive.
- Processes that fail to stop are reported: the picker status names them, and Sable prints a warning with their pid when it exits.
- Pasting text into prompts and command mode now keeps every character instead of only the first.

## 0.2.2 - Publish prep

- Renamed the npm package to `sable-workspaces` for public publishing while keeping the CLI binary as `sable`.
- Added MIT licensing and npm package metadata.
- Added a `prepublishOnly` verification script.

## 0.2.1 - Stability patch

### Hardened

- Fixed restart behavior when stopping a service fails, avoiding duplicate replacement processes.
- Preserved failed service state when a process exits after a failed stop attempt.
- Cleaned up temporary config files when atomic config save fails.
- Cleared pending dashboard pulse timers on exit to avoid delayed redraws.

## 0.2.0 - Daily-use checkpoint

### Added

- Workspace rename from the home picker.
- Workspace reorder from the home picker with `K` / `J`.
- Service rename from the dashboard edit flow.
- Service deletion from the dashboard with typed-name confirmation.
- Service reorder from the dashboard with `K` / `J`.
- Wide dashboard log preview for the selected service, with a scrollable services viewport.
- One-shot workspace commands as dashboard items alongside services.
- Dashboard add, edit, delete, run, stop, output, and help behavior for commands.
- Horizontal logs/output scrolling for long lines with `h` / Left, `l` / Right, and `0` reset.
- Display-width-aware terminal layout for Unicode and wide characters.
- Subtle startup, selection, action, and logs reveal animations.

### Hardened

- Buffered split stdout/stderr chunks so partial process output is logged as complete lines when possible.
- Preserved failed service state when process synchronization observes an already-exited process.
- Validated package tarball installation from an isolated project before release.

## 0.1.0 - MVP release candidate

Sable 0.1.0 is the first MVP checkpoint for a keyboard-first terminal workspace manager.

### Added

- No-argument `sable` home picker for selecting and managing saved workspaces.
- Workspace creation, listing, deletion, and run commands.
- Native picker flows for creating and deleting workspaces.
- Service dashboard for local workspace services.
- Direct selected-service actions: start, stop, restart, and logs.
- Dashboard service add/edit flows for stopped or failed services.
- In-memory stdout, stderr, and lifecycle log capture with bounded buffers.
- Logs view with scrolling and follow-tail behavior.
- Help overlay and minimal command mode with `:help` and `:quit`.
- Graceful shutdown paths for normal quit and Ctrl+C.

### Hardened

- Failed service details are shown concisely in the dashboard.
- `Esc` responsiveness improved for native terminal input.
- Workspace creation no longer crashes when the process current directory cannot be read; it falls back to the home directory.
- Terminal input cleanup is best-effort and continues if one cleanup step fails.
- Dashboard abort listeners are removed after key/refresh races to avoid buildup during long sessions.

### Known limitations

- Logs are not persisted to disk.
- No workspace rename/reorder commands yet.
- No command history or autocomplete.
- No mouse support.
- No theme system or visual customization.
- Not a task runner, tmux replacement, IDE, Docker/Kubernetes manager, SSH tool, plugin platform, file explorer, built-in editor, or AI feature.

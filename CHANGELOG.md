# Changelog

## Unreleased

### Added

- Start order: an item can wait for others. The add and edit form has a new **After** field: a list of the other services and commands where `Space` ticks the ones that must come first. A service is ready once it has stayed up for 5 seconds; a command is ready when it exits with code 0. Sable follows this order for auto-start services and for the new **`S`** key, which starts every service (and the commands they wait for). Held-back items show `◌ waiting for …`, and items whose prerequisite failed show `✕ skipped: …`. `s` on a waiting item cancels its start. Deleting an item removes it from the "After" lists of the items that waited for it.

- Shared workspaces: put a `sable.json` in a project and teammates get the same services and commands. Starting Sable in a folder with one (or pressing `i`) shows every command the file would run and creates the workspace only after you agree; Sable asks for the file's `{{PLACEHOLDER}}` values, which stay on your machine. Opening that workspace later compares the file with the one you approved and shows what changed before applying it. Changes you make here (`e`, or deleting an item) are kept when the file updates. `x` writes a `sable.json` for a workspace and keeps secret-looking values out of it. If an imported item fails, the status line explains likely causes (missing program, port in use, missing folder) and how to fix it on your machine.

- Saved logs: turn on **Save logs** in Settings (`,`) to also write each service's and command's output to a file in the config folder (`logs/<workspace>/<item>.log`, with timestamps), so it can be read after Sable closes or a service crashes. It is off by default. Each file is kept to 2 MB (the previous one is kept as `.log.1`), and when you reopen an item's logs the output saved from the last run appears above the new output. When a log includes saved output from an earlier run (or lines from an earlier day), the logs view shows the month and day with each time.

### Changed

- Suggestions for a new workspace are no longer only for JavaScript: Sable also reads `Makefile` and `justfile` targets, Docker Compose files, `Cargo.toml`, `go.mod`, Django (`manage.py`), pytest, Rails and Laravel, and merges what it finds into one checklist (names like `make build`, `cargo run`). Only the first service of each file is ticked to begin with. The checklist scrolls when the list is longer than the terminal.
- The workspace file (`workspaces.json`) now keeps services and commands in one `items` list and has `"version": 2`. Sable converts an older file the first time it reads it and keeps a copy of the original next to it as `workspaces.json.bak-0.3`. Older Sable versions can't read the new file; to go back, restore that copy.

## 0.3.3 - Tweaks

### Added

- Command suggestions: while you type a command for a service or command, Sable shows the rest of a command you saved before, from this workspace first and then your other workspaces. Press `→` to accept it, or `↑` / `↓` to step through other matches.

### Changed

- The welcome screen now shows on every launch (it was once a day). Turn it off with the new "Welcome screen" row in Settings (`,`, then `↑↓` and `Space`) to go straight to your workspaces; the new-version popup still appears first when there is an update.
- The Settings popup keeps the same size whichever setting is selected.
- Sable now checks for a new version at most once an hour (it was once a day), so a release reaches you sooner.

### Fixed

- Resizing the terminal window now redraws the screen at the new size instead of leaving torn or stale text until the next key press.

### Removed

- The hidden pre-0.3 keys: `j`/`k` (use `↑↓`), `h`/`l` in logs (use `←→`), `S` (use `s`), `c` (use `a`), and `J`/`K` (use `m` to move).

## 0.3.2 - Polish

### Added

- Soft sounds, on by default: a quiet tick as you move, tones when you open, go back, start and stop things, and a calm chime when a service or command ends on its own (not when you stop it). Press `,` on the picker or dashboard to open the settings popup and turn sound off; the choice is remembered in `settings.json`. On Linux (including WSL) Sable keeps one audio stream open (`pacat`, `paplay`, `pw-cat` or `aplay`) so every sound starts with the same short delay. On macOS and Windows it plays small files with `afplay` or PowerShell, which can start a little later. If no player works, Sable stays silent.
- The launch screen shows the version and a one-line summary of your workspaces. The logo builds up dot by dot with a brief glow, and the first launch each day shows it in full while later launches show a short version. Any key skips it.

### Fixed

- A workspace you left with no running services now shows `○ stopped` in the picker instead of `● running`.

## 0.3.1 - Stability

### Added

- Folder fields (workspace folder, service directory) suggest the rest of the path as you type. `→` accepts it, `↑`/`↓` step through other matching folders, and `Tab` moves to the next field.
- A "Stopping..." / "Restarting..." message while a service shuts down.

### Changed

- Programs are asked for colour (`FORCE_COLOR=1`) unless `NO_COLOR` is set; your own environment still wins. Their colours now show in the logs view.
- Logs are capped at about 2 million characters per service as well as 2,000 lines.
- Sable on Windows and macOS is now tested in CI (Node 20 and 22), not only on Linux.

### Hardened

- Output from programs is sanitised: colours are kept, but screen clears, cursor moves, title changes and other control sequences are dropped, and a `\r` progress bar keeps only its last frame. A `tsc --watch` or vite service can no longer scramble the dashboard.
- Starting a service whose folder no longer exists now says which folder is missing.
- Saving a workspace no longer overwrites changes another Sable instance made to other workspaces.
- Closing the terminal window (`SIGHUP`) now stops your services like Ctrl+C does.
- Every screen now fits narrow terminals, and the help popup fits short ones.
- `sable` and `sable run` explain that they need an interactive terminal when input or output is piped, instead of hanging.
- The update check no longer stops checking if the cached check time is in the future.

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

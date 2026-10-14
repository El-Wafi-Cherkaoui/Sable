# Sable guide

Everything Sable does, screen by screen. For a quick overview, see the [README](../README.md). For sharing a workspace with your team, see [Sharing with sable.json](sharing.md).

- [Workspaces](#workspaces)
- [Suggestions for a new workspace](#suggestions-for-a-new-workspace)
- [The dashboard](#the-dashboard)
- [Start order](#start-order)
- [Logs](#logs)
- [Saved logs](#saved-logs)
- [Settings](#settings)
- [Updates](#updates)
- [Configuration](#configuration)
- [Keys](#keys)

## Workspaces

A workspace is a project folder plus the things you run in it:

- **Services** keep running, like a dev server, a database or a worker.
- **Commands** run once, like a migration, a build or the tests.

Run `sable` to open the workspace list. Press `a` to add a workspace. Sable asks for the project folder, then [suggests what to run](#suggestions-for-a-new-workspace). Each service and command can have its own working folder. Relative folders are resolved against the project folder, so the workspace runs the same way wherever you start Sable.

In folder fields, Sable suggests the rest of the path as you type. Press `→` to accept it, or `↑` / `↓` to step through other matching folders (`Tab` moves to the next field). The Command field works the same way with commands you saved before, starting with this workspace's and then those from your other workspaces.

Only one workspace runs at a time. Opening a different workspace stops the one that was running. Pressing `q` in a workspace takes you back to the list and keeps it running, marked `running`. Quitting Sable stops it.

Deleting a workspace asks you to type its name exactly.

Everything can be done from the workspace list, but a few commands skip it:

```sh
sable run <workspace>      # open one workspace directly; q quits
sable create <workspace>   # create a workspace
sable list                 # print your workspaces
sable delete <workspace>   # delete a workspace
```

## Suggestions for a new workspace

When you create a workspace in a folder, Sable looks through the folder and offers what it finds as one checklist (`↑↓` move, `Space` tick, `Enter` add). Services you tick start when the workspace opens; one-shot items become commands. Nothing is added until you press Enter, and everything can be changed later with `e`.

| Found | Offered |
| --- | --- |
| `package.json` | its scripts, run with npm, pnpm, yarn or bun (from the lockfile): `dev`, `build`, ... |
| `Makefile` | its targets as `make <target>` (up to 12) |
| `justfile` | recipes that take no arguments, as `just <recipe>` |
| `docker-compose.yml`, `compose.yaml` | `docker compose up`, and each service on its own |
| `Cargo.toml` | `cargo run` (if it has a program), `cargo test`, `cargo build` |
| `go.mod` | `go run .` (if there is a `main.go`), `go test ./...`, `go build ./...` |
| `manage.py` | Django's `runserver`, `migrate` and `test` |
| `pytest.ini`, or pytest mentioned in `pyproject.toml`, `tox.ini` or the requirements | `pytest` |
| Rails or Laravel app | the server, tests and migrations |

Only the first service from each file is ticked to begin with, so a project that lists the same dev server in two places doesn't start it twice. Names from files other than `package.json` start with the tool (`make build`, `cargo run`), so they never clash with each other.

## The dashboard

Opening a workspace shows its services and commands with their status:

| Symbol | Meaning |
| --- | --- |
| `● running` | the service or command is running |
| `○ stopped`, `○ idle` | not running |
| `✓ done` | the command finished successfully |
| `✕ exited 1`, `✕ failed` | it stopped with an error, or couldn't start |
| `◌ after db` | waiting for another item ([start order](#start-order)) |
| `✕ skipped` | not started, because something it waits for failed |

On wide terminals (100 columns or more), the latest output of the selected item appears beside the list. Press `Enter` to open its full logs.

`s` starts or stops the selected item (or runs a command), `r` restarts it, and `S` starts everything in order. `e` edits an item in one form: name, command, folder, environment variables, auto-start and what it waits for. You can edit an item while it runs; changes apply on its next restart.

## Start order

An item can wait for others. In the add or edit form, the **After** field lists the other services and commands. Move onto one and press `Space` to tick the ones that must come first, for example `db` for an API that needs its database. Items that already wait for this one are not offered, so you can't make a loop.

- A service counts as ready once it has stayed alive for 5 seconds.
- A command counts as ready when it exits with code 0, so `npm run build` can finish before `npm start` begins.
- Items that wait for nothing start together.

Sable follows this order when it opens a workspace (services and commands marked auto-start) and when you press `S` (every service, every auto-start command, and the commands they wait for). A command with **Auto-start** on runs by itself once what it waits for is up or done, for example a migration after `db`; without it, a command only runs when you press `r` (or when a service waits for it).

Items still held back show `◌ after db`. If something they wait for stops early or fails, they show `✕ skipped` and are not started; the preview and logs say why (`✕ skipped: db stopped early`). Press `s` on a waiting item to cancel its start. Starting one item with `s` or `r` always starts just that item.

Conditions belong in the command itself: `test -f dist/main.js || npm run build` only builds when the file is missing.

## Logs

Press `Enter` on an item to read its output. Every line has a timestamp, and lines a program writes to stderr are marked in red.

- `/` searches, then `n` / `N` step through the matches.
- `e` jumps to the next error (stderr) line.
- `w` wraps long lines, or lets you scroll them sideways with `←` / `→`.
- `G` jumps to the bottom and follows new output.

Sable keeps up to 2,000 lines (and about 2 million characters) per service or command in memory. It keeps a program's colors but drops other terminal control sequences (screen clears, cursor moves), so a noisy tool can't scramble the display. It asks programs for color unless `NO_COLOR` is set.

## Saved logs

By default logs live only in memory. Turn on **Save logs** in Settings (`,`) and Sable also writes everything each service or command prints to a file, so you can read it after Sable closes or after a crash. Nothing is written while it is off.

- Files are in the `logs/` folder of the config directory (shown in the Settings popup), one per item: `logs/<workspace>/api.log`, and `build.command.log` for a command.
- Each line has its time and stream: `2026-10-13T11:42:01.123Z [stderr] Error: ...`. They are plain text, so `grep`, `tail -f` and sharing work as usual.
- A file stops growing at 2 MB: it is renamed to `.log.1` (replacing the previous `.log.1`) and a new file starts, so an item uses at most about 4 MB.
- When you open an item's logs after restarting Sable, the last 300 saved lines from its previous run appear above the new output, after a line that says "saved output above, new output below". Whenever the logs include output from an earlier run or day, every line shows the month and day (`10-12 09:15:00`) so old and new output can be told apart.
- To delete saved logs, press `L` in a workspace (one item, or everything in that workspace) or in the workspace list (one workspace, or everything). The popup shows how much space each takes; `d` or `Enter` asks, and `Enter` again deletes. It works even while saving is off, for files saved earlier.
- If a file can't be written (disk full, no permission), Sable carries on without saving it.

Sable is not a log shipper or a service manager: this is a local convenience for development.

## Settings

Press `,` in the workspace list or a workspace to open Settings (`↑↓` to choose, `Space` to switch). Settings are saved in `settings.json` next to `workspaces.json`.

| Setting | Default | What it does |
| --- | --- | --- |
| Sound | on | Soft tones as you move, open and go back, start and stop things, and a chime when a service or command ends on its own. |
| Welcome screen | on | The logo that builds up dot by dot at launch, with the version and a summary of your workspaces. Any key skips it. |
| Save logs | off | Writes output to files. See [Saved logs](#saved-logs). |
| Tips | on | One-line tips under the workspace list, such as how to share a workspace. |

Sounds are played by [bellbird](https://www.npmjs.com/package/bellbird). `BELLBIRD=0` silences Sable whatever the setting says, and sound is off in CI unless `BELLBIRD=1`. If no audio player works on your system, Sable stays silent.

## Updates

At most once an hour, Sable asks the npm registry in the background whether a newer version exists. If one does, a popup appears at launch:

```text
╭─ Update available ──────────────────────────╮
│  Sable 0.4.0 is available. You have 0.3.0.  │
│                                             │
│  Update now closes Sable and runs:          │
│  npm install -g sable-workspaces@latest     │
│                                             │
│             OK     [Update now]             │
╰─────────────────────────────────────────────╯
```

Choose with `←` / `→` and press Enter. **Update now** closes Sable and runs the install in your terminal, so you can see npm's output; start `sable` again when it finishes. **OK** (or Esc) skips that version until a newer one is released.

The check never delays startup or quitting, never installs anything unless you choose Update now, and is silent when you are offline. It is skipped in CI and when output is not a terminal. To turn it off, set `SABLE_NO_UPDATE_CHECK=1` (or the common `NO_UPDATE_NOTIFIER=1`).

## Configuration

Workspaces are stored in `workspaces.json` in your user config directory:

| OS | Folder |
| --- | --- |
| Linux | `~/.config/sable-nodejs/` (or `$XDG_CONFIG_HOME/sable-nodejs/`) |
| macOS | `~/Library/Preferences/sable-nodejs/` |
| Windows | `%APPDATA%\sable-nodejs\Config\` |

Commands run through your shell, exactly as written. `workspaces.json` is trusted local configuration: only put commands in it that you would type yourself. A shared `sable.json` from someone else is treated differently: Sable shows you every command before anything runs (see [Sharing](sharing.md)).

**Upgrading from 0.3.** Sable 0.4 stores each workspace's services and commands in one `items` list (`"version": 2`). The first time it finds a 0.3 file, it keeps a copy next to it as `workspaces.json.bak-0.3`, converts the file and tells you once. Nothing is lost. If it can't make the copy or write the file (a read-only folder), it leaves your file alone and converts it later. Versions before 0.4 can't read the new format; to go back to one, put `workspaces.json.bak-0.3` back as `workspaces.json`.

## Keys

The footer on each screen shows the keys that work for what is selected. Press `?` anywhere for the full list. `Esc` and `q` always go back one level; `Ctrl+C` quits Sable from anywhere and stops everything.

### Workspace list

```text
↑ / ↓       select workspace
Enter       open selected workspace
a           add a workspace
i           set up a workspace from the sable.json in the folder Sable was started in
x           write a sable.json for the selected workspace, to share it
L           saved logs: see what is stored and delete it
e           rename selected workspace
d           delete selected workspace
m           move selected workspace (↑ ↓, then Enter; Esc cancels)
v           view services in selected workspace
s           stop the running workspace; on any other workspace, start it without opening it (this stops the running one)
r           restart the running workspace's services
?           help
,           settings
q           quit Sable
```

### Workspace

```text
↑ / ↓       select service or command
Enter       show logs or output
s           start (or run) / stop selected item
r           restart selected item
S           start every service, in the order set by "After"
L           saved logs: delete what was saved for an item, or for all
a           add a service or command
e           edit selected item (changes apply on restart)
d           delete selected item (stop it first)
m           move selected item (↑ ↓, then Enter; Esc cancels)
?           help
,           settings
Esc, q      back to the workspace list, or quit when started with sable run
```

### Logs

```text
↑ / ↓       scroll
g / Home    jump to top
G / End     jump to bottom and follow new output
w           wrap long lines, or scroll them sideways
← / →       scroll long lines sideways (when not wrapping)
0           reset sideways scroll
/           search, then Enter
n / N       next / previous match
e           jump to the next error (stderr) line
?           help
Esc, q      clear the search, or go back
```

# Sable
<table>
<tr>
<td width="60%" valign="middle">

Sable is a keyboard-first terminal workspace manager for developers.

It helps you save a workspace made of local services and one-shot commands, switch between them, control their lifecycle, and inspect recent logs or command output from one terminal UI.

Sable is not a task runner, tmux replacement, IDE, Docker manager, Kubernetes tool, SSH tool, plugin platform, file explorer, editor, or AI tool.

</td>
<td width="40%" align="center">

<img width="300" height="300" alt="Sable" src="https://github.com/user-attachments/assets/9b7747ed-67be-42ce-80da-93db82c4ebf5" />

</td>
</tr>
</table>

## Status

Sable 0.4.0 is the current daily-use checkpoint. Current work remains focused on reliability and small local-first improvements.

Requirements: Node.js 20+ and npm. Sable is intended to work on Windows, macOS, and Linux, and the test suite runs on all three in CI.

Current capabilities:

- open the workspace picker with `sable`; a welcome screen guides first-time users
- create a workspace and get services suggested from what is in its folder: `package.json` scripts, `Makefile` and `justfile` targets, Docker Compose, Cargo, Go, Django, pytest, Rails and Laravel
- add, edit, delete, and reorder workspaces, services, and one-shot commands
- edit everything in one form, including environment variables, even while a service runs
- start, stop, and restart services; run commands; see status at a glance
- preview the selected item's latest output beside the list on wide terminals
- read logs with timestamps, search them, jump to the next error, and wrap long lines
- help on every screen, and key hints that change with the selected item
- graceful shutdown on quit or Ctrl+C


<img width="2752" height="1536" alt="hf_20261005_120225_82f8d9bf-05a0-4a76-8fc9-6171e5a250f6(2)" src="https://github.com/user-attachments/assets/55c16850-ea79-48f2-b584-fe24c24d47e0" />

## Install

Install globally from npm:

```sh
npm install -g sable-workspaces
```

Then run:

```sh
sable
```

The npm package is `sable-workspaces`; the installed CLI command is `sable`.

## Local development

Install dependencies:

```sh
npm install
```

Build:

```sh
npm run build
```

Test:

```sh
npm test
```

Link the CLI locally:

```sh
npm link
```

On Windows PowerShell, if script execution blocks `npm`, use `npm.cmd` instead:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd link
```

## Suggestions for a new workspace

When you create a workspace in a folder with no services yet, Sable looks through the folder and offers what it finds as one checklist (`↑↓` move, `Space` tick, `Enter` add). Services you tick start when the workspace opens; one-shot items become commands. Nothing is added until you press Enter, and everything can be changed later with `e`.

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

## Commands

Open the workspace picker/home screen:

```sh
sable
```

When you add a workspace (`a` in the picker), Sable asks for a project directory. Relative service working directories are resolved against that project directory so you can run the workspace later from anywhere.

In folder fields, Sable suggests the rest of the path as you type. Press `→` to accept it, or `↑` / `↓` to step through other matching folders (`Tab` moves to the next field).

The Command field works the same way with commands you saved before, this workspace's first and then your other workspaces'.

## Keys

The footer on each screen shows the keys that work for what is selected. Press `?` anywhere for the full list. `Esc` and `q` always go back one level; `Ctrl+C` quits Sable from anywhere and stops everything.

### Workspace picker

In `sable`:

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
s           stop the running workspace
r           restart the running workspace's services
?           help
,           settings (sound, welcome screen, saved logs, tips)
q           quit Sable
```

Launch shows a welcome screen: the logo builds up dot by dot, with the version and a one-line summary of your workspaces. Any key skips it. Turn it off in Settings (`,`) to go straight to the workspace list; a new-version popup still appears.

Deleting a workspace from the picker requires typing the workspace name exactly.

Only one workspace is active at a time. When you open a workspace from the picker, `q` in the dashboard returns to the picker and keeps that workspace running. The picker marks the active workspace as `running`. Quitting Sable from the picker stops the active workspace; opening a different workspace stops the previous active workspace first.

### Dashboard

In `sable run`, or after opening a workspace from the picker:

```text
↑ / ↓       select service or command
Enter       show logs or output
s           start or stop selected item
r           restart service, or run command
S           start every service, in the order set by "After" (see below)
L           saved logs: delete what was saved for an item, or for all
a           add a service or command
e           edit selected item (changes apply on restart)
d           delete selected item (stop it first)
m           move selected service (↑ ↓, then Enter; Esc cancels)
?           help
,           settings (sound, welcome screen, saved logs, tips)
Esc, q      back to the picker, or quit when started with sable run
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
Esc, q      clear the search, or go back to the dashboard
```

Logs/output are kept in memory, up to 2,000 lines (and about 2 million characters) per service or command. By default they are not written to disk; turn on **Save logs** in Settings (`,`) to keep a copy (see Saved logs below). Sable keeps a program's colors but drops other terminal control sequences (screen clears, cursor moves) so a noisy tool can't scramble the display, and asks programs for color unless `NO_COLOR` is set.

## Start order

An item can wait for others. In the add or edit form, the **After** field lists the other services and commands. Move onto one and press `Space` to tick the ones that must come first, for example `db` for an API that needs its database. Items that already wait for this one are not offered, so you can't make a loop:

- A service counts as ready once it has stayed alive for 5 seconds.
- A command counts as ready when it exits with code 0, so `npm run build` can finish before `npm start` begins.
- Items that wait for nothing start together.

Sable follows this order when it opens a workspace (services and commands marked auto-start) and when you press `S` (every service, every auto-start command, and the commands they wait for). A command with **Auto-start** on runs by itself once what it waits for is up or done, for example a migration after `db`; without it, a command only runs when you press `r` (or when a service waits for it). Items still held back show `◌ waiting for db`. If something they wait for stops early or fails, they show `✕ skipped: db stopped early` and are not started. Press `s` on a waiting item to cancel its start. Starting one item with `s` or `r` always starts just that item.

Conditions belong in the command itself: `test -f dist/main.js || npm run build` only builds when the file is missing.

## Sharing a workspace with your team

Put a `sable.json` in your project and commit it. A teammate who starts Sable in that folder gets the same services and commands, without setting anything up by hand.

```json
{
  "version": 1,
  "name": "shop",
  "placeholders": {
    "API_PORT": { "description": "Port for the API", "default": "3000" }
  },
  "items": [
    { "type": "service", "name": "db", "command": "docker compose up db" },
    { "type": "service", "name": "api", "command": "npm run dev", "cwd": "api",
      "after": ["db"], "env": { "PORT": "{{API_PORT}}" }, "secrets": ["STRIPE_KEY"] },
    { "type": "command", "name": "build", "command": "npm run build" }
  ]
}
```

- `type` is `service` or `command`. `cwd` is a folder inside the project (default `.`), `autoStart: false` keeps a service from starting with the workspace (`autoStart: true` on a command makes it run with the workspace, after what it waits for), and `after` lists items by name (see Start order).
- `{{NAME}}` is a placeholder. Declare it under `placeholders` with an optional `description` and `default`. Each person gives their own value when they import the file, and it stays on their machine.
- `secrets` names environment variables whose values must never be in the file. Each person gives their own value the first time the item runs (see below), and it stays on their machine. A name listed under `secrets` can't also have a value in `env`.

**Writing the file.** In the picker, select a workspace and press `x`. A workspace that has no `sable.json` yet shows a one-line tip about this under the list; switch **Tips** off in Settings (`,`) to hide it. Sable shows exactly what it will write, then writes `sable.json` into the workspace's folder. If a `sable.json` is already there, the review first shows how the new file differs from it (items added, changed and removed), so you can see if you would overwrite something a teammate added. You decide what is private: in the add or edit form, tick the variables typed under **Env** in the **Secret** list. A ticked variable is left out of `sable.json` with its value (the file only names it under `secrets`). Names that look private (`TOKEN`, `KEY`, `PASSWORD`...) are marked `(looks secret)` as a nudge, and for an item you never reviewed Sable assumes those are secret when it writes the file and says so. Look the file over before you commit it: Sable can only protect environment variables, so a token written inside a command (`--token abc123`) is not detected; move it into a variable.

**Using the file.** Start `sable` in a folder that has a `sable.json` and no workspace yet, or press `i` in the picker. Sable shows every command the file would run, and only after you press Enter does it create the workspace. Nothing starts before you agree. Sable asks for the placeholder values, then the workspace appears in the picker.

**Staying in sync.** When you open the workspace (or start Sable in its folder), Sable compares the file with the one you agreed to. If it changed, you see what changed, the old and the new command side by side, and nothing is applied until you agree. Press Esc to keep your current version and look again later. A workspace whose file changed since you agreed to it is marked `⟳ changed` in the workspace list (and explained under the list when selected), so a pulled change is noticed even before you open it.

**Making it fit your machine.** Editing an imported item (`e`) changes it only for you, and a later update from the file keeps your change. Fields you did not touch follow the file. Deleting an imported item removes it only for you. If an imported item fails, Sable explains the likely cause in the status line, such as a program that isn't installed, a port in use or a missing folder, and tells you to press `e` to adjust it here.

**Secrets.** An item that needs a secret you haven't set shows `Needs STRIPE_KEY on this machine` under the list. Press `s` and Sable asks for the value (hidden as you type), saves it only in your own config, and starts the item; or press `e` there to edit the whole item and take a different approach. Start all and auto-start don't ask: they skip the item, and what waits for it, with `needs STRIPE_KEY`, so you can fix it with `s`. Values are kept as plain text in your local `workspaces.json`, like every other environment variable.

Sable looks for `sable.json` in the folder it is started in, not in parent folders.

## Saved logs

Turn on **Save logs** in Settings (`,`, then `↑↓` and `Space`) and Sable also writes everything each service or command prints to a file, so you can read it after Sable closes or after a crash. It is off by default, and nothing is written while it is off.

- Files are in the `logs/` folder of the config directory (shown in the Settings popup), one per item: `logs/<workspace>/api.log`, and `build.command.log` for a command.
- Each line has its time and stream: `2026-10-13T11:42:01.123Z [stderr] Error: ...`. They are plain text, so `grep`, `tail -f` and sharing work as usual.
- A file stops growing at 2 MB: it is renamed to `.log.1` (replacing the previous `.log.1`) and a new file starts, so an item uses at most about 4 MB.
- When you look at an item's logs after restarting Sable, its saved output from the last run appears above the new output, after a line that says "saved output above, new output below" (the last 300 lines). Whenever the logs include saved output from an earlier run, or lines from an earlier day, every line shows the month and day (`10-12 09:15:00`) so old and new output can be told apart; otherwise only the time is shown.
- To delete saved logs, press `L` in the workspace dashboard (one item, or everything in that workspace) or in the workspace list (one workspace, or everything). The footer shows `[L] saved logs` while saving is on. The popup shows how much each one takes; `d` or `Enter` asks, and `Enter` again deletes. Nothing is deleted without that second step. It works even while saving is off, for files saved earlier.
- If a file can't be written (disk full, no permission), Sable carries on without saving it.

Sable is not a log shipper or a service manager: this is a local convenience for development. Logs of things you run in production belong to the tool that runs them.

## Sound

Sable plays soft, quiet tones as you move (`↑↓`), open and go back, start and stop things, and a calm chime when a service or command ends on its own (not when you stop it). Sound is on by default. Press `,` on the picker or dashboard to open the Settings popup (`↑↓` to choose, `Space` to switch) and turn it off; settings are saved in `settings.json` next to `workspaces.json`.

Sable has no audio dependency. On Linux (including WSL) it keeps one audio stream open through `pacat`, `paplay`, `pw-cat` or `aplay` and mixes its tones into it, so every sound starts with the same short delay. On macOS and Windows it plays small files from a `sounds/` folder in the config directory with `afplay` or PowerShell, which can start a little later. If no player works, Sable stays silent.

## Configuration

Sable stores workspace configuration as JSON in an OS-aware user config directory. The config file is named `workspaces.json`.

Workspace commands are treated as trusted local configuration.

**Upgrading from 0.3.** Sable 0.4 stores each workspace's services and commands in one `items` list (`"version": 2`). The first time it finds a 0.3 file it keeps a copy next to it as `workspaces.json.bak-0.3`, converts the file right away, and tells you once. Nothing is lost. If it can't make the copy or write the file (a read-only folder), it leaves your file alone and converts it later. Versions before 0.4 can't read the new format; to go back to one, put `workspaces.json.bak-0.3` back as `workspaces.json`.

## Updates

At most once an hour, Sable asks the npm registry in the background whether a newer version exists. If one does, a popup appears after the logo:

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

Choose with ←/→ and press Enter. **Update now** closes Sable and runs the install in your terminal, so you can see npm's output; start `sable` again when it finishes. **OK** (or Esc) skips that version until a newer one is released.

The check never delays startup or quitting, never installs anything unless you choose Update now, and is silent when you are offline. It is skipped in CI and when output is not a terminal. To turn it off, set `SABLE_NO_UPDATE_CHECK=1` (or the common `NO_UPDATE_NOTIFIER=1`).

## First-user notes

Sable runs workspace service commands through the user's shell. Treat workspace configuration as trusted local configuration, not as safe input from untrusted sources.

The primary interactive flow is the no-argument `sable` home picker. Every action is a single key on the selected workspace, service, or command.

## MVP limitations

- logs are in-memory unless you turn on **Save logs**; there is no log search across files
- no history of commands you ran; suggestions come only from saved services and commands
- no mouse support
- no theme system or visual customization
- no panes, built-in editor, file explorer, task runner, Docker/Kubernetes abstraction, SSH, plugin system, or AI features
- no remote process management

## License

MIT

<img width="1828" height="1014" alt="hf_20261005_104049_5cb55abf-1988-49a7-92d0-7923d69aac8c_cell_2" src="https://github.com/user-attachments/assets/bab17784-a182-457a-ad44-39f55d5cea11" />

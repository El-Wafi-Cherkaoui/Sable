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

Sable 0.3.3 is the current daily-use checkpoint. Current work remains focused on reliability and small local-first improvements.

Requirements: Node.js 20+ and npm. Sable is intended to work on Windows, macOS, and Linux, and the test suite runs on all three in CI.

Current capabilities:

- open the workspace picker with `sable`; a welcome screen guides first-time users
- create a workspace and get services suggested from its `package.json` scripts
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
e           rename selected workspace
d           delete selected workspace
m           move selected workspace (↑ ↓, then Enter; Esc cancels)
v           view services in selected workspace
s           stop the running workspace
r           restart the running workspace's services
?           help
,           settings (sound, welcome screen)
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
a           add a service or command
e           edit selected item (changes apply on restart)
d           delete selected item (stop it first)
m           move selected service (↑ ↓, then Enter; Esc cancels)
?           help
,           settings (sound, welcome screen)
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

Logs/output are kept in memory, up to 2,000 lines (and about 2 million characters) per service or command. They are not persisted to disk. Sable keeps a program's colors but drops other terminal control sequences (screen clears, cursor moves) so a noisy tool can't scramble the display, and asks programs for color unless `NO_COLOR` is set.

## Start order

An item can wait for others. In the add or edit form, the **After** rows take the names of the services or commands that must come first, for example `db` for an API that needs its database:

- A service counts as ready once it has stayed alive for 5 seconds.
- A command counts as ready when it exits with code 0, so `npm run build` can finish before `npm start` begins.
- Items that wait for nothing start together.

Sable follows this order when it opens a workspace (services marked auto-start) and when you press `S` (every service, plus the commands they wait for). Items still held back show `◌ waiting for db`. If something they wait for stops early or fails, they show `✕ skipped: db stopped early` and are not started. Press `s` on a waiting item to cancel its start. Starting one item with `s` or `r` always starts just that item.

Conditions belong in the command itself: `test -f dist/main.js || npm run build` only builds when the file is missing.

## Sound

Sable plays soft, quiet tones as you move (`↑↓`), open and go back, start and stop things, and a calm chime when a service or command ends on its own (not when you stop it). Sound is on by default. Press `,` on the picker or dashboard to open the Settings popup (`↑↓` to choose, `Space` to switch) and turn it off; settings are saved in `settings.json` next to `workspaces.json`.

Sable has no audio dependency. On Linux (including WSL) it keeps one audio stream open through `pacat`, `paplay`, `pw-cat` or `aplay` and mixes its tones into it, so every sound starts with the same short delay. On macOS and Windows it plays small files from a `sounds/` folder in the config directory with `afplay` or PowerShell, which can start a little later. If no player works, Sable stays silent.

## Configuration

Sable stores workspace configuration as JSON in an OS-aware user config directory. The config file is named `workspaces.json`.

Workspace commands are treated as trusted local configuration.

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

- no persistent logs; logs are in-memory only
- no history of commands you ran; suggestions come only from saved services and commands
- no mouse support
- no theme system or visual customization
- no panes, built-in editor, file explorer, task runner, Docker/Kubernetes abstraction, SSH, plugin system, or AI features
- no remote process management

## License

MIT

<img width="1828" height="1014" alt="hf_20261005_104049_5cb55abf-1988-49a7-92d0-7923d69aac8c_cell_2" src="https://github.com/user-attachments/assets/bab17784-a182-457a-ad44-39f55d5cea11" />

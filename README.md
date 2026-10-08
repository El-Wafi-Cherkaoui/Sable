# Sable

Sable is a keyboard-first terminal workspace manager for developers.

It helps you save a workspace made of local services and one-shot commands, switch between them, control their lifecycle, and inspect recent logs or command output from one terminal UI.

Sable is not a task runner, tmux replacement, IDE, Docker manager, Kubernetes tool, SSH tool, plugin platform, file explorer, editor, or AI tool.

## Status

Sable 0.2.2 is the current daily-use checkpoint. Current work remains focused on reliability and small local-first improvements.

Requirements: Node.js 20+ and npm. Sable is intended to work on Windows, macOS, and Linux, with early smoke testing on Windows and Linux.

Current capabilities:

- open a workspace picker/home screen with `sable`
- create, list, rename, reorder, delete, and run saved workspaces
- create blank workspaces from the picker
- rename workspaces from the picker
- reorder workspaces directly from the picker
- delete workspaces from the picker with typed-name confirmation
- view workspace details from the picker
- add services or one-shot commands from the running workspace dashboard
- edit non-running services or commands from the running workspace dashboard
- delete non-running services or commands from the running workspace dashboard
- reorder services directly from the running workspace dashboard
- preview recent selected-service logs from the dashboard on wide terminals
- start, stop, and restart selected services; run selected commands
- show concise failed/exited details in the service dashboard
- capture stdout, stderr, and lifecycle logs in memory
- view logs/output, including vertical scroll and horizontal scroll for long lines
- help overlay
- minimal command mode
- graceful shutdown on quit or Ctrl+C

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

Create a workspace interactively:

```sh
sable create <workspace-name>
```

List saved workspaces:

```sh
sable list
```

Delete a workspace:

```sh
sable delete <workspace-name>
```

Run a workspace:

```sh
sable run <workspace-name>
```

During creation, Sable asks for a project directory. Relative service working directories are resolved against that project directory so you can run the workspace later from anywhere.

## Workspace picker keys

In `sable`:

```text
j / Down    select next workspace
k / Up      select previous workspace
Enter       run selected workspace
c           create blank workspace
e           rename selected workspace
d           delete selected workspace
K           move selected workspace up
J           move selected workspace down
v           view selected workspace details
?           show help
Esc         back from help/details/create/delete/rename flows
q           quit Sable from the picker
Ctrl+C      quit Sable from anywhere
```

Deleting a workspace from the picker requires typing the workspace name exactly.

Only one workspace is active at a time. When a workspace is launched from the picker, `q` / `:quit` in the dashboard returns to the picker and keeps that workspace running. The picker marks the active workspace as `running`. Quitting Sable from the picker stops the active workspace; opening a different workspace stops the previous active workspace first.

## Dashboard keys

In `sable run`, or after opening a workspace from the picker:

```text
j / Down    select next item
k / Up      select previous item
a           add service or command
e           edit selected non-running item
d           delete selected non-running item
K           move selected service up
J           move selected service down
S           start selected service
s           stop selected item
r           restart service or run command
Enter       show selected logs/output
?           show help
:           command mode
q           quit, or return to picker when launched from picker
Ctrl+C      quit Sable cleanly
```

## Logs view keys

```text
j / Down    scroll down
k / Up      scroll up
g           jump to top
G           jump to bottom
h / Left    scroll long lines left
l / Right   scroll long lines right
0           reset horizontal scroll
Esc         return to dashboard
?           show help
:           command mode
q           quit, or return to picker when launched from picker
Ctrl+C      quit Sable cleanly
```

Logs/output are kept in memory and bounded per service or command. They are not persisted to disk.

## Command mode

Press `:` to enter command mode.

Supported commands:

```text
:help
:h
:quit
:q
```

Use `Esc` to cancel command mode.

## Configuration

Sable stores workspace configuration as JSON in an OS-aware user config directory. The config file is named `workspaces.json`.

Workspace commands are treated as trusted local configuration.

## First-user notes

Sable runs workspace service commands through the user's shell. Treat workspace configuration as trusted local configuration, not as safe input from untrusted sources.

The primary interactive flow is the no-argument `sable` home picker. Common dashboard actions are direct keys on the selected service or command; less common global actions belong in command mode.

## MVP limitations

- no persistent logs; logs are in-memory only
- no command history or autocomplete
- no mouse support
- no theme system or visual customization
- no panes, built-in editor, file explorer, task runner, Docker/Kubernetes abstraction, SSH, plugin system, or AI features
- no remote process management

## License

MIT

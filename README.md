# Sable

Sable is a keyboard-first terminal workspace manager for developers.

It helps you save a workspace made of local services, run those services, switch between them, control their lifecycle, and inspect recent logs from one terminal UI.

Sable is not a task runner, tmux replacement, IDE, Docker manager, Kubernetes tool, SSH tool, plugin platform, file explorer, editor, or AI tool.

## Status

Sable is early MVP software preparing for a first release candidate. The current focus is reliability, packaging confidence, and clear first-user documentation rather than expanding scope.

Requirements: Node.js 20+ and npm. Sable is intended to work on Windows, macOS, and Linux, with early smoke testing on Windows and Linux.

Current capabilities:

- open a workspace picker/home screen with `sable`
- create, list, delete, and run saved workspaces
- create blank workspaces from the picker
- delete workspaces from the picker with typed-name confirmation
- view workspace details from the picker
- add services from the running workspace dashboard
- edit stopped/failed services from the running workspace dashboard
- start, stop, and restart selected services
- show concise failed/exited details in the service dashboard
- capture stdout, stderr, and lifecycle logs in memory
- view and scroll logs
- help overlay
- minimal command mode
- graceful shutdown on quit or Ctrl+C

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
d           delete selected workspace
v           view selected workspace details
?           show help
Esc         back from help/details/create/delete flows
q           quit Sable from the picker
Ctrl+C      quit Sable from anywhere
```

Deleting a workspace from the picker requires typing the workspace name exactly.

Only one workspace is active at a time. When a workspace is launched from the picker, `q` / `:quit` in the service dashboard stops that workspace and returns to the picker.

## Service dashboard keys

In `sable run`, or after opening a workspace from the picker:

```text
j / Down    select next service
k / Up      select previous service
a           add service
e           edit selected stopped/failed service
S           start selected service
s           stop selected service
r           restart selected service
Enter       show selected service logs
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
Esc         return to dashboard
?           show help
:           command mode
q           quit, or return to picker when launched from picker
Ctrl+C      quit Sable cleanly
```

Logs are kept in memory and bounded per service. They are not persisted to disk.

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

The primary interactive flow is the no-argument `sable` home picker. Common service actions are direct keys on the selected service; less common global actions belong in command mode.

## MVP limitations

- no persistent logs; logs are in-memory only
- no dedicated workspace rename/reorder commands yet
- no command history or autocomplete
- no mouse support
- no theme system or visual customization
- no panes, built-in editor, file explorer, task runner, Docker/Kubernetes abstraction, SSH, plugin system, or AI features
- no remote process management

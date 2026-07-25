# Sable

Sable is a keyboard-first terminal workspace manager for developers.

It helps you save a workspace made of local services, run those services, switch between them, control their lifecycle, and inspect recent logs from one terminal UI.

Sable is not a task runner, tmux replacement, IDE, Docker manager, Kubernetes tool, SSH tool, plugin platform, file explorer, editor, or AI tool.

## Status

Sable is early MVP software.

Current capabilities:

- create, list, delete, and run saved workspaces
- start, stop, and restart selected services
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

## Dashboard keys

In `sable run`:

```text
j / Down    select next service
k / Up      select previous service
S           start selected service
s           stop selected service
r           restart selected service
Enter       show selected service logs
?           show help
:           command mode
q           quit
Ctrl+C      quit cleanly
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
q           quit
Ctrl+C      quit cleanly
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

## Packaging check

Preview package contents:

```sh
npm pack --dry-run
```

The npm package is configured to include built files from `dist`.

## MVP limitations

- no persistent logs
- no workspace editing command yet
- no command history or autocomplete
- no mouse support
- no colors/themes beyond plain terminal output
- no remote process management

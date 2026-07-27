# Changelog

## Unreleased

### Added

- Workspace rename from the home picker.
- Workspace reorder from the home picker with `K` / `J`.
- Service rename from the dashboard edit flow.
- Service deletion from the dashboard with typed-name confirmation.
- Service reorder from the dashboard with `K` / `J`.

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

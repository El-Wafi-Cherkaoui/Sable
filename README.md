<div align="center">

<img width="140" height="140" alt="Sable logo" src="https://github.com/user-attachments/assets/9b7747ed-67be-42ce-80da-93db82c4ebf5" />

# Sable

**Run your whole stack from one terminal.**

Your dev server, database and scripts in one dashboard.<br>
Start them in the right order and keep an eye on every log.

[![npm](https://img.shields.io/npm/v/sable-workspaces)](https://www.npmjs.com/package/sable-workspaces)
[![CI](https://github.com/El-Wafi-Cherkaoui/Sable/actions/workflows/ci.yml/badge.svg)](https://github.com/El-Wafi-Cherkaoui/Sable/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Website](https://el-wafi-cherkaoui.github.io/Sable/) · [Guide](docs/guide.md) · [Sharing](docs/sharing.md) · [Changelog](CHANGELOG.md)

<img alt="Sable opening a workspace: db starts, migrate runs after it, api waits for migrate, then the api logs are searched for /checkout" src="assets/demo.gif" />

</div>

## Why

<img width="100%" alt="A sable sitting at a desk, paws on the keyboard, looking up from the screen" src="https://github.com/user-attachments/assets/55c16850-ea79-48f2-b584-fe24c24d47e0" />

Working on a project often means four terminal tabs: the database, the API, the frontend, a watcher. You start them in the right order by hand, and when something breaks you hunt through tabs for the error.

Sable keeps all of that in one place. Save a workspace once, and from then on it is one key to start everything, one key to read any log, and one key to stop it all.

## Install

```sh
npm install -g sable-workspaces
sable
```

Needs Node.js 20 or newer. Works on Windows, macOS and Linux.

## Get started in a minute

1. Run `sable` and press `a` to add a workspace. Pick your project folder.
2. Sable reads the folder and suggests what to run: `package.json` scripts, `Makefile`, Docker Compose, Cargo, Go, Django, Rails and more. Tick what you want.
3. Press `Enter` to open the workspace. Your services start.
4. Select one and press `Enter` to read its logs. Press `q` to go back.

The footer always shows the keys that work right now, and `?` shows the rest.

## What you get

**Start order.** Tell an item what it waits for: the API after the database, the server after the build. A service counts as ready once it has been up for 5 seconds, a command once it exits cleanly. `S` starts everything in that order. [More](docs/guide.md#start-order)

**Logs you can search.** Every line is timestamped. Search with `/`, jump to the next error with `e`, wrap or scroll long lines. You can also save logs to disk to read after Sable closes. [More](docs/guide.md#logs)

**A live overview.** Each service and command shows its status (`● running`, `✓ done`, `✕ exited 1`, `◌ after db`) and, on wide terminals, its latest output beside the list.

**Share it with your team, safely.** Press `x` to write a `sable.json` and commit it. A teammate who runs `sable` in the project gets the same setup, but first sees every command it will run, and sees exactly what changed whenever the file is updated. Secrets stay on each person's machine. [More](docs/sharing.md)

## Keys

One key, one meaning, on every screen:

| Key | Action |
| --- | --- |
| `Enter` | open (a workspace, or an item's logs) |
| `s` | start / stop |
| `r` | restart, or run a command again |
| `S` | start everything, in order |
| `a` `e` `d` | add, edit, delete |
| `m` | move (reorder the list) |
| `?` | help |
| `Esc` `q` | back |
| `Ctrl+C` | quit and stop everything |

The full list is in the [guide](docs/guide.md#keys).

## What Sable isn't

Sable does one thing: run and watch the processes of your local development setup. It is not a task runner, tmux replacement, IDE, Docker or Kubernetes manager, SSH tool, or process supervisor for production. It has no plugins and no AI features, and it doesn't need an account or network access (apart from an optional update check).

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/El-Wafi-Cherkaoui/Sable/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) to build and test it locally.

## License

[MIT](LICENSE)

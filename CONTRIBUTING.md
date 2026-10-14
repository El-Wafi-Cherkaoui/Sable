# Contributing

Bug reports and ideas are welcome in [issues](https://github.com/El-Wafi-Cherkaoui/Sable/issues). Sable is deliberately small (see "What Sable isn't" in the [README](README.md)), so for a new feature, please open an issue to talk about it before writing code.

## Local development

Requires Node.js 20+ and npm.

```sh
npm install
npm run build
npm test
npm link        # makes `sable` run your local build
```

A change is ready when this passes (it is what CI runs on Linux, macOS and Windows):

```sh
npm run lint && npm run typecheck && npm run build && npm test
```

To try Sable without touching your real workspaces, point it at a different config folder:

```sh
XDG_CONFIG_HOME=/tmp/sable-try node dist/main.js
```

On Windows PowerShell, if script execution blocks `npm`, use `npm.cmd` instead:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd link
```

## Recording the demo

`assets/demo.gif` is recorded with [vhs](https://github.com/charmbracelet/vhs) in Docker, from a fake workspace in `scripts/demo/`. After a UI change, re-record it from the repo root:

```sh
npm run build
sh scripts/demo/record.sh
```

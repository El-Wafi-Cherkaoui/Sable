# Sharing a workspace with sable.json

Put a `sable.json` in your project and commit it. A teammate who starts Sable in that folder gets the same services and commands, in the same start order, without setting anything up by hand.

The file is someone else's code running on your machine, so Sable never runs it blindly: you see every command before anything starts, and again whenever the file changes.

The file holds the common baseline for the project, not one person's setup. Each person fills in their own ports, paths and secrets, and can adjust any item for their machine.

- [Writing the file](#writing-the-file)
- [Using the file](#using-the-file)
- [Staying in sync](#staying-in-sync)
- [Making it fit your machine](#making-it-fit-your-machine)
- [Secrets](#secrets)
- [File format](#file-format)

## Writing the file

In the workspace list, select a workspace and press `x`. Sable shows exactly what it will write, then writes `sable.json` into the workspace's folder. If a `sable.json` is already there, the review first shows how the new file differs from it (items added, changed and removed), so you can see whether you would overwrite something a teammate added.

You decide what stays private. In an item's edit form, tick the variables typed under **Env** in the **Secret** list. A ticked variable is left out of `sable.json` along with its value; the file only names it under `secrets`. Names that look private (`TOKEN`, `KEY`, `PASSWORD`...) are marked `(looks secret)` as a nudge. For an item you never reviewed, Sable assumes those are secret when it writes the file and says so.

Look the file over before you commit it. Sable can only protect environment variables, so a token written inside a command (`--token abc123`) is not detected; move it into a variable.

A workspace that has no `sable.json` yet shows a one-line tip about this under the list; switch **Tips** off in Settings (`,`) to hide it.

## Using the file

Start `sable` in a folder that has a `sable.json` and no workspace yet, or press `i` in the workspace list. Sable shows every command the file would run:

```text
Review sable.json
This file will run these commands on your machine.
Nothing starts until you press Enter.

SERVICES
  db     docker compose up db
  api    npm run dev
         in api, after db
         needs STRIPE_KEY on this machine
COMMANDS
  build  npm run build
```

Only after you press Enter does Sable create the workspace. It then asks for the placeholder values, and the workspace appears in the list. Nothing starts before you agree.

Sable looks for `sable.json` in the folder it is started in, not in parent folders.

## Staying in sync

When you open the workspace (or start Sable in its folder), Sable compares the file with the version you agreed to. If it changed, you see what changed, with the old and new commands side by side, and nothing is applied until you agree:

```text
--- since you agreed ---
- api  npm run dev
+ api  npm run dev -- --inspect
```

Press Esc to keep your current version and look again later. A workspace whose file changed since you agreed to it is marked `⟳ changed` in the workspace list, so a change you pulled is noticed even before you open the workspace.

## Making it fit your machine

Editing an imported item (`e`) changes it only for you, and a later update from the file keeps your change. Fields you did not touch keep following the file. Deleting an imported item removes it only for you.

If an imported item fails, Sable explains the likely cause in the status line, such as a program that isn't installed, a port in use or a missing folder, and tells you to press `e` to adjust it.

## Secrets

An item that needs a secret you haven't set shows `Needs STRIPE_KEY on this machine` under the list. Press `s` and Sable asks for the value (hidden as you type), saves it only in your own config, and starts the item. Or press `e` to edit the whole item and take a different approach.

Start all and auto-start don't ask: they skip the item, and everything that waits for it, with `needs STRIPE_KEY`, so you can fix it with `s`.

Values are kept as plain text in your local `workspaces.json`, like every other environment variable.

## File format

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

| Field | Meaning |
| --- | --- |
| `type` | `service` (keeps running) or `command` (runs once). |
| `name` | Unique name of the item; other items refer to it in `after`. |
| `command` | What to run, through the shell. |
| `cwd` | A folder inside the project. Default `.`. |
| `autoStart` | On a service, `false` keeps it from starting with the workspace. On a command, `true` makes it run with the workspace, after what it waits for. |
| `after` | Names of items that must be up or done first. See [Start order](guide.md#start-order). |
| `env` | Environment variables. Values may use placeholders. |
| `secrets` | Names of environment variables whose values must never be in the file. A name listed here can't also have a value in `env`. |
| `placeholders` | `{{NAME}}` values each person gives when they import the file, with an optional `description` and `default`. Answers stay on each person's machine. |

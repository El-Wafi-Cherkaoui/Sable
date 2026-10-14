import os from "node:os";
import path from "node:path";
import type { ItemConfig, WorkspaceConfig } from "../config/config-types.js";
import { looksSecret } from "../config/secret-names.js";
import { parseProjectFile } from "./project-file.js";


export type ProjectExport = {
  // The text to write to sable.json.
  text: string;
  // Things the user should know before committing the file.
  notes: string[];
  // The name each item has in the file, by item id.
  names: Map<string, string>;
};

// Builds the sable.json that would give a teammate this workspace: folders relative to the project,
// items linked by name, and no value for any variable marked secret (the file only names them).
// An item whose secrets the user never reviewed falls back to guessing from the variable names.
export function buildProjectFile(workspace: WorkspaceConfig, homeDirectory: string = os.homedir()): ProjectExport {
  const notes: string[] = [];
  const names = new Map<string, string>();
  const used = new Set<string>();

  for (const item of workspace.items) {
    let name = item.name;

    if (used.has(name)) {
      name = `${item.name} (${item.kind})`;
      notes.push(`"${item.name}" is used by a service and a command, so the ${item.kind} is called "${name}" in the file.`);
    }

    used.add(name);
    names.set(item.id, name);
  }

  const items = workspace.items.map((item) => {
    const name = names.get(item.id)!;
    const secrets = secretsOf(item, name, notes);
    const env = Object.fromEntries(Object.entries(item.env).filter(([key]) => !secrets.includes(key)));

    for (const text of [item.command, ...Object.values(env)]) {
      if (mentionsLocalPath(text, workspace.projectDirectory, homeDirectory)) {
        notes.push(`${name}: its command or variables mention a folder on this machine (${shorten(text)}). Check it works for others.`);
        break;
      }
    }

    const folder = folderOf(item, workspace.projectDirectory, notes, name);
    const waits = afterNames(item, workspace, names);

    return {
      type: item.kind,
      name,
      command: item.command,
      ...(folder === "." ? {} : { cwd: folder }),
      ...(item.kind === "service" && !item.autoStart ? { autoStart: false } : {}),
      ...(item.kind === "command" && item.autoStart === true ? { autoStart: true } : {}),
      ...(waits.length > 0 ? { after: waits } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(secrets.length > 0 ? { secrets } : {}),
    };
  });

  const file = {
    version: 1,
    name: workspace.name,
    items,
  };
  const text = `${compactStringLists(JSON.stringify(file, null, 2))}\n`;
  const check = parseProjectFile(text);

  if (check.type !== "ok") {
    // A bug in the export, not something the user can fix: say so rather than write a broken file.
    throw new Error(`The exported file would not be valid. ${check.type === "invalid" ? check.message : ""}`);
  }

  return { text, notes: [...new Set(notes)], names };
}

// The variables of an item to keep out of the file: the ones the user marked, or, for an item they never
// reviewed, the ones whose names look like secrets. Marked ones are named even when they have no value yet.
function secretsOf(item: ItemConfig, name: string, notes: string[]): string[] {
  if (item.secrets === undefined) {
    const guessed = Object.keys(item.env).filter((key) => looksSecret(key));

    for (const key of guessed) {
      notes.push(`${name}: ${key} looks like a secret, so its value is not written; teammates are asked for it. Open the item with e to decide yourself.`);
    }

    return guessed;
  }

  for (const key of item.secrets) {
    notes.push(`${name}: ${key} is marked secret, so its value is not written; teammates are asked for it.`);
  }

  for (const key of Object.keys(item.env)) {
    if (!item.secrets.includes(key) && looksSecret(key)) {
      notes.push(`${name}: ${key} looks like a secret but is not marked as one, so its value IS written to the file. Mark it with e if it should stay private.`);
    }
  }

  return [...new Set(item.secrets)];
}

// Keeps a short list of strings, like "after", on one line so the file stays easy to read in a diff.
function compactStringLists(json: string): string {
  const string = String.raw`"(?:[^"\\]|\\.)*"`;
  const list = new RegExp(String.raw`\[\s*\n\s*(${string}(?:,\s*\n\s*${string})*)\s*\n\s*\]`, "g");

  return json.replace(list, (_whole, inner: string) => `[${inner.split(/,\s*\n\s*/).join(", ")}]`);
}

function afterNames(item: ItemConfig, workspace: WorkspaceConfig, names: Map<string, string>): string[] {
  return item.after.flatMap((id) => {
    const name = names.get(id);

    return name === undefined || workspace.items.every((candidate) => candidate.id !== id) ? [] : [name];
  });
}

// The item's folder relative to the project; a folder outside the project cannot be shared.
function folderOf(item: ItemConfig, projectDirectory: string, notes: string[], name: string): string {
  const relative = path.relative(projectDirectory, item.cwd).split(path.sep).join("/");

  if (relative === "") {
    return ".";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    notes.push(`${name}: its folder (${item.cwd}) is outside the project, so the file uses the project folder instead.`);

    return ".";
  }

  return relative;
}

function mentionsLocalPath(text: string, projectDirectory: string, homeDirectory: string): boolean {
  const roots = [projectDirectory, homeDirectory].filter((root) => root.length > 1);

  return roots.some((root) => text.includes(root));
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

import os from "node:os";
import path from "node:path";
import type { ItemConfig, WorkspaceConfig } from "../config/config-types.js";
import { parseProjectFile } from "./project-file.js";

// Variables with names like these hold secrets: their values never go into the file.
const secretName = /SECRET|TOKEN|PASS|KEY|CREDENTIAL|PRIVATE|AUTH|COOKIE|SESSION/i;

export type ProjectExport = {
  // The text to write to sable.json.
  text: string;
  // Things the user should know before committing the file.
  notes: string[];
  // The name each item has in the file, by item id.
  names: Map<string, string>;
  // This machine's real values for the placeholders that stand in for secrets.
  values: Record<string, string>;
};

// Builds the sable.json that would give a teammate this workspace: folders relative to the project,
// items linked by name, and a placeholder instead of any value that looks like a secret.
export function buildProjectFile(workspace: WorkspaceConfig, homeDirectory: string = os.homedir()): ProjectExport {
  const notes: string[] = [];
  const names = new Map<string, string>();
  const used = new Set<string>();
  const placeholders: Record<string, { description: string }> = {};
  const values: Record<string, string> = {};

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
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(item.env)) {
      if (secretName.test(key)) {
        const placeholder = uniquePlaceholder(`${name}_${key}`, placeholders);

        placeholders[placeholder] = { description: `${key} for ${name}. Kept on each machine, not in this file.` };
        values[placeholder] = value;
        env[key] = `{{${placeholder}}}`;
        notes.push(`${name}: the value of ${key} looks like a secret, so the file asks each person for it instead.`);
      } else {
        env[key] = value;
      }
    }

    for (const text of [item.command, ...Object.values(item.env)]) {
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
      ...(waits.length > 0 ? { after: waits } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  });

  const file = {
    version: 1,
    name: workspace.name,
    ...(Object.keys(placeholders).length > 0 ? { placeholders } : {}),
    items,
  };
  const text = `${compactStringLists(JSON.stringify(file, null, 2))}\n`;
  const check = parseProjectFile(text);

  if (check.type !== "ok") {
    // A bug in the export, not something the user can fix: say so rather than write a broken file.
    throw new Error(`The exported file would not be valid. ${check.type === "invalid" ? check.message : ""}`);
  }

  return { text, notes: [...new Set(notes)], names, values };
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

function uniquePlaceholder(raw: string, existing: Record<string, unknown>): string {
  let base = raw.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  if (!/^[A-Z]/.test(base)) {
    base = `X_${base}`;
  }

  let candidate = base;

  for (let suffix = 2; existing[candidate] !== undefined; suffix += 1) {
    candidate = `${base}_${suffix}`;
  }

  return candidate;
}

function mentionsLocalPath(text: string, projectDirectory: string, homeDirectory: string): boolean {
  const roots = [projectDirectory, homeDirectory].filter((root) => root.length > 1);

  return roots.some((root) => text.includes(root));
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

import path from "node:path";
import type { ItemConfig, ProjectBaseItem, WorkspaceConfig } from "../config/config-types.js";
import { addItem, removeItem, replaceItem } from "../config/workspace-items.js";
import type { generateShortId } from "../shared/id.js";
import type { ProjectFile } from "./project-file.js";

// One item of sable.json with this machine's placeholder values filled in and its folder made absolute.
export type ResolvedProjectItem = ProjectBaseItem & { name: string };

export type PlaceholderInfo = { name: string; description?: string; default?: string };

export function declaredPlaceholders(file: ProjectFile): PlaceholderInfo[] {
  return Object.entries(file.placeholders).map(([name, placeholder]) => ({
    name,
    ...(placeholder.description === undefined ? {} : { description: placeholder.description }),
    ...(placeholder.default === undefined ? {} : { default: placeholder.default }),
  }));
}

// Placeholders that have neither an answer on this machine nor a default.
export function missingPlaceholders(file: ProjectFile, values: Record<string, string>): string[] {
  return declaredPlaceholders(file)
    .filter((placeholder) => values[placeholder.name] === undefined && placeholder.default === undefined)
    .map((placeholder) => placeholder.name);
}

// With `keepUnanswered`, a placeholder that has no value and no default stays as {{NAME}}, which is
// how the review shows a file before the user has answered anything.
export function resolveProjectItems(
  file: ProjectFile,
  values: Record<string, string>,
  projectDirectory: string,
  options: { keepUnanswered?: boolean } = {},
): ResolvedProjectItem[] {
  const fill = (text: string) => text.replace(/\{\{([^{}]*)\}\}/g, (whole, name: string) => {
    const value = values[name] ?? file.placeholders[name]?.default;

    if (value === undefined) {
      if (options.keepUnanswered === true) {
        return whole;
      }

      throw new Error(`No value for {{${name}}}.`);
    }

    return value;
  });

  return file.items.map((item) => ({
    name: item.name,
    kind: item.type,
    command: fill(item.command),
    cwd: path.resolve(projectDirectory, item.cwd.replaceAll("\\", "/")),
    env: Object.fromEntries(Object.entries(item.env).map(([key, value]) => [key, fill(value)])),
    ...(item.type === "service" ? { autoStart: item.autoStart ?? true } : {}),
    after: item.after,
    secrets: item.secrets,
  }));
}

export type ProjectSyncSummary = { added: string[]; updated: string[]; removed: string[] };

export type ProjectSyncOptions = {
  workspace: WorkspaceConfig;
  file: ProjectFile;
  hash: string;
  values: Record<string, string>;
  generateId: typeof generateShortId;
};

// Brings the workspace in line with the project file. A field the user did not change here takes the
// file's new value; a field the user changed here keeps the user's value. Items that only exist
// locally are left alone.
export function syncProject(options: ProjectSyncOptions): { workspace: WorkspaceConfig; summary: ProjectSyncSummary } {
  const resolved = resolveProjectItems(options.file, options.values, options.workspace.projectDirectory);
  const names = new Set(resolved.map((item) => item.name));
  const previousBase = options.workspace.project?.base ?? {};
  const removedLocally = new Set(options.workspace.project?.removed ?? []);
  const summary: ProjectSyncSummary = { added: [], updated: [], removed: [] };
  let workspace = options.workspace;

  for (const item of options.workspace.items) {
    if (item.fromProject !== undefined && !names.has(item.fromProject)) {
      workspace = removeItem(workspace, item.id);
      summary.removed.push(item.name);
    }
  }

  for (const wanted of resolved) {
    if (removedLocally.has(wanted.name)) {
      continue;
    }

    const existing = workspace.items.find((item) => item.fromProject === wanted.name);

    if (existing === undefined || existing.kind !== wanted.kind) {
      const id = existing?.id ?? options.generateId(wanted.kind === "service" ? "svc" : "cmd");

      if (existing !== undefined) {
        workspace = removeItem(workspace, existing.id);
      }

      workspace = addItem(workspace, newItem(wanted, id));
      (existing === undefined ? summary.added : summary.updated).push(wanted.name);
      continue;
    }

    const merged = mergeItem(existing, wanted, previousBase[wanted.name]);

    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      workspace = replaceItem(workspace, merged);
      summary.updated.push(wanted.name);
    }
  }

  workspace = linkWaits(workspace, resolved, previousBase, removedLocally, summary);

  return {
    workspace: {
      ...workspace,
      project: {
        hash: options.hash,
        values: options.values,
        base: Object.fromEntries(resolved.map(({ name, ...base }) => [name, base])),
        removed: [...removedLocally].filter((name) => names.has(name)),
      },
    },
    summary,
  };
}

// After a workspace has been written out as a sable.json: marks its items as coming from that file,
// so teammates' later changes to the file reach this workspace like any other imported one.
export function linkWorkspaceToFile(options: {
  workspace: WorkspaceConfig;
  file: ProjectFile;
  hash: string;
  values: Record<string, string>;
  names: Map<string, string>;
}): WorkspaceConfig {
  const resolved = resolveProjectItems(options.file, options.values, options.workspace.projectDirectory);

  return {
    ...options.workspace,
    items: options.workspace.items.map((item) => {
      const name = options.names.get(item.id);
      const exported = resolved.find((candidate) => candidate.name === name);

      // The item now has the secrets the file names, so a later sync compares like with like.
      return name === undefined ? item : { ...item, fromProject: name, secrets: exported?.secrets ?? item.secrets };
    }),
    project: {
      hash: options.hash,
      values: options.values,
      base: Object.fromEntries(resolved.map(({ name, ...base }) => [name, base])),
      removed: [],
    },
  };
}

// Removes an item and, when it came from the project file, remembers that so a sync keeps it away.
export function removeItemHere(workspace: WorkspaceConfig, itemId: string): WorkspaceConfig {
  const item = workspace.items.find((candidate) => candidate.id === itemId);
  const removed = removeItem(workspace, itemId);

  if (item?.fromProject === undefined || workspace.project === undefined) {
    return removed;
  }

  return {
    ...removed,
    project: { ...workspace.project, removed: [...new Set([...workspace.project.removed, item.fromProject])] },
  };
}

export type ProjectChanges = {
  added: ResolvedProjectItem[];
  changed: Array<{ item: ResolvedProjectItem; before: ProjectBaseItem }>;
  removed: string[];
};

// What the file says now compared with what was approved last time (everything is "added" the first time).
export function describeProjectChanges(
  previousBase: Record<string, ProjectBaseItem> | undefined,
  resolved: ResolvedProjectItem[],
): ProjectChanges {
  const before = previousBase ?? {};
  const names = new Set(resolved.map((item) => item.name));
  const changes: ProjectChanges = {
    added: [],
    changed: [],
    removed: Object.keys(before).filter((name) => !names.has(name)),
  };

  for (const item of resolved) {
    const { name, ...base } = item;
    const old = before[name];

    if (old === undefined) {
      changes.added.push(item);
    } else if (JSON.stringify(sortedBase(old)) !== JSON.stringify(sortedBase(base))) {
      changes.changed.push({ item, before: old });
    }
  }

  return changes;
}

function newItem(wanted: ResolvedProjectItem, id: string): ItemConfig {
  const common = {
    id,
    name: wanted.name,
    command: wanted.command,
    cwd: wanted.cwd,
    env: wanted.env,
    after: [],
    fromProject: wanted.name,
    secrets: wanted.secrets,
  };

  return wanted.kind === "service" ? { kind: "service", ...common, autoStart: wanted.autoStart ?? true } : { kind: "command", ...common };
}

function mergeItem(existing: ItemConfig, wanted: ResolvedProjectItem, base: ProjectBaseItem | undefined): ItemConfig {
  const take = <T>(local: T, old: T | undefined, next: T): T =>
    base === undefined || JSON.stringify(local) === JSON.stringify(old) ? next : local;
  const secrets = take(existing.secrets ?? [], base?.secrets, wanted.secrets);
  // The values of secret variables live only here: they are never in the file or the stored base, so they
  // are set apart before comparing, and put back afterwards.
  const secretKeys = new Set([...(base?.secrets ?? []), ...wanted.secrets, ...secrets]);
  const localPublic = Object.fromEntries(Object.entries(existing.env).filter(([key]) => !secretKeys.has(key)));
  const localSecretValues = Object.fromEntries(Object.entries(existing.env).filter(([key]) => secrets.includes(key)));
  const merged = {
    ...existing,
    command: take(existing.command, base?.command, wanted.command),
    cwd: take(existing.cwd, base?.cwd, wanted.cwd),
    env: { ...take(localPublic, base?.env, wanted.env), ...localSecretValues },
    secrets,
  };

  return merged.kind === "service" && existing.kind === "service"
    ? { ...merged, kind: "service", autoStart: take(existing.autoStart, base?.autoStart, wanted.autoStart ?? true) }
    : merged;
}

// Second pass, once every item exists: points "after" at the right local ids.
function linkWaits(
  workspace: WorkspaceConfig,
  resolved: ResolvedProjectItem[],
  previousBase: Record<string, ProjectBaseItem>,
  removedLocally: Set<string>,
  summary: ProjectSyncSummary,
): WorkspaceConfig {
  let current = workspace;

  for (const wanted of resolved) {
    const item = current.items.find((candidate) => candidate.fromProject === wanted.name);

    if (item === undefined) {
      continue;
    }

    const base = previousBase[wanted.name];
    const localKey = item.after.map((id) => current.items.find((candidate) => candidate.id === id)?.fromProject ?? `local:${id}`);
    const untouched = base === undefined || sameNames(localKey, base.after);
    const desired = wanted.after
      .filter((name) => !removedLocally.has(name))
      .flatMap((name) => {
        const target = current.items.find((candidate) => candidate.fromProject === name);

        return target === undefined ? [] : [target.id];
      });

    if (untouched && JSON.stringify(item.after) !== JSON.stringify(desired)) {
      current = replaceItem(current, { ...item, after: desired });

      if (!summary.added.includes(wanted.name) && !summary.updated.includes(wanted.name)) {
        summary.updated.push(wanted.name);
      }
    }
  }

  return current;
}

function sameNames(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sortedBase(base: ProjectBaseItem): unknown {
  return {
    kind: base.kind,
    command: base.command,
    cwd: base.cwd,
    autoStart: base.autoStart ?? null,
    env: Object.entries(base.env).sort(([a], [b]) => (a < b ? -1 : 1)),
    after: [...base.after].sort(),
    secrets: [...(base.secrets ?? [])].sort(),
  };
}

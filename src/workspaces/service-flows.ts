import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, ItemConfig, ItemKind, WorkspaceConfig } from "../config/config-types.js";
import { looksSecret } from "../config/secret-names.js";
import { addItem, dependentsClosure, findDependencyCycle, findItem, itemsOfKind, replaceItem } from "../config/workspace-items.js";
import { removeItemHere } from "../project/project-sync.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import { runForm, type FormErrors, type FormField, type FormValues } from "../tui/form-view.js";
import { displayPath } from "../tui/format.js";
import { runDeleteDialog } from "../tui/delete-dialog.js";
import type { PromptScreen } from "../tui/prompt-view.js";

export type ServiceFlowResult =
  | { type: "completed"; message: string; itemId?: string; removedItemId?: string }
  | { type: "back"; message: string }
  | { type: "exit" };

export type ServiceFlowStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type ServiceFlowOptions = {
  store: ServiceFlowStore;
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
  generateId?: typeof generateShortId;
  directoryExists?: (directoryPath: string) => boolean;
  form?: typeof runForm;
  // The screen the action was started from, shown dimmed behind a popup.
  background?: string;
  deleteDialog?: typeof runDeleteDialog;
};

export type ItemFlowOptions = ServiceFlowOptions & {
  itemId: string;
};

const idPrefixes = { service: "svc", command: "cmd" } as const;

export async function runAddWorkspaceItemFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const result = await (options.form ?? runForm)({
    title: "New service or command",
    subtitle: workspace.name,
    fields: (values) => itemFields(kindOf(values), workspace, true, knownCommands(config, workspace), undefined, values),
    values: { type: "service", name: "", command: "", cwd: ".", autoStart: true, after: [], env: [], secrets: [] },
    validate: (values) => validateItem(kindOf(values), values, workspace, undefined, options.directoryExists ?? defaultDirectoryExists),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Add cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const kind = kindOf(result.values);
  const generateId = options.generateId ?? generateShortId;
  const item = itemFromValues(kind, generateId(idPrefixes[kind]), result.values, workspace);

  await options.store.save(updateWorkspace(config, workspace.id, addItem(workspace, item)));

  return { type: "completed", message: `Added ${kind} "${item.name}".`, itemId: item.id };
}

export async function runEditItemFlow(
  options: ItemFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);
  const item = workspace === undefined ? undefined : findItem(workspace, options.itemId);

  if (workspace === undefined || item === undefined) {
    return { type: "back", message: "That item no longer exists." };
  }

  const kind = item.kind;

  const result = await (options.form ?? runForm)({
    title: `Edit ${kind} "${item.name}"`,
    subtitle: item.fromProject === undefined ? workspace.name : `${workspace.name} · from sable.json, your changes stay on this machine`,
    fields: (values) => itemFields(kind, workspace, false, knownCommands(config, workspace), item.id, values),
    values: {
      name: item.name,
      command: item.command,
      cwd: toDirectoryValue(item.cwd, workspace.projectDirectory),
      ...("autoStart" in item && typeof item.autoStart === "boolean" ? { autoStart: item.autoStart } : {}),
      after: item.after.filter((id) => findItem(workspace, id) !== undefined),
      env: envToList(item.env),
      // An item nobody reviewed yet starts with the variables whose names look private ticked.
      secrets: item.secrets ?? Object.keys(item.env).filter(looksSecret),
    },
    validate: (values) => validateItem(kind, values, workspace, item.id, options.directoryExists ?? defaultDirectoryExists),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Edit cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const nextItem = itemFromValues(kind, item.id, result.values, workspace);

  await options.store.save(updateWorkspace(config, workspace.id, replaceItem(workspace, nextItem)));

  return { type: "completed", message: `Saved ${kind} "${nextItem.name}".`, itemId: nextItem.id };
}

export async function runDeleteItemFlow(
  options: ItemFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const item = findItem(workspace, options.itemId);

  if (item === undefined) {
    return { type: "back", message: "Delete cancelled." };
  }

  const kind = item.kind;

  const confirmation = await (options.deleteDialog ?? runDeleteDialog)({
    title: `Delete ${kind}`,
    explanation: [
      `This removes the ${kind} "${item.name}" from "${workspace.name}".`,
      item.fromProject === undefined
        ? "Your project files stay untouched."
        : "It comes from sable.json, so it is removed on this machine only. The file stays as it is.",
    ],
    name: item.name,
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });

  if (confirmation === "back") {
    return { type: "back", message: `Delete ${kind} cancelled.` };
  }
  if (confirmation === "exit") {
    return { type: "exit" };
  }

  await options.store.save(updateWorkspace(config, workspace.id, removeItemHere(workspace, item.id)));

  return {
    type: "completed",
    message: `Deleted ${kind} "${item.name}" from workspace "${workspace.name}".`,
    removedItemId: item.id,
  };
}

// Commands already saved, for suggestions while typing: this workspace's first, then the
// others', each only once.
export function knownCommands(config: AppConfig, workspace: WorkspaceConfig): string[] {
  const others = config.workspaces.filter((candidate) => candidate.id !== workspace.id);
  const all = [workspace, ...others].flatMap((candidate) => candidate.items.map((item) => item.command.trim()));

  return [...new Set(all)].filter((command) => command !== "");
}

// The items this one could wait for: every other item except those that already wait for it.
function waitOptions(workspace: WorkspaceConfig, selfId: string | undefined): Array<{ value: string; label: string }> {
  const loops = selfId === undefined ? new Set<string>() : dependentsClosure(workspace, selfId);

  return workspace.items
    .filter((candidate) => candidate.id !== selfId && !loops.has(candidate.id))
    .map((candidate) => ({ value: candidate.id, label: `${candidate.name} (${candidate.kind})` }));
}

export function itemFields(kind: ItemKind, workspace: WorkspaceConfig, includeType: boolean, suggestions: string[] = [], selfId?: string, values: FormValues = {}): FormField[] {
  return [
    ...(includeType
      ? [{
        type: "choice" as const,
        key: "type",
        label: "Type",
        choices: [{ value: "service", label: "service" }, { value: "command", label: "command" }],
      }]
      : []),
    { type: "text", key: "name", label: "Name", hint: "Shown in the dashboard and logs" },
    {
      type: "text",
      key: "command",
      label: "Command",
      suggestions,
      hint: kind === "service" ? "Keeps running until stopped, e.g. npm run dev" : "Runs once, e.g. npm run migrate",
    },
    { type: "text", key: "cwd", label: "Directory", pathBase: workspace.projectDirectory, hint: `Relative to ${displayPath(workspace.projectDirectory)}` },
    ...(kind === "service" ? [{ type: "toggle" as const, key: "autoStart", label: "Auto-start" }] : []),
    {
      type: "multi",
      key: "after",
      label: "After",
      hint: "waits until it is up (service) or done (command)",
      options: waitOptions(workspace, selfId),
      emptyText: "No other items yet",
    },
    { type: "list", key: "env", label: "Env", hint: "KEY=value, e.g. PORT=3000", addLabel: "add variable" },
    {
      type: "multi",
      key: "secrets",
      label: "Secret",
      hint: "kept out of sable.json",
      options: secretOptions(values),
      emptyText: "Add a variable above to mark it secret",
    },
  ];
}

// The variables that can be marked secret: the ones typed in Env, and any already marked (an item imported from a
// sable.json may need a secret that has no value on this machine yet).
function secretOptions(values: FormValues): Array<{ value: string; label: string }> {
  const typed = new Set(list(values.env).flatMap((row) => /^([A-Za-z_][A-Za-z0-9_]*)=/s.exec(row.trim())?.[1] ?? []));
  const marked = list(values.secrets);
  const keys = [...new Set([...typed, ...marked])];

  return keys.map((key) => ({
    value: key,
    label: marked.includes(key)
      ? (typed.has(key) ? key : `${key} (no value yet)`)
      : (looksSecret(key) ? `${key} (looks secret)` : key),
  }));
}

export function validateItem(
  kind: ItemKind,
  values: FormValues,
  workspace: WorkspaceConfig,
  selfId: string | undefined,
  directoryExists: (directoryPath: string) => boolean,
): FormErrors {
  const errors: FormErrors = {};
  const name = text(values.name);
  const siblings = itemsOfKind(workspace, kind);

  if (name === "") {
    errors.name = "Name is required.";
  } else if (siblings.some((sibling) => sibling.id !== selfId && normalizeName(sibling.name) === normalizeName(name))) {
    errors.name = `A ${kind} named "${name}" already exists.`;
  }

  if (text(values.command) === "") {
    errors.command = "Command is required.";
  }

  const cwd = text(values.cwd) === "" ? "." : text(values.cwd);

  if (!directoryExists(path.resolve(workspace.projectDirectory, cwd))) {
    errors.cwd = "This folder doesn't exist.";
  }

  const dependencyError = checkAfter(workspace, list(values.after), selfId);

  if (dependencyError !== undefined) {
    errors.after = dependencyError;
  }

  const seenKeys = new Set<string>();

  for (const [index, item] of list(values.env).entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(item.trim());

    if (match === null) {
      errors[`env.${index}`] = "Use KEY=value, e.g. PORT=3000.";
    } else if (seenKeys.has(match[1]!)) {
      errors[`env.${index}`] = `${match[1]} is set twice.`;
    } else {
      seenKeys.add(match[1]!);
    }
  }

  return errors;
}

// The form only offers items that cannot cause trouble; this guards values that did not come from it.
function checkAfter(workspace: WorkspaceConfig, ids: string[], selfId: string | undefined): string | undefined {
  if (ids.some((id) => findItem(workspace, id) === undefined)) {
    return "One of these items no longer exists.";
  }

  if (selfId !== undefined && ids.includes(selfId)) {
    return "An item can't wait for itself.";
  }

  const cycle = selfId === undefined ? undefined : findDependencyCycle(workspace.items.map((item) => item.id === selfId ? { ...item, after: ids } : item));

  return cycle === undefined ? undefined : `That would make items wait for each other: ${cycle.join(" → ")}.`;
}

function itemFromValues(kind: ItemKind, id: string, values: FormValues, workspace: WorkspaceConfig): ItemConfig {
  const item = {
    id,
    after: [...new Set(list(values.after))].filter((afterId) => afterId !== id && findItem(workspace, afterId) !== undefined),
    name: text(values.name),
    command: text(values.command),
    cwd: path.resolve(workspace.projectDirectory, text(values.cwd) === "" ? "." : text(values.cwd)),
    env: listToEnv(list(values.env)),
    // Once an item has been through the form, its secrets are the user's own decision, even if none.
    secrets: [...new Set(list(values.secrets))],
  };

  return kind === "service" ? { kind, ...item, autoStart: values.autoStart === true } : { kind, ...item };
}

// Shows folders inside the project as relative paths, and anything else as-is.
export function toDirectoryValue(directory: string, projectDirectory: string): string {
  const relative = path.relative(projectDirectory, directory);

  if (relative === "") {
    return ".";
  }

  return relative.startsWith("..") || path.isAbsolute(relative) ? directory : relative;
}

function envToList(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function listToEnv(items: string[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => {
    const separator = item.indexOf("=");

    return [item.slice(0, separator).trim(), item.slice(separator + 1)];
  }));
}

function kindOf(values: FormValues): ItemKind {
  return values.type === "command" ? "command" : "service";
}

function text(value: FormValues[string] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: FormValues[string] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function findWorkspace(config: AppConfig, workspaceId: string): WorkspaceConfig | undefined {
  return config.workspaces.find((workspace) => workspace.id === workspaceId);
}

function updateWorkspace(
  config: AppConfig,
  workspaceId: string,
  workspace: WorkspaceConfig,
): AppConfig {
  return {
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspaceId ? workspace : candidate,
    ),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultDirectoryExists(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

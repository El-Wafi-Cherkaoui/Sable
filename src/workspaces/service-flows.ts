import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, ItemConfig, ItemKind, WorkspaceConfig } from "../config/config-types.js";
import { addItem, afterNames, findDependencyCycle, findItem, itemsOfKind, removeItem, replaceItem } from "../config/workspace-items.js";
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
    fields: (values) => itemFields(kindOf(values), workspace, true, knownCommands(config, workspace)),
    values: { type: "service", name: "", command: "", cwd: ".", autoStart: true, after: [], env: [] },
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
    subtitle: workspace.name,
    fields: () => itemFields(kind, workspace, false, knownCommands(config, workspace)),
    values: {
      name: item.name,
      command: item.command,
      cwd: toDirectoryValue(item.cwd, workspace.projectDirectory),
      ...("autoStart" in item && typeof item.autoStart === "boolean" ? { autoStart: item.autoStart } : {}),
      after: afterNames(workspace, item),
      env: envToList(item.env),
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
      "Your project files stay untouched.",
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

  await options.store.save(updateWorkspace(config, workspace.id, removeItem(workspace, item.id)));

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

export function itemFields(kind: ItemKind, workspace: WorkspaceConfig, includeType: boolean, suggestions: string[] = []): FormField[] {
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
      type: "list",
      key: "after",
      label: "After",
      hint: kind === "service" ? "Names of items to wait for, e.g. db" : "Names of items to finish first, e.g. build",
      addLabel: "add item",
    },
    { type: "list", key: "env", label: "Env", hint: "KEY=value, e.g. PORT=3000", addLabel: "add variable" },
  ];
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

  const dependencies = resolveAfter(workspace, list(values.after), selfId);

  Object.assign(errors, dependencies.errors);

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

// Turns the names typed in the After rows into item ids, or says which row is wrong.
function resolveAfter(
  workspace: WorkspaceConfig,
  names: string[],
  selfId: string | undefined,
): { ids: string[]; errors: FormErrors } {
  const ids: string[] = [];
  const errors: FormErrors = {};

  for (const [index, raw] of names.entries()) {
    const name = raw.trim();
    const matches = workspace.items.filter((item) => normalizeName(item.name) === normalizeName(name));
    const match = matches[0];

    if (name === "") {
      errors[`after.${index}`] = "Type the name of an item.";
    } else if (match === undefined) {
      errors[`after.${index}`] = `There is no service or command named "${name}".`;
    } else if (matches.length > 1) {
      errors[`after.${index}`] = `Two items are named "${name}". Rename one of them first.`;
    } else if (match.id === selfId) {
      errors[`after.${index}`] = "An item can't wait for itself.";
    } else if (ids.includes(match.id)) {
      errors[`after.${index}`] = `"${name}" is listed twice.`;
    } else {
      ids.push(match.id);
    }
  }

  if (Object.keys(errors).length === 0 && selfId !== undefined) {
    const cycle = findDependencyCycle(workspace.items.map((item) => item.id === selfId ? { ...item, after: ids } : item));
    const row = cycle === undefined ? -1 : names.findIndex((name) => cycle.some((member) => normalizeName(member) === normalizeName(name)));

    if (cycle !== undefined) {
      errors[`after.${Math.max(0, row)}`] = `That would make items wait for each other: ${cycle.join(" → ")}.`;
    }
  }

  return { ids, errors };
}

function itemFromValues(kind: ItemKind, id: string, values: FormValues, workspace: WorkspaceConfig): ItemConfig {
  const item = {
    id,
    after: resolveAfter(workspace, list(values.after), id).ids,
    name: text(values.name),
    command: text(values.command),
    cwd: path.resolve(workspace.projectDirectory, text(values.cwd) === "" ? "." : text(values.cwd)),
    env: listToEnv(list(values.env)),
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

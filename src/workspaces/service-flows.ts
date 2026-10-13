import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import { runForm, type FormErrors, type FormField, type FormValues } from "../tui/form-view.js";
import { displayPath } from "../tui/format.js";
import { runDeleteDialog } from "../tui/delete-dialog.js";
import type { PromptScreen } from "../tui/prompt-view.js";

export type ServiceFlowResult =
  | { type: "completed"; message: string; serviceId?: string; commandId?: string; removedServiceId?: string; removedCommandId?: string }
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
  serviceId?: string;
  commandId?: string;
  form?: typeof runForm;
  // The screen the action was started from, shown dimmed behind a popup.
  background?: string;
  deleteDialog?: typeof runDeleteDialog;
};

export type DeleteServiceFlowOptions = ServiceFlowOptions & {
  serviceId: string;
};

export type DeleteCommandFlowOptions = ServiceFlowOptions & {
  commandId: string;
};

type ItemKind = "service" | "command";

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
    values: { type: "service", name: "", command: "", cwd: ".", autoStart: true, env: [] },
    validate: (values) => validateItem(kindOf(values), values, workspace, undefined, options.directoryExists ?? defaultDirectoryExists),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Add cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const kind = kindOf(result.values);
  const generateId = options.generateId ?? generateShortId;

  if (kind === "service") {
    const service: ServiceConfig = { id: generateId("svc"), ...serviceFromValues(result.values, workspace) };

    await options.store.save(updateWorkspace(config, workspace.id, { ...workspace, services: [...workspace.services, service] }));

    return { type: "completed", message: `Added service "${service.name}".`, serviceId: service.id };
  }

  const command: CommandConfig = { id: generateId("cmd"), ...commandFromValues(result.values, workspace) };

  await options.store.save(updateWorkspace(config, workspace.id, { ...workspace, commands: [...workspace.commands, command] }));

  return { type: "completed", message: `Added command "${command.name}".`, commandId: command.id };
}

export async function runEditServiceFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);
  const service = workspace?.services.find((candidate) => candidate.id === options.serviceId);

  if (workspace === undefined || service === undefined) {
    return { type: "back", message: "That service no longer exists." };
  }

  const result = await (options.form ?? runForm)({
    title: `Edit service "${service.name}"`,
    subtitle: workspace.name,
    fields: () => itemFields("service", workspace, false, knownCommands(config, workspace)),
    values: {
      name: service.name,
      command: service.command,
      cwd: toDirectoryValue(service.cwd, workspace.projectDirectory),
      autoStart: service.autoStart,
      env: envToList(service.env),
    },
    validate: (values) => validateItem("service", values, workspace, service.id, options.directoryExists ?? defaultDirectoryExists),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Edit cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const nextService: ServiceConfig = { id: service.id, ...serviceFromValues(result.values, workspace) };

  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    services: workspace.services.map((candidate) => candidate.id === service.id ? nextService : candidate),
  }));

  return { type: "completed", message: `Saved service "${nextService.name}".`, serviceId: nextService.id };
}

export async function runEditCommandFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);
  const command = workspace?.commands.find((candidate) => candidate.id === options.commandId);

  if (workspace === undefined || command === undefined) {
    return { type: "back", message: "That command no longer exists." };
  }

  const result = await (options.form ?? runForm)({
    title: `Edit command "${command.name}"`,
    subtitle: workspace.name,
    fields: () => itemFields("command", workspace, false, knownCommands(config, workspace)),
    values: {
      name: command.name,
      command: command.command,
      cwd: toDirectoryValue(command.cwd, workspace.projectDirectory),
      env: envToList(command.env),
    },
    validate: (values) => validateItem("command", values, workspace, command.id, options.directoryExists ?? defaultDirectoryExists),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Edit cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const nextCommand: CommandConfig = { id: command.id, ...commandFromValues(result.values, workspace) };

  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    commands: workspace.commands.map((candidate) => candidate.id === command.id ? nextCommand : candidate),
  }));

  return { type: "completed", message: `Saved command "${nextCommand.name}".`, commandId: nextCommand.id };
}

export async function runDeleteCommandFlow(
  options: DeleteCommandFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const command = workspace.commands.find((candidate) => candidate.id === options.commandId);

  if (command === undefined) {
    return { type: "back", message: "Delete cancelled." };
  }

  const confirmation = await (options.deleteDialog ?? runDeleteDialog)({
    title: "Delete command",
    explanation: [
      `This removes the command "${command.name}" from "${workspace.name}".`,
      "Your project files stay untouched.",
    ],
    name: command.name,
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });

  if (confirmation === "back") {
    return { type: "back", message: "Delete command cancelled." };
  }
  if (confirmation === "exit") {
    return { type: "exit" };
  }

  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    commands: workspace.commands.filter((candidate) => candidate.id !== command.id),
  }));

  return {
    type: "completed",
    message: `Deleted command "${command.name}" from workspace "${workspace.name}".`,
    removedCommandId: command.id,
  };
}

export async function runDeleteServiceFlow(
  options: DeleteServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const service = workspace.services.find((candidate) => candidate.id === options.serviceId);

  if (service === undefined) {
    return { type: "back", message: "Delete cancelled." };
  }

  const confirmation = await (options.deleteDialog ?? runDeleteDialog)({
    title: "Delete service",
    explanation: [
      `This removes the service "${service.name}" from "${workspace.name}".`,
      "Your project files stay untouched.",
    ],
    name: service.name,
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });

  if (confirmation === "back") {
    return { type: "back", message: "Delete service cancelled." };
  }
  if (confirmation === "exit") {
    return { type: "exit" };
  }

  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    services: workspace.services.filter((candidate) => candidate.id !== service.id),
  }));

  return {
    type: "completed",
    message: `Deleted service "${service.name}" from workspace "${workspace.name}".`,
    removedServiceId: service.id,
  };
}

// Commands already saved, for suggestions while typing: this workspace's first, then the
// others', each only once.
export function knownCommands(config: AppConfig, workspace: WorkspaceConfig): string[] {
  const others = config.workspaces.filter((candidate) => candidate.id !== workspace.id);
  const all = [workspace, ...others].flatMap((candidate) => [...candidate.services, ...candidate.commands].map((item) => item.command.trim()));

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
  const siblings: Array<{ id: string; name: string }> = kind === "service" ? workspace.services : workspace.commands;

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

function serviceFromValues(values: FormValues, workspace: WorkspaceConfig): Omit<ServiceConfig, "id"> {
  return { ...commandFromValues(values, workspace), autoStart: values.autoStart === true };
}

function commandFromValues(values: FormValues, workspace: WorkspaceConfig): Omit<CommandConfig, "id"> {
  return {
    name: text(values.name),
    command: text(values.command),
    cwd: path.resolve(workspace.projectDirectory, text(values.cwd) === "" ? "." : text(values.cwd)),
    env: listToEnv(list(values.env)),
  };
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

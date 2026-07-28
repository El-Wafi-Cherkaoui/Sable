import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import {
  runConfirmPrompt,
  runSelectPrompt,
  runTextPrompt,
  type PromptScreen,
} from "../tui/prompt-view.js";

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
};

export type DeleteServiceFlowOptions = ServiceFlowOptions & {
  serviceId: string;
};

export type DeleteCommandFlowOptions = ServiceFlowOptions & {
  commandId: string;
};

type EditAction = "rename" | "command" | "cwd" | "autoStart" | "remove";
type EditCommandAction = "rename" | "command" | "cwd" | "remove";
type AddWorkspaceItemKind = "service" | "command";

export async function runAddWorkspaceItemFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const kindResult = await runSelectPrompt<AddWorkspaceItemKind>({
    title: "Add to workspace",
    message: "What do you want to add?",
    keyInput: options.keyInput,
    screen: options.screen,
    choices: [
      { label: "Service", value: "service" },
      { label: "Command", value: "command" },
    ],
  });

  if (kindResult.type === "back") return { type: "back", message: "Add cancelled." };
  if (kindResult.type === "exit") return { type: "exit" };

  return kindResult.value === "service"
    ? runAddServiceFlow(options)
    : runAddCommandFlow(options);
}

export async function runAddCommandFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const baseDirectory = workspace.projectDirectory;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;
  const nameResult = await runTextPrompt({
    title: "Add command",
    message: "Command name",
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Command name is required.";
      }

      if (workspace.commands.some((command) => normalizeName(command.name) === normalizeName(trimmedValue))) {
        return `Command "${trimmedValue}" already exists in this workspace.`;
      }

      return true;
    },
  });
  if (nameResult.type === "back") return { type: "back", message: "Add command cancelled." };
  if (nameResult.type === "exit") return { type: "exit" };

  const commandResult = await runTextPrompt({
    title: "Add command",
    message: "Command",
    keyInput: options.keyInput,
    screen: options.screen,
    validate: requiredValue("Command is required."),
  });
  if (commandResult.type === "back") return { type: "back", message: "Add command cancelled." };
  if (commandResult.type === "exit") return { type: "exit" };

  const cwdResult = await runTextPrompt({
    title: "Add command",
    message: "Working directory",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: baseDirectory,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Command working directory is required.";
      }

      if (!directoryExists(resolveServiceWorkingDirectory(trimmedValue, baseDirectory))) {
        return "Command working directory must exist and be a directory.";
      }

      return true;
    },
  });
  if (cwdResult.type === "back") return { type: "back", message: "Add command cancelled." };
  if (cwdResult.type === "exit") return { type: "exit" };

  const command: CommandConfig = {
    id: (options.generateId ?? generateShortId)("cmd"),
    name: nameResult.value.trim(),
    command: commandResult.value.trim(),
    cwd: resolveServiceWorkingDirectory(cwdResult.value.trim(), baseDirectory),
    env: {},
  };

  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    commands: [...workspace.commands, command],
  }));

  return {
    type: "completed",
    message: `Added command "${command.name}" to workspace "${workspace.name}".`,
    commandId: command.id,
  };
}

export async function runAddServiceFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const baseDirectory = workspace.projectDirectory;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;
  const nameResult = await runTextPrompt({
    title: "Add service",
    message: "Service name",
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Service name is required.";
      }

      if (workspace.services.some((service) => normalizeName(service.name) === normalizeName(trimmedValue))) {
        return `Service "${trimmedValue}" already exists in this workspace.`;
      }

      return true;
    },
  });
  if (nameResult.type === "back") return { type: "back", message: "Add service cancelled." };
  if (nameResult.type === "exit") return { type: "exit" };

  const commandResult = await runTextPrompt({
    title: "Add service",
    message: "Command",
    keyInput: options.keyInput,
    screen: options.screen,
    validate: requiredValue("Service command is required."),
  });
  if (commandResult.type === "back") return { type: "back", message: "Add service cancelled." };
  if (commandResult.type === "exit") return { type: "exit" };

  const cwdResult = await runTextPrompt({
    title: "Add service",
    message: "Working directory",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: baseDirectory,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Service working directory is required.";
      }

      if (!directoryExists(resolveServiceWorkingDirectory(trimmedValue, baseDirectory))) {
        return "Service working directory must exist and be a directory.";
      }

      return true;
    },
  });
  if (cwdResult.type === "back") return { type: "back", message: "Add service cancelled." };
  if (cwdResult.type === "exit") return { type: "exit" };

  const autoStartResult = await runConfirmPrompt({
    title: "Add service",
    message: "Auto-start this service?",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: true,
  });
  if (autoStartResult.type === "back") return { type: "back", message: "Add service cancelled." };
  if (autoStartResult.type === "exit") return { type: "exit" };

  const service: ServiceConfig = {
    id: (options.generateId ?? generateShortId)("svc"),
    name: nameResult.value.trim(),
    command: commandResult.value.trim(),
    cwd: resolveServiceWorkingDirectory(cwdResult.value.trim(), baseDirectory),
    autoStart: autoStartResult.value,
    env: {},
  };

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspace.id
        ? { ...candidate, services: [...candidate.services, service] }
        : candidate,
    ),
  });

  return {
    type: "completed",
    message: `Added service "${service.name}" to workspace "${workspace.name}".`,
    serviceId: service.id,
  };
}

export async function runEditServiceFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  if (workspace.services.length === 0) {
    return { type: "back", message: `Workspace "${workspace.name}" has no services to edit.` };
  }

  const service = options.serviceId === undefined
    ? await promptForServiceToEdit({
      workspace,
      keyInput: options.keyInput,
      screen: options.screen,
    })
    : workspace.services.find((candidate) => candidate.id === options.serviceId);

  if (service === "back") return { type: "back", message: "Edit cancelled." };
  if (service === "exit") return { type: "exit" };
  if (service === undefined) return { type: "back", message: "Edit cancelled." };

  const actionResult = await runSelectPrompt<EditAction>({
    title: "Edit service",
    message: "Action",
    keyInput: options.keyInput,
    screen: options.screen,
    choices: [
      { label: "Rename service", value: "rename" },
      { label: "Edit command", value: "command" },
      { label: "Edit working directory", value: "cwd" },
      { label: "Toggle auto-start", value: "autoStart" },
      { label: "Remove service", value: "remove" },
    ],
  });
  if (actionResult.type === "back") return { type: "back", message: "Edit cancelled." };
  if (actionResult.type === "exit") return { type: "exit" };

  if (actionResult.value === "remove") {
    const confirmResult = await runConfirmPrompt({
      title: "Edit service",
      message: `Remove service "${service.name}"?`,
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: false,
    });
    if (confirmResult.type === "back") return { type: "back", message: "Edit cancelled." };
    if (confirmResult.type === "exit") return { type: "exit" };
    if (!confirmResult.value) return { type: "back", message: "Remove cancelled." };

    await options.store.save(updateWorkspace(config, workspace.id, {
      ...workspace,
      services: workspace.services.filter((candidate) => candidate.id !== service.id),
    }));

    return {
      type: "completed",
      message: `Removed service "${service.name}" from workspace "${workspace.name}".`,
      removedServiceId: service.id,
    };
  }

  const nextServiceResult = await updateServiceFromAction({
    action: actionResult.value,
    service,
    keyInput: options.keyInput,
    screen: options.screen,
    directoryExists,
    workspace,
  });
  if (nextServiceResult.type === "back") return { type: "back", message: "Edit cancelled." };
  if (nextServiceResult.type === "exit") return { type: "exit" };

  const nextService = nextServiceResult.value;
  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    services: workspace.services.map((candidate) => candidate.id === service.id ? nextService : candidate),
  }));

  return {
    type: "completed",
    message: formatUpdateMessage(actionResult.value, service, nextService),
    serviceId: nextService.id,
  };
}

export async function runEditCommandFlow(
  options: ServiceFlowOptions,
): Promise<ServiceFlowResult> {
  const config = await options.store.load();
  const workspace = findWorkspace(config, options.workspace.id);
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  if (workspace.commands.length === 0) {
    return { type: "back", message: `Workspace "${workspace.name}" has no commands to edit.` };
  }

  const command = options.commandId === undefined
    ? await promptForCommandToEdit({ workspace, keyInput: options.keyInput, screen: options.screen })
    : workspace.commands.find((candidate) => candidate.id === options.commandId);

  if (command === "back") return { type: "back", message: "Edit cancelled." };
  if (command === "exit") return { type: "exit" };
  if (command === undefined) return { type: "back", message: "Edit cancelled." };

  const actionResult = await runSelectPrompt<EditCommandAction>({
    title: "Edit command",
    message: "Action",
    keyInput: options.keyInput,
    screen: options.screen,
    choices: [
      { label: "Rename command", value: "rename" },
      { label: "Edit command", value: "command" },
      { label: "Edit working directory", value: "cwd" },
      { label: "Remove command", value: "remove" },
    ],
  });
  if (actionResult.type === "back") return { type: "back", message: "Edit cancelled." };
  if (actionResult.type === "exit") return { type: "exit" };

  if (actionResult.value === "remove") {
    const confirmResult = await runConfirmPrompt({
      title: "Edit command",
      message: `Remove command "${command.name}"?`,
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: false,
    });
    if (confirmResult.type === "back") return { type: "back", message: "Edit cancelled." };
    if (confirmResult.type === "exit") return { type: "exit" };
    if (!confirmResult.value) return { type: "back", message: "Remove cancelled." };

    await options.store.save(updateWorkspace(config, workspace.id, {
      ...workspace,
      commands: workspace.commands.filter((candidate) => candidate.id !== command.id),
    }));

    return {
      type: "completed",
      message: `Removed command "${command.name}" from workspace "${workspace.name}".`,
      removedCommandId: command.id,
    };
  }

  const nextCommandResult = await updateCommandFromAction({
    action: actionResult.value,
    command,
    workspace,
    keyInput: options.keyInput,
    screen: options.screen,
    directoryExists,
  });
  if (nextCommandResult.type === "back") return { type: "back", message: "Edit cancelled." };
  if (nextCommandResult.type === "exit") return { type: "exit" };

  const nextCommand = nextCommandResult.value;
  await options.store.save(updateWorkspace(config, workspace.id, {
    ...workspace,
    commands: workspace.commands.map((candidate) => candidate.id === command.id ? nextCommand : candidate),
  }));

  return {
    type: "completed",
    message: formatCommandUpdateMessage(actionResult.value, command, nextCommand),
    commandId: nextCommand.id,
  };
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

  const confirmationResult = await runTextPrompt({
    title: "Delete command",
    message: `Type "${command.name}" to delete this command`,
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      return value === command.name ? true : "Name does not match. Try again or press Esc to cancel.";
    },
  });

  if (confirmationResult.type === "back") {
    return { type: "back", message: "Delete command cancelled." };
  }
  if (confirmationResult.type === "exit") {
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

  const confirmationResult = await runTextPrompt({
    title: "Delete service",
    message: `Type "${service.name}" to delete this service`,
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      return value === service.name ? true : "Name does not match. Try again or press Esc to cancel.";
    },
  });

  if (confirmationResult.type === "back") {
    return { type: "back", message: "Delete service cancelled." };
  }
  if (confirmationResult.type === "exit") {
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

async function promptForServiceToEdit(options: {
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
}): Promise<ServiceConfig | "back" | "exit" | undefined> {
  const serviceResult = await runSelectPrompt({
    title: "Edit service",
    message: "Service",
    keyInput: options.keyInput,
    screen: options.screen,
    choices: options.workspace.services.map((service) => ({ label: service.name, value: service.id })),
  });

  if (serviceResult.type === "back") return "back";
  if (serviceResult.type === "exit") return "exit";

  return options.workspace.services.find((candidate) => candidate.id === serviceResult.value);
}

async function promptForCommandToEdit(options: {
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
}): Promise<CommandConfig | "back" | "exit" | undefined> {
  const commandResult = await runSelectPrompt({
    title: "Edit command",
    message: "Command",
    keyInput: options.keyInput,
    screen: options.screen,
    choices: options.workspace.commands.map((command) => ({ label: command.name, value: command.id })),
  });

  if (commandResult.type === "back") return "back";
  if (commandResult.type === "exit") return "exit";

  return options.workspace.commands.find((candidate) => candidate.id === commandResult.value);
}

type UpdateCommandFromActionOptions = {
  action: Exclude<EditCommandAction, "remove">;
  command: CommandConfig;
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
  directoryExists: (directoryPath: string) => boolean;
};

async function updateCommandFromAction(
  options: UpdateCommandFromActionOptions,
): Promise<{ type: "submit"; value: CommandConfig } | { type: "back" } | { type: "exit" }> {
  if (options.action === "rename") {
    const result = await runTextPrompt({
      title: "Edit command",
      message: "Command name",
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: options.command.name,
      validate(value) {
        const trimmedValue = value.trim();

        if (trimmedValue.length === 0) {
          return "Command name is required.";
        }

        if (options.workspace.commands.some((candidate) =>
          candidate.id !== options.command.id &&
          normalizeName(candidate.name) === normalizeName(trimmedValue)
        )) {
          return `Command "${trimmedValue}" already exists in this workspace.`;
        }

        return true;
      },
    });

    if (result.type !== "submit") return result;
    return { type: "submit", value: { ...options.command, name: result.value.trim() } };
  }

  if (options.action === "command") {
    const result = await runTextPrompt({
      title: "Edit command",
      message: "Command",
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: options.command.command,
      validate: requiredValue("Command is required."),
    });

    if (result.type !== "submit") return result;
    return { type: "submit", value: { ...options.command, command: result.value.trim() } };
  }

  const result = await runTextPrompt({
    title: "Edit command",
    message: "Working directory",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: options.command.cwd,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Command working directory is required.";
      }

      if (!options.directoryExists(resolveServiceWorkingDirectory(trimmedValue, options.command.cwd))) {
        return "Command working directory must exist and be a directory.";
      }

      return true;
    },
  });

  if (result.type !== "submit") return result;
  return {
    type: "submit",
    value: {
      ...options.command,
      cwd: resolveServiceWorkingDirectory(result.value.trim(), options.command.cwd),
    },
  };
}

type UpdateServiceFromActionOptions = {
  action: Exclude<EditAction, "remove">;
  service: ServiceConfig;
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
  directoryExists: (directoryPath: string) => boolean;
};

async function updateServiceFromAction(
  options: UpdateServiceFromActionOptions,
): Promise<{ type: "submit"; value: ServiceConfig } | { type: "back" } | { type: "exit" }> {
  if (options.action === "rename") {
    const result = await runTextPrompt({
      title: "Edit service",
      message: "Service name",
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: options.service.name,
      validate(value) {
        const trimmedValue = value.trim();

        if (trimmedValue.length === 0) {
          return "Service name is required.";
        }

        if (options.workspace.services.some((candidate) =>
          candidate.id !== options.service.id &&
          normalizeName(candidate.name) === normalizeName(trimmedValue)
        )) {
          return `Service "${trimmedValue}" already exists in this workspace.`;
        }

        return true;
      },
    });

    if (result.type !== "submit") return result;
    return { type: "submit", value: { ...options.service, name: result.value.trim() } };
  }

  if (options.action === "autoStart") {
    return { type: "submit", value: { ...options.service, autoStart: !options.service.autoStart } };
  }

  if (options.action === "command") {
    const result = await runTextPrompt({
      title: "Edit service",
      message: "Command",
      keyInput: options.keyInput,
      screen: options.screen,
      defaultValue: options.service.command,
      validate: requiredValue("Service command is required."),
    });

    if (result.type !== "submit") return result;
    return { type: "submit", value: { ...options.service, command: result.value.trim() } };
  }

  const result = await runTextPrompt({
    title: "Edit service",
    message: "Working directory",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: options.service.cwd,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Service working directory is required.";
      }

      if (!options.directoryExists(resolveServiceWorkingDirectory(trimmedValue, options.service.cwd))) {
        return "Service working directory must exist and be a directory.";
      }

      return true;
    },
  });

  if (result.type !== "submit") return result;
  return {
    type: "submit",
    value: {
      ...options.service,
      cwd: resolveServiceWorkingDirectory(result.value.trim(), options.service.cwd),
    },
  };
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

function formatUpdateMessage(
  action: Exclude<EditAction, "remove">,
  previousService: ServiceConfig,
  service: ServiceConfig,
): string {
  switch (action) {
    case "rename":
      return `Renamed service "${previousService.name}" to "${service.name}".`;
    case "command":
      return `Updated command for "${service.name}".`;
    case "cwd":
      return `Updated working directory for "${service.name}".`;
    case "autoStart":
      return `Auto-start ${service.autoStart ? "enabled" : "disabled"} for "${service.name}".`;
  }
}

function formatCommandUpdateMessage(
  action: Exclude<EditCommandAction, "remove">,
  previousCommand: CommandConfig,
  command: CommandConfig,
): string {
  switch (action) {
    case "rename":
      return `Renamed command "${previousCommand.name}" to "${command.name}".`;
    case "command":
      return `Updated command for "${command.name}".`;
    case "cwd":
      return `Updated working directory for "${command.name}".`;
  }
}

function resolveServiceWorkingDirectory(rawWorkingDirectory: string, baseDirectory: string): string {
  return path.isAbsolute(rawWorkingDirectory)
    ? rawWorkingDirectory
    : path.resolve(baseDirectory, rawWorkingDirectory);
}

function requiredValue(message: string): (value: string) => boolean | string {
  return (value) => (value.trim().length > 0 ? true : message);
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

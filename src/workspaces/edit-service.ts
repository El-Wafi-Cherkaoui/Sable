import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, ServiceConfig } from "../config/config-types.js";
import { WorkspaceIdNotFoundError, type DirectoryExists } from "./add-service.js";

export type EditServiceConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type EditServiceAction = "command" | "cwd" | "autoStart" | "remove";

export type EditServicePrompts = {
  confirm(options: { message: string; default?: boolean }): Promise<boolean>;
  input(options: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;
  select<T extends string>(options: {
    message: string;
    choices: Array<{ name: string; value: T }>;
  }): Promise<T>;
};

export type EditServiceOutput = {
  log(message: string): void;
};

export type EditServiceInWorkspaceOptions = {
  store: EditServiceConfigStore;
  prompts: EditServicePrompts;
  output?: EditServiceOutput;
  directoryExists?: DirectoryExists;
};

export async function runEditServiceInWorkspaceCommand(
  workspaceId: string,
  options: EditServiceInWorkspaceOptions,
): Promise<void> {
  const output = options.output ?? console;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex(
    (workspace) => workspace.id === workspaceId,
  );

  if (workspaceIndex === -1) {
    throw new WorkspaceIdNotFoundError(workspaceId);
  }

  const workspace = config.workspaces[workspaceIndex];

  if (workspace.services.length === 0) {
    output.log(`Workspace "${workspace.name}" has no services to edit.`);
    return;
  }

  const serviceId = await options.prompts.select({
    message: "Service",
    choices: workspace.services.map((service) => ({
      name: service.name,
      value: service.id,
    })),
  });

  const service = workspace.services.find((candidate) => candidate.id === serviceId);

  if (service === undefined) {
    return;
  }

  const action = await options.prompts.select<EditServiceAction>({
    message: "Edit action",
    choices: [
      { name: "Edit command", value: "command" },
      { name: "Edit working directory", value: "cwd" },
      { name: "Toggle auto-start", value: "autoStart" },
      { name: "Remove service", value: "remove" },
    ],
  });

  if (action === "remove") {
    await removeService({ config, workspaceIndex, service, options, output });
    return;
  }

  const nextService = await editService({
    service,
    action,
    prompts: options.prompts,
    directoryExists,
  });

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate, index) =>
      index === workspaceIndex
        ? {
            ...candidate,
            services: candidate.services.map((candidateService) =>
              candidateService.id === service.id ? nextService : candidateService,
            ),
          }
        : candidate,
    ),
  });

  output.log(formatUpdateMessage(action, nextService));
}

type EditServiceOptions = {
  service: ServiceConfig;
  action: Exclude<EditServiceAction, "remove">;
  prompts: EditServicePrompts;
  directoryExists: DirectoryExists;
};

async function editService(options: EditServiceOptions): Promise<ServiceConfig> {
  switch (options.action) {
    case "command": {
      const command = await options.prompts.input({
        message: "Command",
        default: options.service.command,
        validate: requiredValue("Service command is required."),
      });

      return { ...options.service, command: command.trim() };
    }
    case "cwd": {
      const cwd = await options.prompts.input({
        message: "Working directory",
        default: options.service.cwd,
        validate(value) {
          const trimmedValue = value.trim();

          if (trimmedValue.length === 0) {
            return "Service working directory is required.";
          }

          const resolvedPath = resolveServiceWorkingDirectory(
            trimmedValue,
            options.service.cwd,
          );

          if (!options.directoryExists(resolvedPath)) {
            return "Service working directory must exist and be a directory.";
          }

          return true;
        },
      });

      return {
        ...options.service,
        cwd: resolveServiceWorkingDirectory(cwd.trim(), options.service.cwd),
      };
    }
    case "autoStart":
      return { ...options.service, autoStart: !options.service.autoStart };
  }
}

type RemoveServiceOptions = {
  config: AppConfig;
  workspaceIndex: number;
  service: ServiceConfig;
  options: EditServiceInWorkspaceOptions;
  output: EditServiceOutput;
};

async function removeService(removeOptions: RemoveServiceOptions): Promise<void> {
  const workspace = removeOptions.config.workspaces[removeOptions.workspaceIndex];
  const confirmed = await removeOptions.options.prompts.confirm({
    message: `Remove service "${removeOptions.service.name}"?`,
    default: false,
  });

  if (!confirmed) {
    removeOptions.output.log("Remove cancelled.");
    return;
  }

  await removeOptions.options.store.save({
    ...removeOptions.config,
    workspaces: removeOptions.config.workspaces.map((candidate, index) =>
      index === removeOptions.workspaceIndex
        ? {
            ...candidate,
            services: candidate.services.filter(
              (service) => service.id !== removeOptions.service.id,
            ),
          }
        : candidate,
    ),
  });

  removeOptions.output.log(
    `Removed service "${removeOptions.service.name}" from workspace "${workspace.name}".`,
  );
}

function formatUpdateMessage(
  action: Exclude<EditServiceAction, "remove">,
  service: ServiceConfig,
): string {
  switch (action) {
    case "command":
      return `Updated command for "${service.name}".`;
    case "cwd":
      return `Updated working directory for "${service.name}".`;
    case "autoStart":
      return `Auto-start ${service.autoStart ? "enabled" : "disabled"} for "${service.name}".`;
  }
}

function resolveServiceWorkingDirectory(
  rawWorkingDirectory: string,
  baseDirectory: string,
): string {
  return path.isAbsolute(rawWorkingDirectory)
    ? rawWorkingDirectory
    : path.resolve(baseDirectory, rawWorkingDirectory);
}

function requiredValue(message: string): (value: string) => boolean | string {
  return (value) => (value.trim().length > 0 ? true : message);
}

function defaultDirectoryExists(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

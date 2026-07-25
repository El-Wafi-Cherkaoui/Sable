import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, ServiceConfig } from "../config/config-types.js";
import { generateShortId } from "../shared/id.js";

export type AddServiceConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type AddServicePrompts = {
  confirm(options: { message: string; default?: boolean }): Promise<boolean>;
  input(options: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;
};

export type AddServiceOutput = {
  log(message: string): void;
};

export type DirectoryExists = (directoryPath: string) => boolean;

export type AddServiceToWorkspaceOptions = {
  store: AddServiceConfigStore;
  prompts: AddServicePrompts;
  output?: AddServiceOutput;
  generateId?: typeof generateShortId;
  directoryExists?: DirectoryExists;
};

export class WorkspaceIdNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace with id "${workspaceId}" was not found.`);
    this.name = "WorkspaceIdNotFoundError";
  }
}

export async function runAddServiceToWorkspaceCommand(
  workspaceId: string,
  options: AddServiceToWorkspaceOptions,
): Promise<void> {
  const output = options.output ?? console;
  const idGenerator = options.generateId ?? generateShortId;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex(
    (workspace) => workspace.id === workspaceId,
  );

  if (workspaceIndex === -1) {
    throw new WorkspaceIdNotFoundError(workspaceId);
  }

  const workspace = config.workspaces[workspaceIndex];
  const baseDirectory = workspace.services[0]?.cwd ?? process.cwd();
  const service = await promptForService({
    prompts: options.prompts,
    generateId: idGenerator,
    baseDirectory,
    existingServiceNames: workspace.services.map((candidate) => candidate.name),
    directoryExists,
  });

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate, index) =>
      index === workspaceIndex
        ? { ...candidate, services: [...candidate.services, service] }
        : candidate,
    ),
  });

  output.log(`Added service "${service.name}" to workspace "${workspace.name}".`);
}

type PromptForServiceOptions = {
  prompts: AddServicePrompts;
  generateId: typeof generateShortId;
  baseDirectory: string;
  existingServiceNames: string[];
  directoryExists: DirectoryExists;
};

async function promptForService(
  options: PromptForServiceOptions,
): Promise<ServiceConfig> {
  const name = await options.prompts.input({
    message: "Service name",
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Service name is required.";
      }

      if (hasServiceNamed(options.existingServiceNames, trimmedValue)) {
        return `Service "${trimmedValue}" already exists in this workspace.`;
      }

      return true;
    },
  });
  const command = await options.prompts.input({
    message: "Command",
    validate: requiredValue("Service command is required."),
  });
  const cwd = await options.prompts.input({
    message: "Working directory",
    default: options.baseDirectory,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Service working directory is required.";
      }

      const resolvedPath = resolveServiceWorkingDirectory(
        trimmedValue,
        options.baseDirectory,
      );

      if (!options.directoryExists(resolvedPath)) {
        return "Service working directory must exist and be a directory.";
      }

      return true;
    },
  });
  const autoStart = await options.prompts.confirm({
    message: "Auto-start this service?",
    default: true,
  });

  return {
    id: options.generateId("svc"),
    name: name.trim(),
    command: command.trim(),
    cwd: resolveServiceWorkingDirectory(cwd.trim(), options.baseDirectory),
    autoStart,
    env: {},
  };
}

function hasServiceNamed(existingServiceNames: string[], rawName: string): boolean {
  const targetName = normalizeName(rawName);

  return existingServiceNames.some((name) => normalizeName(name) === targetName);
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

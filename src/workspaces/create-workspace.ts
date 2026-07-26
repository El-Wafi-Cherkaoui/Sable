import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { generateShortId } from "../shared/id.js";
import type { AppConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";

export type WorkspaceConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type CreateWorkspacePrompts = {
  confirm(options: { message: string; default?: boolean }): Promise<boolean>;
  input(options: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;
};

export type CreateWorkspaceOutput = {
  log(message: string): void;
  error(message: string): void;
};

export type ProjectDirectoryExists = (directoryPath: string) => boolean;

export type CreateWorkspaceCommandOptions = {
  store: WorkspaceConfigStore;
  prompts: CreateWorkspacePrompts;
  output?: CreateWorkspaceOutput;
  generateId?: typeof generateShortId;
  projectDirectoryExists?: ProjectDirectoryExists;
};

export class DuplicateWorkspaceNameError extends Error {
  constructor(name: string) {
    super(`Workspace "${name}" already exists.`);
    this.name = "DuplicateWorkspaceNameError";
  }
}

export async function runCreateWorkspaceCommand(
  rawWorkspaceName: string,
  options: CreateWorkspaceCommandOptions,
): Promise<void> {
  const output = options.output ?? console;
  const idGenerator = options.generateId ?? generateShortId;
  const workspaceName = rawWorkspaceName.trim();
  const config = await options.store.load();

  if (hasWorkspaceNamed(config, workspaceName)) {
    throw new DuplicateWorkspaceNameError(workspaceName);
  }

  const projectDirectory = await promptForProjectDirectory(
    options.prompts,
    options.projectDirectoryExists ?? defaultProjectDirectoryExists,
  );
  const services = await promptForInitialServices(
    options.prompts,
    idGenerator,
    projectDirectory,
  );
  const nextConfig: AppConfig = {
    ...config,
    workspaces: [
      ...config.workspaces,
      {
        id: idGenerator("ws"),
        name: workspaceName,
        projectDirectory,
        services,
      },
    ],
  };

  await options.store.save(nextConfig);
  output.log(`Created workspace "${workspaceName}".`);
}

export function hasWorkspaceNamed(config: AppConfig, rawName: string): boolean {
  const targetName = normalizeName(rawName);

  return config.workspaces.some(
    (workspace) => normalizeName(workspace.name) === targetName,
  );
}

async function promptForInitialServices(
  prompts: CreateWorkspacePrompts,
  generateId: typeof generateShortId,
  projectDirectory: string,
): Promise<ServiceConfig[]> {
  const shouldAddServices = await prompts.confirm({
    message: "Add initial services?",
    default: false,
  });

  if (!shouldAddServices) {
    return [];
  }

  const services: ServiceConfig[] = [];
  let addAnotherService = true;

  while (addAnotherService) {
    services.push(await promptForService(prompts, generateId, projectDirectory));
    addAnotherService = await prompts.confirm({
      message: "Add another service?",
      default: false,
    });
  }

  return services;
}

async function promptForService(
  prompts: CreateWorkspacePrompts,
  generateId: typeof generateShortId,
  projectDirectory: string,
): Promise<ServiceConfig> {
  const name = await prompts.input({
    message: "Service name",
    validate: requiredValue("Service name is required."),
  });
  const command = await prompts.input({
    message: "Command",
    validate: requiredValue("Service command is required."),
  });
  const cwd = await prompts.input({
    message: "Working directory",
    default: projectDirectory,
    validate: requiredValue("Service working directory is required."),
  });
  const autoStart = await prompts.confirm({
    message: "Auto-start this service?",
    default: true,
  });

  return {
    id: generateId("svc"),
    name: name.trim(),
    command: command.trim(),
    cwd: resolveServiceWorkingDirectory(cwd.trim(), projectDirectory),
    autoStart,
    env: {},
  };
}

async function promptForProjectDirectory(
  prompts: CreateWorkspacePrompts,
  projectDirectoryExists: ProjectDirectoryExists,
): Promise<string> {
  const projectDirectory = await prompts.input({
    message: "Project directory",
    default: process.cwd(),
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Project directory is required.";
      }

      if (!projectDirectoryExists(trimmedValue)) {
        return "Project directory must exist and be a directory.";
      }

      return true;
    },
  });

  return path.resolve(projectDirectory.trim());
}

function resolveServiceWorkingDirectory(
  rawWorkingDirectory: string,
  projectDirectory: string,
): string {
  return path.isAbsolute(rawWorkingDirectory)
    ? rawWorkingDirectory
    : path.resolve(projectDirectory, rawWorkingDirectory);
}

function requiredValue(message: string): (value: string) => boolean | string {
  return (value) => (value.trim().length > 0 ? true : message);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultProjectDirectoryExists(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

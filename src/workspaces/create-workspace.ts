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

export type CreateWorkspaceCommandOptions = {
  store: WorkspaceConfigStore;
  prompts: CreateWorkspacePrompts;
  output?: CreateWorkspaceOutput;
  generateId?: typeof generateShortId;
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

  const services = await promptForInitialServices(options.prompts, idGenerator);
  const nextConfig: AppConfig = {
    ...config,
    workspaces: [
      ...config.workspaces,
      {
        id: idGenerator("ws"),
        name: workspaceName,
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
    services.push(await promptForService(prompts, generateId));
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
    default: process.cwd(),
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
    cwd: cwd.trim(),
    autoStart,
    env: {},
  };
}

function requiredValue(message: string): (value: string) => boolean | string {
  return (value) => (value.trim().length > 0 ? true : message);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { validateAppConfig } from "./config-schema.js";
import { resolveConfigPaths, type ConfigPaths } from "./config-path.js";
import type { AppConfig } from "./config-types.js";

export const defaultConfig: AppConfig = {
  version: 1,
  workspaces: [],
};

export class ConfigParseError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(`Could not parse config JSON at ${filePath}.`, { cause });
    this.name = "ConfigParseError";
  }
}

export class ConfigValidationError extends Error {
  constructor(filePath: string, cause: ZodError) {
    super(`Invalid config at ${filePath}.`, { cause });
    this.name = "ConfigValidationError";
  }
}

export type ConfigStoreOptions = {
  directory?: string;
};

export class ConfigStore {
  readonly paths: ConfigPaths;

  constructor(options: ConfigStoreOptions = {}) {
    this.paths = resolveConfigPaths(options);
  }

  async load(): Promise<AppConfig> {
    let rawConfig: string;

    try {
      rawConfig = await fs.readFile(this.paths.file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { ...defaultConfig, workspaces: [] };
      }

      throw error;
    }

    let parsedConfig: unknown;

    try {
      parsedConfig = JSON.parse(rawConfig);
    } catch (error) {
      throw new ConfigParseError(this.paths.file, error);
    }

    try {
      return validateAppConfig(migrateConfig(parsedConfig));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ConfigValidationError(this.paths.file, error);
      }

      throw error;
    }
  }

  async save(config: AppConfig): Promise<void> {
    const validatedConfig = validateAppConfig(config);

    await fs.mkdir(this.paths.directory, { recursive: true });

    const tempFile = path.join(
      this.paths.directory,
      `${path.basename(this.paths.file)}.${process.pid}.${Date.now()}.tmp`,
    );
    const contents = `${JSON.stringify(validatedConfig, null, 2)}\n`;

    const fileHandle = await fs.open(tempFile, "w");

    try {
      await fileHandle.writeFile(contents, "utf8");
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    await fs.rename(tempFile, this.paths.file);
  }
}

function migrateConfig(input: unknown): unknown {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.workspaces)) {
    return input;
  }

  return {
    ...input,
    workspaces: input.workspaces.map((workspace) => {
      if (!isRecord(workspace) || typeof workspace.projectDirectory === "string") {
        return workspace;
      }

      return {
        ...workspace,
        projectDirectory: inferProjectDirectory(workspace),
      };
    }),
  };
}

function inferProjectDirectory(workspace: Record<string, unknown>): string {
  if (Array.isArray(workspace.services)) {
    const firstService = workspace.services.find(
      (service): service is Record<string, unknown> =>
        isRecord(service) && typeof service.cwd === "string" && service.cwd.trim().length > 0,
    );

    if (firstService !== undefined) {
      return path.resolve(String(firstService.cwd));
    }
  }

  return process.cwd();
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

type NodeError = Error & {
  code?: string;
};

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}

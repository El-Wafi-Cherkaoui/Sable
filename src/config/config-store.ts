import { promises as fs } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { validateAppConfig } from "./config-schema.js";
import { resolveConfigPaths, type ConfigPaths } from "./config-path.js";
import type { AppConfig, WorkspaceConfig } from "./config-types.js";

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

export function formatConfigError(error: ConfigParseError | ConfigValidationError): string {
  const lines = [error.message];

  if (error instanceof ConfigValidationError && error.cause instanceof ZodError) {
    for (const issue of error.cause.issues) {
      const issuePath = issue.path.map(String).join(".");
      lines.push(issuePath === "" ? `  - ${issue.message}` : `  - ${issuePath}: ${issue.message}`);
    }
  } else if (error instanceof ConfigParseError && error.cause !== undefined) {
    lines.push(`  ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`);
  }

  lines.push("Fix or remove the file and run sable again.");

  return lines.join("\n");
}

export type ConfigStoreOptions = {
  directory?: string;
};

export class ConfigStore {
  readonly paths: ConfigPaths;
  // What this store last read or wrote, so a save can tell what changed in the file
  // since then (another Sable instance) and keep that instead of overwriting it.
  private lastSeen: AppConfig | undefined;

  constructor(options: ConfigStoreOptions = {}) {
    this.paths = resolveConfigPaths(options);
  }

  async load(): Promise<AppConfig> {
    const config = await this.readFile();

    this.lastSeen = config;

    return config;
  }

  private async readFile(): Promise<AppConfig> {
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
    const validatedConfig = await this.mergeWithFile(validateAppConfig(config));

    await fs.mkdir(this.paths.directory, { recursive: true });

    const tempFile = path.join(
      this.paths.directory,
      `${path.basename(this.paths.file)}.${process.pid}.${Date.now()}.tmp`,
    );
    const contents = `${JSON.stringify(validatedConfig, null, 2)}\n`;

    try {
      const fileHandle = await fs.open(tempFile, "w");

      try {
        await fileHandle.writeFile(contents, "utf8");
        await fileHandle.sync();
      } finally {
        await fileHandle.close();
      }

      await fs.rename(tempFile, this.paths.file);
      this.lastSeen = validatedConfig;
    } catch (error) {
      await removeFileIfExists(tempFile);
      throw error;
    }
  }

  // Two Sable windows can be open on the same file. A save applies only this
  // instance's own changes (per workspace) on top of what is in the file now, so the other
  // instance's workspaces survive. If both changed the same workspace, this one wins.
  private async mergeWithFile(mine: AppConfig): Promise<AppConfig> {
    const base = this.lastSeen;

    if (base === undefined) {
      return mine;
    }

    const current = await this.readFile();

    if (sameValue(current, base)) {
      return mine;
    }

    const baseById = new Map(base.workspaces.map((workspace) => [workspace.id, workspace]));
    const mineById = new Map(mine.workspaces.map((workspace) => [workspace.id, workspace]));
    const merged: WorkspaceConfig[] = [];

    for (const workspace of current.workspaces) {
      const mineVersion = mineById.get(workspace.id);
      const baseVersion = baseById.get(workspace.id);

      if (mineVersion === undefined) {
        // Gone from mine: deleted here, unless it was never in my copy (added elsewhere).
        if (baseVersion === undefined) {
          merged.push(workspace);
        }
      } else {
        merged.push(baseVersion !== undefined && sameValue(mineVersion, baseVersion) ? workspace : mineVersion);
      }
    }

    for (const workspace of mine.workspaces) {
      if (!current.workspaces.some((existing) => existing.id === workspace.id) && !baseById.has(workspace.id)) {
        merged.push(workspace);
      }
    }

    return { ...mine, workspaces: merged };
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isRecord(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested,
  );
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

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      // Cleanup is best-effort; preserve the original save error.
    }
  }
}

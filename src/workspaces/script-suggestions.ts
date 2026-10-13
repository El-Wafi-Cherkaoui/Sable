import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type ScriptSuggestion = {
  name: string;
  script: string;
  command: string;
  kind: "service" | "command";
  selected: boolean;
  // The project file it came from, set when suggestions from several files are merged.
  source?: string;
};

export type ProjectFiles = {
  exists(filePath: string): boolean;
  read(filePath: string): string;
};

export const nodeFiles: ProjectFiles = {
  exists: existsSync,
  read: (filePath) => readFileSync(filePath, "utf8"),
};

// Scripts that run once and finish, so they become commands rather than services.
const oneShotPattern = /(^|[:-])(build|test|lint|format|fmt|typecheck|check|clean|release|deploy|migrate|seed|generate|codegen)($|[:-])/;
// Scripts most projects mean as "the thing you run while developing".
const preselectedPattern = /^(dev|start|serve|watch)($|:)/;
// Events npm runs on its own; "pre"/"post" scripts for these, or for another script, are hooks.
const npmLifecycleEvents = new Set(["install", "uninstall", "publish", "pack", "version", "test", "start", "stop", "restart", "shrinkwrap", "prepare"]);

export function detectPackageManager(projectDirectory: string, files: ProjectFiles = nodeFiles): PackageManager {
  if (files.exists(path.join(projectDirectory, "pnpm-lock.yaml"))) return "pnpm";
  if (files.exists(path.join(projectDirectory, "yarn.lock"))) return "yarn";
  if (files.exists(path.join(projectDirectory, "bun.lockb")) || files.exists(path.join(projectDirectory, "bun.lock"))) return "bun";
  return "npm";
}

export function suggestScripts(projectDirectory: string, files: ProjectFiles = nodeFiles): { manager: PackageManager; suggestions: ScriptSuggestion[] } | undefined {
  const packageJsonPath = path.join(projectDirectory, "package.json");

  if (!files.exists(packageJsonPath)) {
    return undefined;
  }

  let scripts: unknown;

  try {
    scripts = (JSON.parse(files.read(packageJsonPath)) as { scripts?: unknown }).scripts;
  } catch {
    return undefined;
  }

  if (typeof scripts !== "object" || scripts === null) {
    return undefined;
  }

  const manager = detectPackageManager(projectDirectory, files);
  const scriptNames = new Set(Object.keys(scripts));
  const suggestions = Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !isLifecycleHook(entry[0], scriptNames))
    .map(([name, script]) => {
      const kind = oneShotPattern.test(name) ? "command" as const : "service" as const;

      return {
        name,
        script,
        command: runScriptCommand(manager, name),
        kind,
        selected: kind === "service" && preselectedPattern.test(name),
      };
    });

  return suggestions.length === 0 ? undefined : { manager, suggestions };
}

function isLifecycleHook(name: string, scriptNames: Set<string>): boolean {
  if (name === "prepare" || name === "prepublishOnly") {
    return true;
  }

  const match = /^(pre|post)(.+)$/.exec(name);

  return match !== null && (scriptNames.has(match[2]!) || npmLifecycleEvents.has(match[2]!));
}

export function runScriptCommand(manager: PackageManager, scriptName: string): string {
  return manager === "yarn" ? `yarn ${scriptName}` : `${manager} run ${scriptName}`;
}

import path from "node:path";
import { suggestScripts, type ProjectFiles, type ScriptSuggestion } from "./script-suggestions.js";

export type SuggestionSource = { name: string; suggestions: ScriptSuggestion[] };

// Services and commands Sable can offer for a project folder, from every kind of project file it finds.
export type ProjectSuggestions = { sources: string[]; suggestions: ScriptSuggestion[] };

type Detector = (context: DetectorContext) => SuggestionSource | undefined;

type DetectorContext = {
  directory: string;
  files: ProjectFiles;
  platform: NodeJS.Platform;
};

// How many targets or recipes one file may contribute, so a big Makefile doesn't bury the rest.
const maxPerFile = 12;
// Names that mean "a thing you leave running while you work".
const longRunningName = /^(dev|develop|run|serve|server|start|watch|up|live|preview)([-_:].*)?$/;
const preselectedName = /^(dev|run|serve|server|start|watch|up)$/;
// Names that mean "do it once and finish", even when they start like a long-running one (dev-build).
const oneShotName = /(^|[:_-])(build|test|lint|format|fmt|typecheck|check|clean|release|deploy|migrate|seed|generate|codegen|install|setup|docs?)($|[:_-])/;

// The package.json scripts keep their own names (dev, build); every other source is prefixed with its
// tool (make build, cargo run) so names from different files can't collide.
export function suggestProject(
  directory: string,
  files: ProjectFiles,
  platform: NodeJS.Platform = process.platform,
): ProjectSuggestions | undefined {
  const context: DetectorContext = { directory, files, platform };
  const found: SuggestionSource[] = [];
  const scripts = suggestScripts(directory, files);

  if (scripts !== undefined) {
    found.push({ name: `package.json (${scripts.manager})`, suggestions: scripts.suggestions });
  }

  for (const detect of detectors) {
    const source = detect(context);

    if (source !== undefined && source.suggestions.length > 0) {
      found.push({ ...source, suggestions: preselectOne(source.suggestions) });
    }
  }

  if (found.length === 0) {
    return undefined;
  }

  return {
    sources: found.map((source) => source.name),
    suggestions: found.flatMap((source) => source.suggestions.map((suggestion) => ({ ...suggestion, source: source.name }))),
  };
}

const detectors: Detector[] = [detectMakefile, detectJustfile, detectCompose, detectCargo, detectGo, detectDjango, detectPytest, detectRails, detectLaravel];

// Several files in one project often start the same thing (a Makefile's run and dev, a compose file and a
// Dockerfile), so only the first service of each file is ticked; the rest are one Space away.
function preselectOne(suggestions: ScriptSuggestion[]): ScriptSuggestion[] {
  let taken = false;

  return suggestions.map((suggestion) => {
    const selected = suggestion.selected && !taken;

    taken ||= selected;

    return selected === suggestion.selected ? suggestion : { ...suggestion, selected };
  });
}

function detectMakefile({ directory, files }: DetectorContext): SuggestionSource | undefined {
  const file = firstExisting(directory, files, ["Makefile", "makefile", "GNUmakefile"]);
  const text = file === undefined ? undefined : readText(files, file);

  if (file === undefined || text === undefined) {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  const targets: Array<{ name: string; recipe: string | undefined }> = [];

  for (const [index, line] of lines.entries()) {
    // "name:" starts a target; "NAME := value" and "name::" do not.
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?![=:])/.exec(line);

    if (match !== null && !targets.some((target) => target.name === match[1])) {
      targets.push({ name: match[1]!, recipe: firstRecipeLine(lines, index + 1, /^\t/) });
    }
  }

  return {
    name: "Makefile",
    suggestions: targets.slice(0, maxPerFile).map((target) => fromRecipeName("make", target.name, `make ${target.name}`, target.recipe)),
  };
}

function detectJustfile({ directory, files }: DetectorContext): SuggestionSource | undefined {
  const file = firstExisting(directory, files, ["justfile", "Justfile", ".justfile"]);
  const text = file === undefined ? undefined : readText(files, file);

  if (file === undefined || text === undefined) {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  const recipes: Array<{ name: string; recipe: string | undefined }> = [];

  for (const [index, line] of lines.entries()) {
    // Only recipes that take no arguments can be run as they are; "_name" recipes are private.
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(?!=)/.exec(line);

    if (match !== null && !recipes.some((recipe) => recipe.name === match[1])) {
      recipes.push({ name: match[1]!, recipe: firstRecipeLine(lines, index + 1, /^(\t| {2,})/) });
    }
  }

  return {
    name: "justfile",
    suggestions: recipes.slice(0, maxPerFile).map((recipe) => fromRecipeName("just", recipe.name, `just ${recipe.name}`, recipe.recipe)),
  };
}

function detectCompose({ directory, files }: DetectorContext): SuggestionSource | undefined {
  const file = firstExisting(directory, files, ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]);
  const text = file === undefined ? undefined : readText(files, file);

  if (file === undefined || text === undefined) {
    return undefined;
  }

  const names = composeServiceNames(text);

  return {
    name: "Docker Compose",
    suggestions: [
      { name: "compose up", script: "start every service in the compose file", command: "docker compose up", kind: "service", selected: true },
      ...names.slice(0, 8).map((name): ScriptSuggestion => ({ name: `compose ${name}`, script: `start only ${name}`, command: `docker compose up ${name}`, kind: "service", selected: false })),
    ],
  };
}

function detectCargo({ directory, files }: DetectorContext): SuggestionSource | undefined {
  const manifest = path.join(directory, "Cargo.toml");

  if (!files.exists(manifest)) {
    return undefined;
  }

  const hasBinary = files.exists(path.join(directory, "src", "main.rs")) || /\[\[bin\]\]/.test(readText(files, manifest) ?? "");

  return {
    name: "Cargo.toml",
    suggestions: [
      ...(hasBinary ? [{ name: "cargo run", script: "run the program", command: "cargo run", kind: "service" as const, selected: true }] : []),
      { name: "cargo test", script: "run the tests", command: "cargo test", kind: "command", selected: false },
      { name: "cargo build", script: "compile the project", command: "cargo build", kind: "command", selected: false },
    ],
  };
}

function detectGo({ directory, files }: DetectorContext): SuggestionSource | undefined {
  if (!files.exists(path.join(directory, "go.mod"))) {
    return undefined;
  }

  return {
    name: "go.mod",
    suggestions: [
      ...(files.exists(path.join(directory, "main.go")) ? [{ name: "go run", script: "run the program", command: "go run .", kind: "service" as const, selected: true }] : []),
      { name: "go test", script: "run the tests", command: "go test ./...", kind: "command", selected: false },
      { name: "go build", script: "compile the project", command: "go build ./...", kind: "command", selected: false },
    ],
  };
}

function detectDjango({ directory, files, platform }: DetectorContext): SuggestionSource | undefined {
  if (!files.exists(path.join(directory, "manage.py"))) {
    return undefined;
  }

  const python = platform === "win32" ? "python" : "python3";

  return {
    name: "Django",
    suggestions: [
      { name: "django runserver", script: "the development server", command: `${python} manage.py runserver`, kind: "service", selected: true },
      { name: "django migrate", script: "apply database migrations", command: `${python} manage.py migrate`, kind: "command", selected: false },
      { name: "django test", script: "run the tests", command: `${python} manage.py test`, kind: "command", selected: false },
    ],
  };
}

function detectPytest({ directory, files }: DetectorContext): SuggestionSource | undefined {
  const uses = ["pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml", "requirements.txt", "requirements-dev.txt"].some((name) => {
    const file = path.join(directory, name);

    return files.exists(file) && (name === "pytest.ini" || /pytest/i.test(readText(files, file) ?? ""));
  });

  return uses
    ? { name: "pytest", suggestions: [{ name: "pytest", script: "run the tests", command: "pytest", kind: "command", selected: false }] }
    : undefined;
}

function detectRails({ directory, files, platform }: DetectorContext): SuggestionSource | undefined {
  if (!files.exists(path.join(directory, "bin", "rails")) || !files.exists(path.join(directory, "config", "application.rb"))) {
    return undefined;
  }

  const rails = platform === "win32" ? "ruby bin/rails" : "bin/rails";

  return {
    name: "Rails",
    suggestions: [
      { name: "rails server", script: "the development server", command: `${rails} server`, kind: "service", selected: true },
      { name: "rails test", script: "run the tests", command: `${rails} test`, kind: "command", selected: false },
      { name: "rails db:migrate", script: "apply database migrations", command: `${rails} db:migrate`, kind: "command", selected: false },
    ],
  };
}

function detectLaravel({ directory, files }: DetectorContext): SuggestionSource | undefined {
  if (!files.exists(path.join(directory, "artisan")) || !files.exists(path.join(directory, "composer.json"))) {
    return undefined;
  }

  return {
    name: "Laravel",
    suggestions: [
      { name: "artisan serve", script: "the development server", command: "php artisan serve", kind: "service", selected: true },
      { name: "artisan test", script: "run the tests", command: "php artisan test", kind: "command", selected: false },
      { name: "artisan migrate", script: "apply database migrations", command: "php artisan migrate", kind: "command", selected: false },
    ],
  };
}

function fromRecipeName(tool: string, name: string, command: string, recipe: string | undefined): ScriptSuggestion {
  const kind = !oneShotName.test(name) && longRunningName.test(name) ? "service" as const : "command" as const;

  return {
    name: `${tool} ${name}`,
    script: recipe ?? command,
    command,
    kind,
    selected: kind === "service" && preselectedName.test(name),
  };
}

// The first command line of a recipe, without the "@" (quiet) or "-" (ignore errors) prefixes.
function firstRecipeLine(lines: string[], from: number, indented: RegExp): string | undefined {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    }

    return indented.test(line) ? line.trim().replace(/^[@+-]+\s*/, "") : undefined;
  }

  return undefined;
}

// The names under a top-level "services:" key, read without a YAML parser.
function composeServiceNames(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^services\s*:\s*(#.*)?$/.test(line));

  if (start < 0) {
    return [];
  }

  const names: string[] = [];
  let indent: number | undefined;

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    }

    const leading = line.length - line.trimStart().length;

    if (leading === 0) {
      break;
    }

    indent ??= leading;

    const match = leading === indent ? /^\s+["']?([A-Za-z0-9][A-Za-z0-9_.-]*)["']?\s*:\s*(#.*)?$/.exec(line) : null;

    if (match !== null) {
      names.push(match[1]!);
    }
  }

  return names;
}

function firstExisting(directory: string, files: ProjectFiles, names: string[]): string | undefined {
  return names.map((name) => path.join(directory, name)).find((file) => files.exists(file));
}

function readText(files: ProjectFiles, file: string): string | undefined {
  try {
    return files.read(file);
  } catch {
    return undefined;
  }
}

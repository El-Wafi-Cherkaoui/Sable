import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { buildProjectFile } from "../project/project-export.js";
import { parseProjectFile, projectFileName, projectFilePath, readProjectFile } from "../project/project-file.js";
import { changesReviewLines, importReviewLines } from "../project/review-lines.js";
import {
  declaredPlaceholders,
  describeProjectChanges,
  linkWorkspaceToFile,
  missingPlaceholders,
  resolveProjectItems,
  syncProject,
  type ProjectSyncSummary,
} from "../project/project-sync.js";
import { generateShortId } from "../shared/id.js";
import { runForm, type FormField, type FormValues } from "../tui/form-view.js";
import { displayPath } from "../tui/format.js";
import type { PromptScreen } from "../tui/prompt-view.js";
import { runReview, type ReviewLine } from "../tui/review-view.js";

export type ProjectFlowStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type ProjectFlowOptions = {
  store: ProjectFlowStore;
  keyInput: KeyInput;
  screen?: PromptScreen;
  review?: typeof runReview;
  form?: typeof runForm;
  generateId?: typeof generateShortId;
  readFile?: typeof readProjectFile;
};

export type ProjectFlowResult =
  | { type: "completed"; message: string; workspaceId: string }
  | { type: "unchanged" }
  | { type: "back"; message: string }
  | { type: "exit" };

const workspaceNamePattern = /^[A-Za-z0-9_-]+$/;

// Reads the sable.json in a folder and, after the user has read and agreed to what it would run,
// sets up a workspace from it. When the folder already has a workspace linked to the file, updates that.
export async function runImportProjectFlow(
  options: ProjectFlowOptions & { directory: string },
): Promise<ProjectFlowResult> {
  const read = await (options.readFile ?? readProjectFile)(options.directory);

  if (read.type === "missing") {
    return { type: "back", message: `There is no ${projectFileName} in ${displayPath(options.directory)}.` };
  }

  if (read.type === "invalid") {
    return { type: "back", message: shortProblem(read.message) };
  }

  const config = await options.store.load();
  const linked = config.workspaces.find((workspace) => workspace.project !== undefined && samePath(workspace.projectDirectory, options.directory));

  if (linked !== undefined) {
    return runUpdateProjectFlow({ ...options, workspace: linked });
  }

  const placeholders = declaredPlaceholders(read.file);
  const preview = resolveProjectItems(read.file, {}, options.directory, { keepUnanswered: true });
  const verdict = await (options.review ?? runReview)({
    title: `Set up a workspace from ${projectFileName}?`,
    intro: [
      `${displayPath(options.directory)} has a ${projectFileName}. Importing makes a workspace that runs the commands below on this machine.`,
      "Read them first: they run as you.",
    ],
    lines: importReviewLines(preview, placeholders, options.directory),
    confirmLabel: "trust and import",
    cancelLabel: "not now",
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (verdict === "exit") return { type: "exit" };
  if (verdict === "cancel") return { type: "back", message: "Nothing imported." };

  const suggestedName = uniqueName(config, read.file.name ?? safeName(path.basename(options.directory)));
  let name = suggestedName;
  let values: Record<string, string> = Object.fromEntries(placeholders.filter((placeholder) => placeholder.default !== undefined).map((placeholder) => [placeholder.name, placeholder.default!]));

  if (placeholders.length > 0) {
    const answered = await askForSettings(options, {
      title: `Set up ${projectFileName}`,
      subtitle: displayPath(options.directory),
      name: { suggested: suggestedName, taken: (candidate) => hasWorkspaceNamed(config, candidate) },
      placeholders,
    });

    if (answered.type === "back") return { type: "back", message: "Nothing imported." };
    if (answered.type === "exit") return { type: "exit" };

    name = answered.name ?? suggestedName;
    values = answered.values;
  }

  const workspace: WorkspaceConfig = {
    id: (options.generateId ?? generateShortId)("ws"),
    name,
    projectDirectory: options.directory,
    items: [],
  };
  const synced = syncProject({ workspace, file: read.file, hash: read.hash, values, generateId: options.generateId ?? generateShortId });

  await options.store.save({ ...config, workspaces: [...config.workspaces, synced.workspace] });

  return {
    type: "completed",
    message: `Imported "${name}" from ${projectFileName}: ${countItems(synced.workspace)}.`,
    workspaceId: workspace.id,
  };
}

// Compares the file with what the user last agreed to and, if it changed, shows the difference.
export async function runUpdateProjectFlow(
  options: ProjectFlowOptions & { workspace: WorkspaceConfig },
): Promise<ProjectFlowResult> {
  const known = options.workspace.project;

  if (known === undefined) {
    return { type: "unchanged" };
  }

  const read = await (options.readFile ?? readProjectFile)(options.workspace.projectDirectory);

  if (read.type === "missing") {
    return { type: "unchanged" };
  }

  if (read.type === "invalid") {
    return { type: "back", message: shortProblem(read.message) };
  }

  const missing = missingPlaceholders(read.file, known.values);

  if (read.hash === known.hash && missing.length === 0) {
    return { type: "unchanged" };
  }

  const config = await options.store.load();
  const current = config.workspaces.find((workspace) => workspace.id === options.workspace.id);

  if (current?.project === undefined) {
    return { type: "unchanged" };
  }

  const preview = resolveProjectItems(read.file, current.project.values, current.projectDirectory, { keepUnanswered: true });
  const changes = describeProjectChanges(current.project.base, preview);
  const nothingToShow = changes.added.length === 0 && changes.changed.length === 0 && changes.removed.length === 0;

  let values = current.project.values;

  if (!nothingToShow) {
    const verdict = await (options.review ?? runReview)({
      title: `${projectFileName} changed`,
      intro: [
        `The ${projectFileName} for "${current.name}" is different from the one you agreed to.`,
        "Updating keeps anything you changed on this machine. Read what changes first: it runs as you.",
      ],
      lines: changesReviewLines(changes, current.projectDirectory),
      confirmLabel: "update",
      cancelLabel: "not now",
      keyInput: options.keyInput,
      screen: options.screen,
    });

    if (verdict === "exit") return { type: "exit" };
    if (verdict === "cancel") return { type: "back", message: `Kept "${current.name}" as it was. Open it again to update.` };
  }

  if (missing.length > 0) {
    const answered = await askForSettings(options, {
      title: `New settings in ${projectFileName}`,
      subtitle: current.name,
      placeholders: declaredPlaceholders(read.file).filter((placeholder) => missing.includes(placeholder.name)),
    });

    if (answered.type === "back") return { type: "back", message: `Kept "${current.name}" as it was. Open it again to update.` };
    if (answered.type === "exit") return { type: "exit" };

    values = { ...values, ...answered.values };
  }

  const synced = syncProject({ workspace: current, file: read.file, hash: read.hash, values, generateId: options.generateId ?? generateShortId });

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((workspace) => workspace.id === current.id ? synced.workspace : workspace),
  });

  return {
    type: "completed",
    message: nothingToShow ? `Checked ${projectFileName} for "${current.name}": nothing to change.` : `Updated "${current.name}" from ${projectFileName}: ${describeSummary(synced.summary)}.`,
    workspaceId: current.id,
  };
}

// Writes the workspace out as a sable.json in its project folder, after showing exactly what goes into it,
// and links the workspace to the file so a teammate's later changes reach it.
export async function runExportProjectFlow(
  options: ProjectFlowOptions & { workspace: WorkspaceConfig; writeFile?: (target: string, text: string) => Promise<void> },
): Promise<ProjectFlowResult> {
  const { workspace } = options;

  if (!(await folderExists(workspace.projectDirectory))) {
    return { type: "back", message: `The folder ${displayPath(workspace.projectDirectory)} does not exist.` };
  }

  if (workspace.items.length === 0) {
    return { type: "back", message: `"${workspace.name}" has nothing to share yet. Add a service or command first.` };
  }

  let built: ReturnType<typeof buildProjectFile>;

  try {
    built = buildProjectFile(workspace);
  } catch (error) {
    return { type: "back", message: error instanceof Error ? error.message : String(error) };
  }

  const target = projectFilePath(workspace.projectDirectory);
  const replacing = await fileExists(target);
  const lines: ReviewLine[] = [
    ...(built.notes.length === 0 ? [] : [
      { text: "Check before you commit it:", tone: "heading" as const },
      ...built.notes.map((note): ReviewLine => ({ text: `  ! ${note}`, tone: "removed" })),
      { text: "" },
    ]),
    { text: `${projectFileName}:`, tone: "heading" },
    ...built.text.trimEnd().split("\n").map((text): ReviewLine => ({ text: `  ${text}`, tone: "muted" })),
  ];
  const verdict = await (options.review ?? runReview)({
    title: `Write ${projectFileName}?`,
    intro: [
      `This writes ${displayPath(target)} so your team can set up the same workspace. Commit it to share it.`,
      replacing ? `A ${projectFileName} is already there. It will be replaced.` : "Look through it for anything private first.",
    ],
    lines,
    confirmLabel: "write file",
    cancelLabel: "cancel",
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (verdict === "exit") return { type: "exit" };
  if (verdict === "cancel") return { type: "back", message: `Did not write ${projectFileName}.` };

  await (options.writeFile ?? writeFileAtomically)(target, built.text);

  const written = parseProjectFile(built.text);

  if (written.type !== "ok") {
    return { type: "back", message: `Wrote ${projectFileName}, but could not link "${workspace.name}" to it.` };
  }

  const config = await options.store.load();

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) => candidate.id === workspace.id
      ? linkWorkspaceToFile({ workspace: candidate, file: written.file, hash: written.hash, values: {}, names: built.names })
      : candidate),
  });

  return {
    type: "completed",
    message: `Wrote ${projectFileName} (${countItems(workspace)}). Commit it so your team gets the same workspace.`,
    workspaceId: workspace.id,
  };
}

async function writeFileAtomically(target: string, text: string): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`;

  try {
    await fs.writeFile(temporary, text, "utf8");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function folderExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

type SettingsAnswers =
  | { type: "answered"; name?: string; values: Record<string, string> }
  | { type: "back" }
  | { type: "exit" };

async function askForSettings(
  options: ProjectFlowOptions,
  request: {
    title: string;
    subtitle: string;
    name?: { suggested: string; taken(candidate: string): boolean };
    placeholders: Array<{ name: string; description?: string; default?: string }>;
  },
): Promise<SettingsAnswers> {
  const key = (placeholder: string) => `value.${placeholder}`;
  const fields: FormField[] = [
    ...(request.name === undefined ? [] : [{ type: "text" as const, key: "name", label: "Workspace", hint: "Letters, numbers, dashes and underscores" }]),
    ...request.placeholders.map((placeholder): FormField => ({
      type: "text",
      key: key(placeholder.name),
      label: placeholder.name,
      hint: placeholder.description ?? (placeholder.default === undefined ? "Required" : `Default ${placeholder.default}`),
    })),
  ];
  const result = await (options.form ?? runForm)({
    title: request.title,
    subtitle: request.subtitle,
    fields: () => fields,
    values: {
      ...(request.name === undefined ? {} : { name: request.name.suggested }),
      ...Object.fromEntries(request.placeholders.map((placeholder) => [key(placeholder.name), placeholder.default ?? ""])),
    },
    validate: (values) => {
      const errors: Record<string, string> = {};
      const candidate = text(values.name);

      if (request.name !== undefined) {
        if (!workspaceNamePattern.test(candidate)) {
          errors.name = "Use letters, numbers, dashes and underscores.";
        } else if (request.name.taken(candidate)) {
          errors.name = `A workspace named "${candidate}" already exists.`;
        }
      }

      for (const placeholder of request.placeholders) {
        if (text(values[key(placeholder.name)]) === "" && placeholder.default === undefined) {
          errors[key(placeholder.name)] = "This one is required.";
        }
      }

      return errors;
    },
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type !== "submit") {
    return { type: result.type };
  }

  return {
    type: "answered",
    ...(request.name === undefined ? {} : { name: text(result.values.name) }),
    values: Object.fromEntries(request.placeholders.map((placeholder) => [placeholder.name, text(result.values[key(placeholder.name)]) || placeholder.default || ""])),
  };
}

export function describeSummary(summary: ProjectSyncSummary): string {
  const parts = [
    summary.added.length > 0 ? `${summary.added.length} added` : undefined,
    summary.updated.length > 0 ? `${summary.updated.length} changed` : undefined,
    summary.removed.length > 0 ? `${summary.removed.length} removed` : undefined,
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? "nothing to change" : parts.join(", ");
}

function countItems(workspace: WorkspaceConfig): string {
  const services = workspace.items.filter((item) => item.kind === "service").length;
  const commands = workspace.items.length - services;
  const parts = [
    services > 0 ? `${services} ${services === 1 ? "service" : "services"}` : undefined,
    commands > 0 ? `${commands} ${commands === 1 ? "command" : "commands"}` : undefined,
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? "no items" : parts.join(" and ");
}

// The first problem of a multi-line message, for a one-line status.
function shortProblem(message: string): string {
  const [headline, first] = message.split("\n");

  return first === undefined ? (headline ?? message) : `${headline} ${first.replace(/^\s*-\s*/, "")}`;
}

function hasWorkspaceNamed(config: AppConfig, name: string): boolean {
  return config.workspaces.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase());
}

function uniqueName(config: AppConfig, base: string): string {
  let candidate = base;

  for (let suffix = 2; hasWorkspaceNamed(config, candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));

  return normalize(left) === normalize(right);
}

function text(value: FormValues[string] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}


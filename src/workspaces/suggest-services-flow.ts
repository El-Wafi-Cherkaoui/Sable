import type { AppConfig, CommandConfig, ServiceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import { runChecklist } from "../tui/checklist-view.js";
import type { PromptScreen } from "../tui/prompt-view.js";
import { suggestScripts, type ProjectFiles } from "./script-suggestions.js";

export type SuggestServicesFlowResult =
  | { type: "added"; message: string }
  | { type: "skipped" }
  | { type: "exit" };

export type SuggestServicesFlowOptions = {
  store: {
    load(): Promise<AppConfig>;
    save(config: AppConfig): Promise<void>;
  };
  workspaceId: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  files?: ProjectFiles;
  checklist?: typeof runChecklist;
  generateId?: typeof generateShortId;
};

// Offered once, right after a workspace is created: turns package.json scripts
// into services and commands so a new user reaches a running service quickly.
export async function runSuggestServicesFlow(options: SuggestServicesFlowOptions): Promise<SuggestServicesFlowResult> {
  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspaceId);

  if (workspace === undefined || workspace.items.length > 0) {
    return { type: "skipped" };
  }

  const found = suggestScripts(workspace.projectDirectory, options.files);

  if (found === undefined) {
    return { type: "skipped" };
  }

  const result = await (options.checklist ?? runChecklist)({
    title: workspace.name,
    subtitle: `found package.json (${found.manager})`,
    question: "Add services from your scripts?",
    explanation: "Checked services start when the workspace opens. You can change everything later with e.",
    items: found.suggestions.map((suggestion) => ({
      label: suggestion.name,
      detail: suggestion.script,
      note: suggestion.kind === "command" ? "(one-shot)" : undefined,
      selected: suggestion.selected,
    })),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "exit") return { type: "exit" };

  const chosen = result.type === "submit" ? found.suggestions.filter((_, index) => result.selected[index]) : [];

  if (chosen.length === 0) {
    return { type: "skipped" };
  }

  const generateId = options.generateId ?? generateShortId;
  const services: ServiceConfig[] = chosen.filter((suggestion) => suggestion.kind === "service").map((suggestion) => ({
    kind: "service" as const,
    after: [],
    id: generateId("svc"),
    name: suggestion.name,
    command: suggestion.command,
    cwd: workspace.projectDirectory,
    autoStart: true,
    env: {},
  }));
  const commands: CommandConfig[] = chosen.filter((suggestion) => suggestion.kind === "command").map((suggestion) => ({
    kind: "command" as const,
    after: [],
    id: generateId("cmd"),
    name: suggestion.name,
    command: suggestion.command,
    cwd: workspace.projectDirectory,
    env: {},
  }));

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspace.id ? { ...candidate, items: [...services, ...commands] } : candidate,
    ),
  });

  const parts = [
    services.length > 0 ? `${services.length} ${services.length === 1 ? "service" : "services"}` : undefined,
    commands.length > 0 ? `${commands.length} ${commands.length === 1 ? "command" : "commands"}` : undefined,
  ].filter((part) => part !== undefined);

  return { type: "added", message: `Added ${parts.join(" and ")} from package.json.` };
}

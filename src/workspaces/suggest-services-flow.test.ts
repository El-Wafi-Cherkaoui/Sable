import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { ChecklistResult } from "../tui/checklist-view.js";
import { runSuggestServicesFlow } from "./suggest-services-flow.js";
import type { ProjectFiles } from "./script-suggestions.js";

const projectDirectory = path.resolve(path.sep, "code", "shop");
const files: ProjectFiles = {
  exists: (filePath) => filePath === path.join(projectDirectory, "package.json"),
  read: () => JSON.stringify({ scripts: { dev: "vite", build: "vite build", preview: "vite preview" } }),
};

describe("runSuggestServicesFlow", () => {
  it("adds the checked scripts as auto-start services and one-shot commands", async () => {
    const store = createStore(emptyWorkspaceConfig());
    let id = 0;
    const checklist = vi.fn(async (): Promise<ChecklistResult> => ({ type: "submit", selected: [true, true, false] }));

    const result = await runSuggestServicesFlow({
      store, workspaceId: "ws_shop", keyInput: noKeys(), files, checklist, generateId: (prefix) => `${prefix}_${++id}`,
    });

    expect(checklist.mock.calls[0]![0].items.map((item) => [item.label, item.selected, item.note])).toEqual([
      ["dev", true, undefined],
      ["build", false, "(one-shot)"],
      ["preview", false, undefined],
    ]);
    expect(result).toEqual({ type: "added", message: "Added 1 service and 1 command from package.json." });
    expect(store.savedConfig?.workspaces[0]).toMatchObject({
      items: [{ kind: "service", after: [], id: "svc_1", name: "dev", command: "npm run dev", cwd: projectDirectory, autoStart: true, env: {} }, { kind: "command", after: [], id: "cmd_2", name: "build", command: "npm run build", cwd: projectDirectory, env: {} }],
    });
  });

  it("skips without asking when there is no package.json or the workspace already has items", async () => {
    const checklist = vi.fn();
    const noFiles: ProjectFiles = { exists: () => false, read: () => "" };
    const withService = emptyWorkspaceConfig();

    withService.workspaces[0]!.items.push({ kind: "service", after: [], id: "svc", name: "api", command: "x", cwd: projectDirectory, autoStart: true, env: {} });

    await expect(runSuggestServicesFlow({ store: createStore(emptyWorkspaceConfig()), workspaceId: "ws_shop", keyInput: noKeys(), files: noFiles, checklist }))
      .resolves.toEqual({ type: "skipped" });
    await expect(runSuggestServicesFlow({ store: createStore(withService), workspaceId: "ws_shop", keyInput: noKeys(), files, checklist }))
      .resolves.toEqual({ type: "skipped" });
    expect(checklist).not.toHaveBeenCalled();
  });

  it("saves nothing when skipped or nothing is checked", async () => {
    for (const answer of [{ type: "back" }, { type: "submit", selected: [false, false, false] }] as ChecklistResult[]) {
      const store = createStore(emptyWorkspaceConfig());

      await expect(runSuggestServicesFlow({ store, workspaceId: "ws_shop", keyInput: noKeys(), files, checklist: vi.fn(async () => answer) }))
        .resolves.toEqual({ type: "skipped" });
      expect(store.savedConfig).toBeUndefined();
    }
  });
});

function emptyWorkspaceConfig(): AppConfig {
  return { version: 2, workspaces: [{ id: "ws_shop", name: "shop", projectDirectory, items: [] }] };
}

function createStore(config: AppConfig) {
  return {
    savedConfig: undefined as AppConfig | undefined,
    async load() {
      return config;
    },
    async save(next: AppConfig) {
      this.savedConfig = next;
    },
  };
}

function noKeys() {
  return { readKey: vi.fn(async () => { throw new Error("No key queued."); }), close: vi.fn() };
}

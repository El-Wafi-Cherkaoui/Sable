import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import {
  runDeleteWorkspaceCommand,
  WorkspaceNotFoundError,
} from "./delete-workspace.js";

function createStore(initialConfig: AppConfig) {
  return {
    savedConfig: undefined as AppConfig | undefined,
    async load() {
      return initialConfig;
    },
    async save(config: AppConfig) {
      this.savedConfig = config;
    },
  };
}

function createPrompts(confirmed: boolean) {
  return {
    confirm: vi.fn(async () => confirmed),
  };
}

const config: AppConfig = {
  version: 1,
  workspaces: [
    {
      id: "ws_ecommerce",
      name: "ecommerce",
      services: [],
    },
    {
      id: "ws_api",
      name: "api",
      services: [],
    },
  ],
};

describe("runDeleteWorkspaceCommand", () => {
  it("deletes a confirmed workspace and preserves the others", async () => {
    const store = createStore(config);
    const prompts = createPrompts(true);
    const log = vi.fn();

    await runDeleteWorkspaceCommand("ecommerce", {
      store,
      prompts,
      output: { log },
    });

    expect(prompts.confirm).toHaveBeenCalledWith({
      message: 'Delete workspace "ecommerce"?',
      default: false,
    });
    expect(store.savedConfig).toEqual({
      version: 1,
      workspaces: [
        {
          id: "ws_api",
          name: "api",
          services: [],
        },
      ],
    });
    expect(log).toHaveBeenCalledWith('Deleted workspace "ecommerce".');
  });

  it("does not delete when confirmation is rejected", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runDeleteWorkspaceCommand("ecommerce", {
      store,
      prompts: createPrompts(false),
      output: { log },
    });

    expect(store.savedConfig).toBeUndefined();
    expect(log).toHaveBeenCalledWith("Delete cancelled.");
  });

  it("finds workspaces case-insensitively", async () => {
    const store = createStore(config);

    await runDeleteWorkspaceCommand(" API ", {
      store,
      prompts: createPrompts(true),
      output: { log: vi.fn() },
    });

    expect(store.savedConfig?.workspaces).toEqual([
      {
        id: "ws_ecommerce",
        name: "ecommerce",
        services: [],
      },
    ]);
  });

  it("throws for unknown workspaces", async () => {
    const store = createStore(config);
    const prompts = createPrompts(true);

    await expect(
      runDeleteWorkspaceCommand("missing", {
        store,
        prompts,
        output: { log: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(store.savedConfig).toBeUndefined();
  });
});

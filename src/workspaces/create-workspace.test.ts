import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import {
  DuplicateWorkspaceNameError,
  runCreateWorkspaceCommand,
  type CreateWorkspacePrompts,
  type WorkspaceConfigStore,
} from "./create-workspace.js";

function createStore(initialConfig: AppConfig): WorkspaceConfigStore & {
  savedConfig?: AppConfig;
} {
  return {
    async load() {
      return initialConfig;
    },
    async save(config: AppConfig) {
      this.savedConfig = config;
    },
  };
}

function createPrompts(values: Array<boolean | string>): CreateWorkspacePrompts {
  const nextValue = () => {
    const value = values.shift();

    if (value === undefined) {
      throw new Error("No prompt value was provided for this test.");
    }

    return value;
  };

  return {
    async confirm() {
      const value = nextValue();

      if (typeof value !== "boolean") {
        throw new TypeError("Expected a boolean prompt value.");
      }

      return value;
    },
    async input(options) {
      const value = nextValue();

      if (typeof value !== "string") {
        throw new TypeError("Expected a string prompt value.");
      }

      const validationResult = options.validate?.(value);

      if (validationResult !== undefined && validationResult !== true) {
        throw new Error(validationResult);
      }

      return value;
    },
  };
}

function createIdGenerator(ids: string[]) {
  return vi.fn(() => {
    const id = ids.shift();

    if (id === undefined) {
      throw new Error("No id was provided for this test.");
    }

    return id;
  });
}

const emptyConfig: AppConfig = {
  version: 1,
  workspaces: [],
};

describe("runCreateWorkspaceCommand", () => {
  it("creates an empty workspace", async () => {
    const store = createStore(emptyConfig);
    const log = vi.fn();

    await runCreateWorkspaceCommand("ecommerce", {
      store,
      prompts: createPrompts([projectDirectory, false]),
      output: { log, error: vi.fn() },
      generateId: createIdGenerator(["ws_abc12345"]),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig).toEqual({
      version: 1,
      workspaces: [
        {
          id: "ws_abc12345",
          name: "ecommerce",
          projectDirectory,
          services: [],
        },
      ],
    });
    expect(log).toHaveBeenCalledWith('Created workspace "ecommerce".');
  });

  it("preserves existing workspaces when appending a new workspace", async () => {
    const existingWorkspace = {
      id: "ws_existing",
      name: "api",
      projectDirectory,
      services: [],
    };
    const store = createStore({
      version: 1,
      workspaces: [existingWorkspace],
    });

    await runCreateWorkspaceCommand("web", {
      store,
      prompts: createPrompts([projectDirectory, false]),
      output: { log: vi.fn(), error: vi.fn() },
      generateId: createIdGenerator(["ws_new1234"]),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces).toEqual([
      existingWorkspace,
      {
        id: "ws_new1234",
        name: "web",
        projectDirectory,
        services: [],
      },
    ]);
  });

  it("creates a workspace with initial services", async () => {
    const store = createStore(emptyConfig);

    await runCreateWorkspaceCommand("ecommerce", {
      store,
      prompts: createPrompts([
        projectDirectory,
        true,
        " backend ",
        " npm run dev ",
        " ./backend ",
        true,
        false,
      ]),
      output: { log: vi.fn(), error: vi.fn() },
      generateId: createIdGenerator(["svc_abcd1234", "ws_efgh5678"]),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]).toEqual({
      id: "ws_efgh5678",
      name: "ecommerce",
      projectDirectory,
      services: [
        {
          id: "svc_abcd1234",
          name: "backend",
          command: "npm run dev",
          cwd: path.resolve(projectDirectory, "backend"),
          autoStart: true,
          env: {},
        },
      ],
    });
  });

  it("trims workspace names before saving", async () => {
    const store = createStore(emptyConfig);

    await runCreateWorkspaceCommand(" ecommerce ", {
      store,
      prompts: createPrompts([projectDirectory, false]),
      output: { log: vi.fn(), error: vi.fn() },
      generateId: createIdGenerator(["ws_abc12345"]),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.name).toBe("ecommerce");
  });

  it("rejects exact duplicate workspace names", async () => {
    const store = createStore({
      version: 1,
      workspaces: [{ id: "ws_existing", name: "ecommerce", projectDirectory, services: [] }],
    });

    await expect(
      runCreateWorkspaceCommand("ecommerce", {
        store,
        prompts: createPrompts([]),
        output: { log: vi.fn(), error: vi.fn() },
        generateId: createIdGenerator([]),
      }),
    ).rejects.toBeInstanceOf(DuplicateWorkspaceNameError);
    expect(store.savedConfig).toBeUndefined();
  });

  it("rejects case-insensitive duplicate workspace names", async () => {
    const store = createStore({
      version: 1,
      workspaces: [{ id: "ws_existing", name: "Ecommerce", projectDirectory, services: [] }],
    });

    await expect(
      runCreateWorkspaceCommand(" ecommerce ", {
        store,
        prompts: createPrompts([]),
        output: { log: vi.fn(), error: vi.fn() },
        generateId: createIdGenerator([]),
      }),
    ).rejects.toBeInstanceOf(DuplicateWorkspaceNameError);
    expect(store.savedConfig).toBeUndefined();
  });

  it("uses workspace and service id prefixes", async () => {
    const store = createStore(emptyConfig);

    await runCreateWorkspaceCommand("ecommerce", {
      store,
      prompts: createPrompts([
        projectDirectory,
        true,
        "backend",
        "npm run dev",
        ".",
        false,
        false,
      ]),
      output: { log: vi.fn(), error: vi.fn() },
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.id).toMatch(/^ws_/);
    expect(store.savedConfig?.workspaces[0]?.services[0]?.id).toMatch(/^svc_/);
  });

  it("preserves absolute service working directories", async () => {
    const store = createStore(emptyConfig);
    const serviceDirectory = path.resolve(projectDirectory, "api");

    await runCreateWorkspaceCommand("ecommerce", {
      store,
      prompts: createPrompts([
        projectDirectory,
        true,
        "api",
        "npm run dev",
        serviceDirectory,
        false,
        false,
      ]),
      output: { log: vi.fn(), error: vi.fn() },
      generateId: createIdGenerator(["svc_api1234", "ws_shop1234"]),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.services[0]?.cwd).toBe(serviceDirectory);
  });

  it("rejects project directories that do not exist or are not directories", async () => {
    const store = createStore(emptyConfig);
    const projectDirectoryExists = vi.fn(() => false);

    await expect(
      runCreateWorkspaceCommand("ecommerce", {
        store,
        prompts: createPrompts([projectDirectory]),
        output: { log: vi.fn(), error: vi.fn() },
        generateId: createIdGenerator([]),
        projectDirectoryExists,
      }),
    ).rejects.toThrow("Project directory must exist and be a directory.");
    expect(projectDirectoryExists).toHaveBeenCalledWith(projectDirectory);
    expect(store.savedConfig).toBeUndefined();
  });
});

const projectDirectory = path.resolve("C:\\projects\\shop");

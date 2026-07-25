import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import {
  runAddServiceToWorkspaceCommand,
  WorkspaceIdNotFoundError,
  type AddServiceConfigStore,
  type AddServicePrompts,
} from "./add-service.js";

describe("runAddServiceToWorkspaceCommand", () => {
  it("adds a service to the selected workspace", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runAddServiceToWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts([" worker ", " npm run worker ", " ./worker ", false]),
      output: { log },
      generateId: vi.fn(() => "svc_worker"),
      directoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.services).toEqual([
      existingService,
      {
        id: "svc_worker",
        name: "worker",
        command: "npm run worker",
        cwd: path.resolve(projectDirectory, "worker"),
        autoStart: false,
        env: {},
      },
    ]);
    expect(log).toHaveBeenCalledWith(
      'Added service "worker" to workspace "ecommerce".',
    );
  });

  it("uses process cwd as base directory for empty workspaces", async () => {
    const store = createStore({
      version: 1,
      workspaces: [{ id: "ws_empty", name: "empty", services: [] }],
    });

    await runAddServiceToWorkspaceCommand("ws_empty", {
      store,
      prompts: createPrompts(["api", "npm run dev", ".", true]),
      output: { log: vi.fn() },
      generateId: vi.fn(() => "svc_api"),
      directoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.services[0]?.cwd).toBe(
      path.resolve(process.cwd(), "."),
    );
  });

  it("rejects duplicate service names without saving", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceToWorkspaceCommand("ws_ecommerce", {
        store,
        prompts: createPrompts([" API "]),
        output: { log: vi.fn() },
      }),
    ).rejects.toThrow('Service "API" already exists in this workspace.');
    expect(store.savedConfig).toBeUndefined();
  });

  it("rejects missing service fields without saving", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceToWorkspaceCommand("ws_ecommerce", {
        store,
        prompts: createPrompts(["worker", ""]),
        output: { log: vi.fn() },
      }),
    ).rejects.toThrow("Service command is required.");
    expect(store.savedConfig).toBeUndefined();
  });

  it("rejects missing service directories without saving", async () => {
    const store = createStore(config);
    const directoryExists = vi.fn(() => false);

    await expect(
      runAddServiceToWorkspaceCommand("ws_ecommerce", {
        store,
        prompts: createPrompts(["worker", "npm run worker", "missing"]),
        output: { log: vi.fn() },
        directoryExists,
      }),
    ).rejects.toThrow("Service working directory must exist and be a directory.");
    expect(directoryExists).toHaveBeenCalledWith(path.resolve(projectDirectory, "missing"));
    expect(store.savedConfig).toBeUndefined();
  });

  it("throws for unknown workspace ids", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceToWorkspaceCommand("ws_missing", {
        store,
        prompts: createPrompts([]),
        output: { log: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(WorkspaceIdNotFoundError);
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(initialConfig: AppConfig): AddServiceConfigStore & {
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

function createPrompts(values: Array<boolean | string>): AddServicePrompts {
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

const projectDirectory = path.resolve("C:\\projects\\shop");
const existingService = {
  id: "svc_api",
  name: "api",
  command: "npm run dev",
  cwd: projectDirectory,
  autoStart: true,
  env: {},
};
const config: AppConfig = {
  version: 1,
  workspaces: [
    {
      id: "ws_ecommerce",
      name: "ecommerce",
      services: [existingService],
    },
  ],
};

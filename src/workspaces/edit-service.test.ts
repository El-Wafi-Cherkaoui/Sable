import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import { WorkspaceIdNotFoundError } from "./add-service.js";
import {
  runEditServiceInWorkspaceCommand,
  type EditServiceConfigStore,
  type EditServicePrompts,
} from "./edit-service.js";

describe("runEditServiceInWorkspaceCommand", () => {
  it("edits a service command", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runEditServiceInWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts(["svc_api", "command", " npm start "]),
      output: { log },
    });

    expect(store.savedConfig?.workspaces[0]?.services[0]?.command).toBe("npm start");
    expect(log).toHaveBeenCalledWith('Updated command for "api".');
  });

  it("edits a service working directory", async () => {
    const store = createStore(config);

    await runEditServiceInWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts(["svc_api", "cwd", "../api-next"]),
      output: { log: vi.fn() },
      directoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.services[0]?.cwd).toBe(
      path.resolve(projectDirectory, "../api-next"),
    );
  });

  it("toggles service autoStart", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runEditServiceInWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts(["svc_api", "autoStart"]),
      output: { log },
    });

    expect(store.savedConfig?.workspaces[0]?.services[0]?.autoStart).toBe(false);
    expect(log).toHaveBeenCalledWith('Auto-start disabled for "api".');
  });

  it("removes a service after confirmation", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runEditServiceInWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts(["svc_api", "remove", true]),
      output: { log },
    });

    expect(store.savedConfig?.workspaces[0]?.services).toEqual([workerService]);
    expect(log).toHaveBeenCalledWith(
      'Removed service "api" from workspace "ecommerce".',
    );
  });



  it("does not save when remove is cancelled", async () => {
    const store = createStore(config);
    const log = vi.fn();

    await runEditServiceInWorkspaceCommand("ws_ecommerce", {
      store,
      prompts: createPrompts(["svc_api", "remove", false]),
      output: { log },
    });

    expect(store.savedConfig).toBeUndefined();
    expect(log).toHaveBeenCalledWith("Remove cancelled.");
  });

  it("does not save when a workspace has no services", async () => {
    const store = createStore({
      version: 1,
      workspaces: [{ id: "ws_empty", name: "empty", services: [] }],
    });
    const log = vi.fn();

    await runEditServiceInWorkspaceCommand("ws_empty", {
      store,
      prompts: createPrompts([]),
      output: { log },
    });

    expect(store.savedConfig).toBeUndefined();
    expect(log).toHaveBeenCalledWith('Workspace "empty" has no services to edit.');
  });

  it("rejects empty edited command without saving", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceInWorkspaceCommand("ws_ecommerce", {
        store,
        prompts: createPrompts(["svc_api", "command", ""]),
        output: { log: vi.fn() },
      }),
    ).rejects.toThrow("Service command is required.");
    expect(store.savedConfig).toBeUndefined();
  });

  it("rejects missing edited working directories without saving", async () => {
    const store = createStore(config);
    const directoryExists = vi.fn(() => false);

    await expect(
      runEditServiceInWorkspaceCommand("ws_ecommerce", {
        store,
        prompts: createPrompts(["svc_api", "cwd", "missing"]),
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
      runEditServiceInWorkspaceCommand("ws_missing", {
        store,
        prompts: createPrompts([]),
        output: { log: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(WorkspaceIdNotFoundError);
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(initialConfig: AppConfig): EditServiceConfigStore & {
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

function createPrompts(values: Array<boolean | string>): EditServicePrompts {
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
    async select(options) {
      const value = nextValue();

      if (typeof value !== "string") {
        throw new TypeError("Expected a string prompt value.");
      }

      if (!options.choices.some((choice) => choice.value === value)) {
        throw new Error(`Unexpected select value: ${value}`);
      }

      return value;
    },
  };
}

const projectDirectory = path.resolve("C:\\projects\\shop\\api");
const apiService = {
  id: "svc_api",
  name: "api",
  command: "npm run dev",
  cwd: projectDirectory,
  autoStart: true,
  env: {},
};
const workerService = {
  id: "svc_worker",
  name: "worker",
  command: "npm run worker",
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
      services: [apiService, workerService],
    },
  ],
};

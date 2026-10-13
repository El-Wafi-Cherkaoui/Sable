import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import { runListWorkspacesCommand } from "./list-workspaces.js";

function createStore(config: AppConfig) {
  return {
    async load() {
      return config;
    },
  };
}

describe("runListWorkspacesCommand", () => {
  it("prints an empty message when there are no workspaces", async () => {
    const log = vi.fn();

    await runListWorkspacesCommand({
      store: createStore({ version: 2, workspaces: [] }),
      output: { log },
    });

    expect(log).toHaveBeenCalledWith("No workspaces found.");
  });

  it("prints workspace names with service counts", async () => {
    const log = vi.fn();

    await runListWorkspacesCommand({
      store: createStore({
        version: 2,
        workspaces: [
          {
            id: "ws_ecommerce",
            name: "ecommerce",
            items: [
              {
                kind: "service", after: [],
                id: "svc_backend",
                name: "backend",
                command: "npm run dev",
                cwd: ".",
                autoStart: true,
                env: {},
              },
              {
                kind: "service", after: [],
                id: "svc_frontend",
                name: "frontend",
                command: "npm run dev",
                cwd: "./frontend",
                autoStart: true,
                env: {},
              },
            ],
          },
          {
            id: "ws_api",
            name: "api",
            items: [],
          },
        ],
      }),
      output: { log },
    });

    expect(log).toHaveBeenNthCalledWith(1, "ecommerce  2 services");
    expect(log).toHaveBeenNthCalledWith(2, "api        0 services");
  });

  it("prints singular service count", async () => {
    const log = vi.fn();

    await runListWorkspacesCommand({
      store: createStore({
        version: 2,
        workspaces: [
          {
            id: "ws_api",
            name: "api",
            items: [
              {
                kind: "service", after: [],
                id: "svc_backend",
                name: "backend",
                command: "npm run dev",
                cwd: ".",
                autoStart: true,
                env: {},
              },
            ],
          },
        ],
      }),
      output: { log },
    });

    expect(log).toHaveBeenCalledWith("api  1 service");
  });
});

import { describe, expect, it } from "vitest";
import { safeValidateAppConfig } from "./config-schema.js";

const validService = {
  kind: "service", after: [],
  id: "service-1",
  name: "backend",
  command: "npm run dev",
  cwd: "/projects/app/backend",
  autoStart: true,
  env: {},
};

const validCommand = {
  kind: "command", after: [],
  id: "cmd-build",
  name: "build",
  command: "npm run build",
  cwd: "/projects/app",
  env: {},
};

function configWith(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    workspaces: [{ id: "workspace-1", name: "ecommerce", projectDirectory: "/projects/app", items, ...extra }],
  };
}

describe("config validation", () => {
  it("accepts a valid empty config", () => {
    const result = safeValidateAppConfig({
      version: 2,
      workspaces: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a valid workspace and service config", () => {
    const result = safeValidateAppConfig(configWith([
      { ...validService, env: { NODE_ENV: "development" } },
    ]));

    expect(result.success).toBe(true);
  });

  it("accepts one-shot workspace commands next to services", () => {
    const result = safeValidateAppConfig(configWith([validService, validCommand]));

    expect(result.success).toBe(true);
  });

  it("rejects an unknown config version", () => {
    expect(safeValidateAppConfig({ version: 3, workspaces: [] }).success).toBe(false);
  });

  it("rejects items without a known kind", () => {
    expect(safeValidateAppConfig(configWith([{ ...validService, kind: undefined }])).success).toBe(false);
    expect(safeValidateAppConfig(configWith([{ ...validService, kind: "job" }])).success).toBe(false);
  });

  it("requires autoStart on services but not on commands", () => {
    const { autoStart: _autoStart, ...withoutAutoStart } = validService;

    expect(safeValidateAppConfig(configWith([withoutAutoStart])).success).toBe(false);
    expect(safeValidateAppConfig(configWith([validCommand])).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = safeValidateAppConfig({
      version: 2,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects workspace names with spaces", () => {
    const result = safeValidateAppConfig(configWith([], { name: "my ecommerce" }));

    expect(result.success).toBe(false);
  });

  it("rejects invalid environment variable values", () => {
    const result = safeValidateAppConfig(configWith([{ ...validService, env: { PORT: 3000 } }]));

    expect(result.success).toBe(false);
  });

  it("rejects duplicate workspace names", () => {
    const result = safeValidateAppConfig({
      version: 2,
      workspaces: [
        { id: "workspace-1", name: "ecommerce", projectDirectory: "/projects/app", items: [] },
        { id: "workspace-2", name: "ecommerce", projectDirectory: "/projects/app-copy", items: [] },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate service names within one workspace", () => {
    const result = safeValidateAppConfig(configWith([validService, { ...validService, id: "service-2" }]));

    expect(result.success).toBe(false);
  });

  it("rejects duplicate command names within one workspace", () => {
    const result = safeValidateAppConfig(configWith([validCommand, { ...validCommand, id: "cmd-build-2" }]));

    expect(result.success).toBe(false);
  });

  it("allows a service and a command to share a name", () => {
    const result = safeValidateAppConfig(configWith([
      { ...validService, name: "build" },
      validCommand,
    ]));

    expect(result.success).toBe(true);
  });

  it("rejects two items with the same id, whatever their kind", () => {
    const result = safeValidateAppConfig(configWith([
      validService,
      { ...validCommand, id: validService.id },
    ]));

    expect(result.success).toBe(false);
  });

  it("defaults after to an empty list and accepts ids of other items", () => {
    const result = safeValidateAppConfig(configWith([
      validService,
      { ...validCommand, after: ["service-1"] },
    ]));

    expect(result.success).toBe(true);
    expect(result.success && result.data.workspaces[0]?.items.map((item) => item.after)).toEqual([[], ["service-1"]]);
  });

  it("rejects an after id that matches no item", () => {
    const result = safeValidateAppConfig(configWith([{ ...validService, after: ["ghost"] }]));

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toBe(
      '"backend" waits for an item with id "ghost", which isn\'t in workspace "ecommerce".',
    );
  });

  it("rejects items that wait for each other in a loop and names them", () => {
    const result = safeValidateAppConfig(configWith([
      { ...validService, after: ["cmd-build"] },
      { ...validCommand, after: ["service-1"] },
    ]));

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toBe("Items wait for each other in a loop: backend → build → backend.");
  });

  it("rejects an item that waits for itself", () => {
    expect(safeValidateAppConfig(configWith([{ ...validService, after: ["service-1"] }])).success).toBe(false);
  });
});

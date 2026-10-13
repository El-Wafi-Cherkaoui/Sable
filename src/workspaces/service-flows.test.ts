import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { FormResult, RunFormOptions } from "../tui/form-view.js";
import {
  runAddWorkspaceItemFlow,
  runDeleteItemFlow,
  runEditItemFlow,
  knownCommands,
  toDirectoryValue,
  validateItem,
  type ServiceFlowStore,
} from "./service-flows.js";

describe("runAddWorkspaceItemFlow", () => {
  it("adds a service from one form, resolving the folder against the project", async () => {
    const store = createStore(config);
    const form = fakeForm({ type: "service", name: "worker", command: "npm run worker", cwd: "jobs", autoStart: false, env: ["QUEUE=default"] });

    const result = await runAddWorkspaceItemFlow({
      store, workspace, keyInput: createKeyInput([]), form, generateId: () => "svc_worker", directoryExists: () => true,
    });

    expect(result).toEqual({ type: "completed", message: 'Added service "worker".', itemId: "svc_worker" });
    expect(store.savedConfig?.workspaces[0]?.items.at(-1)).toEqual({
      kind: "service", after: [],
      id: "svc_worker",
      name: "worker",
      command: "npm run worker",
      cwd: path.join(projectDirectory, "jobs"),
      autoStart: false,
      env: { QUEUE: "default" },
    });
  });

  it("adds a command when the form's type is command", async () => {
    const store = createStore(config);
    const form = fakeForm({ type: "command", name: "migrate", command: "npm run migrate", cwd: ".", env: [] });

    const result = await runAddWorkspaceItemFlow({
      store, workspace, keyInput: createKeyInput([]), form, generateId: () => "cmd_migrate", directoryExists: () => true,
    });

    expect(result).toEqual({ type: "completed", message: 'Added command "migrate".', itemId: "cmd_migrate" });
    expect(store.savedConfig?.workspaces[0]?.items.filter((item) => item.kind === "command")).toEqual([
      { kind: "command", after: [], id: "cmd_migrate", name: "migrate", command: "npm run migrate", cwd: projectDirectory, env: {} },
    ]);
  });

  it("opens a form with the type choice, defaults, and only service fields for services", async () => {
    const form = fakeForm({ type: "service", name: "x", command: "y", cwd: ".", autoStart: true, env: [] });

    await runAddWorkspaceItemFlow({ store: createStore(config), workspace, keyInput: createKeyInput([]), form, directoryExists: () => true });

    const options = form.mock.calls[0]![0];

    expect(options.values).toEqual({ type: "service", name: "", command: "", cwd: ".", autoStart: true, after: [], env: [] });
    expect(options.fields({ type: "service" }).map((field) => field.key)).toEqual(["type", "name", "command", "cwd", "autoStart", "after", "env"]);
    expect(options.fields({ type: "command" }).map((field) => field.key)).toEqual(["type", "name", "command", "cwd", "after", "env"]);
  });

  it("does not save when the form is cancelled or Sable exits", async () => {
    const store = createStore(config);

    await expect(runAddWorkspaceItemFlow({ store, workspace, keyInput: createKeyInput([]), form: vi.fn(async () => ({ type: "back" as const })) }))
      .resolves.toEqual({ type: "back", message: "Add cancelled." });
    await expect(runAddWorkspaceItemFlow({ store, workspace, keyInput: createKeyInput([]), form: vi.fn(async () => ({ type: "exit" as const })) }))
      .resolves.toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });

  it("works end to end with real keys", async () => {
    const store = createStore(config);

    const result = await runAddWorkspaceItemFlow({
      store,
      workspace,
      keyInput: createKeyInput([
        { name: "down" },
        ...text("web"),
        { name: "down" },
        ...text("npm run web"),
        { ctrl: true, name: "s" },
      ]),
      screen: createScreen(),
      generateId: () => "svc_web",
      directoryExists: () => true,
    });

    expect(result).toMatchObject({ type: "completed", itemId: "svc_web" });
    expect(store.savedConfig?.workspaces[0]?.items.at(-1)).toMatchObject({ name: "web", command: "npm run web", autoStart: true });
  });
});

describe("runEditItemFlow, for a service", () => {
  it("prefills the form and saves every changed field at once", async () => {
    const store = createStore(config);
    const form = fakeForm({ name: "api-server", command: "npm start", cwd: ".", autoStart: false, env: ["PORT=4000"] });

    const result = await runEditItemFlow({
      store, workspace, keyInput: createKeyInput([]), itemId: "svc_api", form, directoryExists: () => true,
    });

    expect(form.mock.calls[0]![0].values).toEqual({ name: "api", command: "npm run dev", cwd: ".", autoStart: true, after: [], env: [] });
    expect(result).toEqual({ type: "completed", message: 'Saved service "api-server".', itemId: "svc_api" });
    expect(store.savedConfig?.workspaces[0]?.items[0]).toEqual({
      kind: "service", after: [], id: "svc_api", name: "api-server", command: "npm start", cwd: projectDirectory, autoStart: false, env: { PORT: "4000" },
    });
  });

  it("goes back without saving when the item no longer exists", async () => {
    const store = createStore(config);

    await expect(runEditItemFlow({ store, workspace, keyInput: createKeyInput([]), itemId: "svc_gone", form: fakeForm({}) }))
      .resolves.toEqual({ type: "back", message: "That item no longer exists." });
    expect(store.savedConfig).toBeUndefined();
  });
});

describe("runEditItemFlow, for a command", () => {
  it("prefills and saves a command", async () => {
    const withCommand = { ...workspace, items: [{ kind: "command", after: [], id: "cmd_build", name: "build", command: "npm run build", cwd: projectDirectory, env: { CI: "1" } }] };
    const store = createStore({ version: 2, workspaces: [withCommand] });
    const form = fakeForm({ name: "build", command: "npm run build -- --prod", cwd: ".", env: ["CI=1"] });

    await runEditItemFlow({ store, workspace: withCommand, keyInput: createKeyInput([]), itemId: "cmd_build", form, directoryExists: () => true });

    expect(form.mock.calls[0]![0].values).toEqual({ name: "build", command: "npm run build", cwd: ".", after: [], env: ["CI=1"] });
    expect(store.savedConfig?.workspaces[0]?.items[0]).toMatchObject({ command: "npm run build -- --prod", env: { CI: "1" } });
  });
});

describe("validateItem", () => {
  const exists = () => true;

  it("requires a unique name and a command, case-insensitively, ignoring the item itself", () => {
    expect(validateItem("service", { name: "", command: "", cwd: "." }, workspaceWithTwoServices, undefined, exists))
      .toEqual({ name: "Name is required.", command: "Command is required." });
    expect(validateItem("service", { name: "WORKER", command: "x", cwd: "." }, workspaceWithTwoServices, undefined, exists))
      .toEqual({ name: 'A service named "WORKER" already exists.' });
    expect(validateItem("service", { name: "worker", command: "x", cwd: "." }, workspaceWithTwoServices, "svc_worker", exists))
      .toEqual({});
  });

  it("checks that the folder exists relative to the project", () => {
    const directoryExists = vi.fn(() => false);

    expect(validateItem("command", { name: "x", command: "y", cwd: "jobs" }, workspace, undefined, directoryExists))
      .toEqual({ cwd: "This folder doesn't exist." });
    expect(directoryExists).toHaveBeenCalledWith(path.join(projectDirectory, "jobs"));
  });

  it("validates environment variables one by one", () => {
    expect(validateItem("service", { name: "x", command: "y", cwd: ".", env: ["PORT=1", "bad", "PORT=2", "1X=3"] }, workspace, undefined, exists))
      .toEqual({
        "env.1": "Use KEY=value, e.g. PORT=3000.",
        "env.2": "PORT is set twice.",
        "env.3": "Use KEY=value, e.g. PORT=3000.",
      });
  });
});

describe("dependencies in the form", () => {
  const exists = () => true;
  const dbWorkspace = {
    ...workspace,
    items: [
      { kind: "service" as const, after: [], id: "svc_db", name: "db", command: "docker compose up db", cwd: projectDirectory, autoStart: true, env: {} },
      { kind: "service" as const, after: ["svc_db"], id: "svc_api", name: "api", command: "npm run dev", cwd: projectDirectory, autoStart: true, env: {} },
      { kind: "command" as const, after: [], id: "cmd_build", name: "build", command: "npm run build", cwd: projectDirectory, env: {} },
    ],
  };
  const dbConfig: AppConfig = { version: 2, workspaces: [dbWorkspace] };
  const base = { name: "worker", command: "x", cwd: "." };

  it("accepts names of other items, in any case, and rejects the rest row by row", () => {
    expect(validateItem("service", { ...base, after: ["DB", "build"] }, dbWorkspace, undefined, exists)).toEqual({});
    expect(validateItem("service", { ...base, after: ["db", "ghost", "", "db"] }, dbWorkspace, undefined, exists)).toEqual({
      "after.1": 'There is no service or command named "ghost".',
      "after.2": "Type the name of an item.",
      "after.3": '"db" is listed twice.',
    });
  });

  it("says which name is ambiguous when a service and a command share it", () => {
    const shared = { ...dbWorkspace, items: [...dbWorkspace.items, { ...dbWorkspace.items[2]!, id: "svc_build", kind: "service" as const, autoStart: false }] };

    expect(validateItem("service", { ...base, after: ["build"] }, shared, undefined, exists))
      .toEqual({ "after.0": 'Two items are named "build". Rename one of them first.' });
  });

  it("refuses an item that waits for itself or closes a loop", () => {
    expect(validateItem("service", { name: "api", command: "x", cwd: ".", after: ["api"] }, dbWorkspace, "svc_api", exists))
      .toEqual({ "after.0": "An item can't wait for itself." });
    expect(validateItem("service", { name: "db", command: "x", cwd: ".", after: ["api"] }, dbWorkspace, "svc_db", exists))
      .toEqual({ "after.0": "That would make items wait for each other: db → api → db." });
  });

  it("saves the ids of the chosen items and shows names when editing", async () => {
    const store = createStore(dbConfig);
    const form = fakeForm({ name: "api", command: "npm run dev", cwd: ".", autoStart: true, after: ["db", "build"], env: [] });

    await runEditItemFlow({ store, workspace: dbWorkspace, keyInput: createKeyInput([]), itemId: "svc_api", form, directoryExists: exists });

    expect(form.mock.calls[0]![0].values).toMatchObject({ after: ["db"] });
    expect(store.savedConfig?.workspaces[0]?.items.find((item) => item.id === "svc_api")?.after).toEqual(["svc_db", "cmd_build"]);
  });

  it("saves the ids when adding an item", async () => {
    const store = createStore(dbConfig);
    const form = fakeForm({ type: "command", name: "seed", command: "npm run seed", cwd: ".", after: ["db"], env: [] });

    await runAddWorkspaceItemFlow({ store, workspace: dbWorkspace, keyInput: createKeyInput([]), form, generateId: () => "cmd_seed", directoryExists: exists });

    expect(store.savedConfig?.workspaces[0]?.items.at(-1)?.after).toEqual(["svc_db"]);
  });

  it("stops other items waiting for an item that is deleted", async () => {
    const store = createStore(dbConfig);
    const deleteDialog = vi.fn(async () => "confirmed" as const);

    await runDeleteItemFlow({ store, workspace: dbWorkspace, keyInput: createKeyInput([]), itemId: "svc_db", deleteDialog });

    expect(store.savedConfig?.workspaces[0]?.items.map((item) => item.id)).toEqual(["svc_api", "cmd_build"]);
    expect(store.savedConfig?.workspaces[0]?.items[0]?.after).toEqual([]);
  });
});

describe("toDirectoryValue", () => {
  it("shows folders inside the project as relative paths", () => {
    expect(toDirectoryValue(projectDirectory, projectDirectory)).toBe(".");
    expect(toDirectoryValue(path.join(projectDirectory, "api"), projectDirectory)).toBe("api");
    expect(toDirectoryValue(path.resolve(path.sep, "elsewhere"), projectDirectory)).toBe(path.resolve(path.sep, "elsewhere"));
  });
});

describe("runDeleteItemFlow", () => {
  it("deletes a service after typed-name confirmation", async () => {
    const store = createStore(config);

    await expect(
      runDeleteItemFlow({
        store,
        workspace,
        itemId: "svc_api",
        keyInput: createKeyInput([
          { sequence: "a" },
          { sequence: "p" },
          { sequence: "i" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Deleted service "api" from workspace "ecommerce".',
      removedItemId: "svc_api",
    });
    expect(store.savedConfig?.workspaces[0]?.items).toEqual([]);
  });

  it("keeps prompting when the typed service name does not match", async () => {
    const store = createStore(config);

    await runDeleteItemFlow({
      store,
      workspace,
      itemId: "svc_api",
      keyInput: createKeyInput([
        { sequence: "x" },
        { name: "return" },
        { name: "backspace" },
        { sequence: "a" },
        { sequence: "p" },
        { sequence: "i" },
        { name: "return" },
      ]),
      screen: createScreen(),
    });

    expect(store.savedConfig?.workspaces[0]?.items).toEqual([]);
  });

  it("goes back without saving on Esc", async () => {
    const store = createStore(config);

    await expect(
      runDeleteItemFlow({
        store,
        workspace,
        itemId: "svc_api",
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Delete service cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    await expect(
      runDeleteItemFlow({
        store,
        workspace,
        itemId: "svc_api",
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(initialConfig: AppConfig): ServiceFlowStore & {
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

function createKeyInput(keys: Awaited<ReturnType<KeyInput["readKey"]>>[]): KeyInput {
  return {
    readKey: vi.fn(async () => {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key queued.");
      }

      return key;
    }),
    close: vi.fn(),
  };
}

function fakeForm(values: Record<string, string | boolean | string[]>) {
  return vi.fn(async (_options: RunFormOptions): Promise<FormResult> => ({ type: "submit", values }));
}

function createScreen() {
  const writes: string[] = [];

  return {
    clear: vi.fn(),
    write: vi.fn((contents: string) => writes.push(contents)),
    output: () => writes.join("\n"),
  };
}

function backspaces(count: number): Array<{ name: "backspace" }> {
  return Array.from({ length: count }, () => ({ name: "backspace" as const }));
}

function text(value: string): Array<{ sequence: string }> {
  return [...value].map((sequence) => ({ sequence }));
}

const projectDirectory = path.resolve(path.sep, "projects", "shop");
const workspace = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory,
  items: [
    {
      kind: "service", after: [],
      id: "svc_api",
      name: "api",
      command: "npm run dev",
      cwd: projectDirectory,
      autoStart: true,
      env: {},
    },
  ],
};
const config: AppConfig = {
  version: 2,
  workspaces: [workspace],
};

const workspaceWithTwoServices = {
  ...workspace,
  items: [
    ...workspace.items,
    {
      kind: "service", after: [],
      id: "svc_worker",
      name: "worker",
      command: "npm run worker",
      cwd: projectDirectory,
      autoStart: false,
      env: {},
    },
  ],
};

const configWithTwoServices: AppConfig = {
  version: 2,
  workspaces: [workspaceWithTwoServices],
};

describe("knownCommands", () => {
  it("lists this workspace's commands first, then the others', each once", () => {
    const item = (command: string) => ({ id: command, name: command, command, cwd: projectDirectory, env: {} });
    const mine = { ...workspace, items: [{ kind: "service", after: [], ...item("npm run dev"), autoStart: true }, { ...item("npm run lint"), kind: "command" }] };
    const other = { ...workspace, id: "other", items: [{ kind: "service", after: [], ...item("npm run dev"), autoStart: true }, { kind: "service", after: [], ...item("docker compose up"), autoStart: true }, { ...item("  "), kind: "command" }] };

    expect(knownCommands({ ...config, workspaces: [other, mine] }, mine)).toEqual(["npm run dev", "npm run lint", "docker compose up"]);
  });
});

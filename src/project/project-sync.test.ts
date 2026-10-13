import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import { parseProjectFile, type ProjectFile } from "./project-file.js";
import {
  declaredPlaceholders,
  describeProjectChanges,
  missingPlaceholders,
  removeItemHere,
  resolveProjectItems,
  syncProject,
} from "./project-sync.js";

const projectDirectory = path.resolve("/work/shop");

function file(value: unknown): { file: ProjectFile; hash: string } {
  const result = parseProjectFile(JSON.stringify(value));

  if (result.type !== "ok") {
    throw new Error(result.type === "invalid" ? result.message : "missing");
  }

  return { file: result.file, hash: result.hash };
}

const baseFile = {
  version: 1,
  placeholders: { API_PORT: { description: "Port for the API", default: "3000" }, TOKEN: {} },
  items: [
    { type: "service", name: "db", command: "docker compose up db" },
    { type: "service", name: "api", command: "npm run dev -- --port {{API_PORT}}", cwd: "api", after: ["db"], env: { PORT: "{{API_PORT}}" } },
    { type: "command", name: "build", command: "npm run build" },
  ],
};

function empty(): WorkspaceConfig {
  return { id: "ws", name: "shop", projectDirectory, items: [] };
}

let counter = 0;
const generateId = (prefix: string) => `${prefix}_${++counter}`;

function sync(workspace: WorkspaceConfig, value: unknown, values: Record<string, string> = { TOKEN: "t" }) {
  const parsed = file(value);

  return syncProject({ workspace, file: parsed.file, hash: parsed.hash, values, generateId: generateId as never });
}

const itemNamed = (workspace: WorkspaceConfig, name: string) => workspace.items.find((item) => item.name === name)!;

describe("placeholders", () => {
  const { file: parsed } = file(baseFile);

  it("lists the declared placeholders and which still need an answer", () => {
    expect(declaredPlaceholders(parsed)).toEqual([
      { name: "API_PORT", description: "Port for the API", default: "3000" },
      { name: "TOKEN" },
    ]);
    expect(missingPlaceholders(parsed, {})).toEqual(["TOKEN"]);
    expect(missingPlaceholders(parsed, { TOKEN: "x" })).toEqual([]);
  });

  it("fills in values, falls back to defaults, and makes folders absolute", () => {
    const [, api] = resolveProjectItems(parsed, { API_PORT: "4000", TOKEN: "x" }, projectDirectory);
    const [, defaulted] = resolveProjectItems(parsed, { TOKEN: "x" }, projectDirectory);

    expect(api).toEqual({
      name: "api",
      kind: "service",
      command: "npm run dev -- --port 4000",
      cwd: path.join(projectDirectory, "api"),
      env: { PORT: "4000" },
      autoStart: true,
      after: ["db"],
      secrets: [],
    });
    expect(defaulted?.env).toEqual({ PORT: "3000" });
  });

  it("gives commands no autoStart and respects autoStart: false", () => {
    const resolved = resolveProjectItems(file({ version: 1, items: [
      { type: "command", name: "c", command: "x" },
      { type: "service", name: "s", command: "x", autoStart: false },
    ] }).file, {}, projectDirectory);

    expect(resolved[0]).not.toHaveProperty("autoStart");
    expect(resolved[1]?.autoStart).toBe(false);
  });

  it("throws when a value is missing, which callers prevent by asking first", () => {
    const needsValue = file({ version: 1, placeholders: { TOKEN: {} }, items: [{ type: "service", name: "a", command: "run {{TOKEN}}" }] }).file;

    expect(() => resolveProjectItems(needsValue, {}, projectDirectory)).toThrow("No value for {{TOKEN}}");
  });
});

describe("syncProject, first import", () => {
  it("creates an item for each entry, marked as coming from the file, with waits linked by id", () => {
    const { workspace, summary } = sync(empty(), baseFile, { TOKEN: "t", API_PORT: "4000" });
    const api = itemNamed(workspace, "api");

    expect(workspace.items.map((item) => [item.kind, item.name, item.fromProject])).toEqual([
      ["service", "db", "db"],
      ["service", "api", "api"],
      ["command", "build", "build"],
    ]);
    expect(api.after).toEqual([itemNamed(workspace, "db").id]);
    expect(api.command).toBe("npm run dev -- --port 4000");
    expect(summary).toEqual({ added: ["db", "api", "build"], updated: [], removed: [] });
  });

  it("remembers the approved hash, this machine's answers, and what the file said", () => {
    const parsed = file(baseFile);
    const { workspace } = sync(empty(), baseFile, { TOKEN: "t" });

    expect(workspace.project?.hash).toBe(parsed.hash);
    expect(workspace.project?.values).toEqual({ TOKEN: "t" });
    expect(Object.keys(workspace.project?.base ?? {})).toEqual(["db", "api", "build"]);
    expect(workspace.project?.base.api?.after).toEqual(["db"]);
    expect(workspace.project?.removed).toEqual([]);
  });

  it("leaves items the user added themselves alone", () => {
    const local: ServiceConfig = { kind: "service", id: "svc_local", name: "mine", command: "x", cwd: projectDirectory, autoStart: false, env: {}, after: [] };
    const { workspace } = sync({ ...empty(), items: [local] }, baseFile);

    expect(workspace.items[0]).toEqual(local);
    expect(workspace.items).toHaveLength(4);
  });
});

describe("syncProject, later changes to the file", () => {
  const first = () => sync(empty(), baseFile, { TOKEN: "t" }).workspace;
  const withChange = (change: (value: typeof baseFile) => unknown) => change(structuredClone(baseFile));

  it("applies the file's change to a field the user did not touch", () => {
    const next = sync(first(), withChange((value) => {
      value.items[2] = { type: "command", name: "build", command: "npm run build:prod" } as never;

      return value;
    }), { TOKEN: "t" });

    expect(itemNamed(next.workspace, "build").command).toBe("npm run build:prod");
    expect(next.summary.updated).toEqual(["build"]);
  });

  it("keeps what the user changed here, and still applies the file's other changes", () => {
    const edited = first();
    const api = itemNamed(edited, "api");
    const local = { ...edited, items: edited.items.map((item) => item.id === api.id ? { ...item, command: "pnpm dev" } : item) };
    const next = sync(local, withChange((value) => {
      value.items[1] = { ...value.items[1]!, command: "npm run start", env: { PORT: "9000" } } as never;

      return value;
    }), { TOKEN: "t" });

    expect(itemNamed(next.workspace, "api").command).toBe("pnpm dev");
    expect(itemNamed(next.workspace, "api").env).toEqual({ PORT: "9000" });
  });

  it("adds new items, and removes items that left the file along with the waits on them", () => {
    const next = sync(first(), withChange((value) => {
      value.items = [
        { type: "service", name: "api", command: "npm run dev", cwd: "api" } as never,
        { type: "service", name: "worker", command: "npm run worker", after: ["api"] } as never,
      ];

      return value;
    }), { TOKEN: "t" });

    expect(next.workspace.items.map((item) => item.name)).toEqual(["api", "worker"]);
    expect(next.summary.added).toEqual(["worker"]);
    expect(next.summary.removed).toEqual(["db", "build"]);
    expect(itemNamed(next.workspace, "api").after).toEqual([]);
    expect(itemNamed(next.workspace, "worker").after).toEqual([itemNamed(next.workspace, "api").id]);
  });

  it("applies a new placeholder answer to fields that still follow the file", () => {
    const next = sync(first(), baseFile, { TOKEN: "t", API_PORT: "4100" });

    expect(itemNamed(next.workspace, "api").env).toEqual({ PORT: "4100" });
    expect(itemNamed(next.workspace, "api").command).toBe("npm run dev -- --port 4100");
  });

  it("does not bring back an item the user removed here, and forgets it once the file drops it", () => {
    const imported = first();
    const removed = removeItemHere(imported, itemNamed(imported, "db").id);

    expect(removed.project?.removed).toEqual(["db"]);
    expect(itemNamed(removed, "api").after).toEqual([]);

    const again = sync(removed, baseFile, { TOKEN: "t" });

    expect(again.workspace.items.map((item) => item.name)).toEqual(["api", "build"]);
    expect(again.workspace.project?.removed).toEqual(["db"]);
    expect(itemNamed(again.workspace, "api").after).toEqual([]);

    const dropped = sync(removed, withChange((value) => {
      value.items = value.items.filter((item) => item.name !== "db").map((item) => ({ ...item, after: [] })) as never;

      return value;
    }), { TOKEN: "t" });

    expect(dropped.workspace.project?.removed).toEqual([]);
  });

  it("keeps the waits the user set here", () => {
    const edited = first();
    const api = itemNamed(edited, "api");
    const build = itemNamed(edited, "build");
    const local = { ...edited, items: edited.items.map((item) => item.id === api.id ? { ...item, after: [build.id] } : item) };
    const next = sync(local, baseFile, { TOKEN: "t" });

    expect(itemNamed(next.workspace, "api").after).toEqual([build.id]);
  });

  it("follows the file when its waits change and the user left them alone", () => {
    const next = sync(first(), withChange((value) => {
      value.items[1] = { ...value.items[1]!, after: ["db", "build"] } as never;

      return value;
    }), { TOKEN: "t" });

    expect(itemNamed(next.workspace, "api").after).toEqual([itemNamed(next.workspace, "db").id, itemNamed(next.workspace, "build").id]);
  });

  it("replaces an item whose type changed, keeping its id", () => {
    const before = first();
    const next = sync(before, withChange((value) => {
      value.items[2] = { type: "service", name: "build", command: "npm run build -- --watch" } as never;

      return value;
    }), { TOKEN: "t" });

    expect(itemNamed(next.workspace, "build").kind).toBe("service");
    expect(itemNamed(next.workspace, "build").id).toBe(itemNamed(before, "build").id);
  });

  it("changes nothing when the file is the same", () => {
    const before = first();
    const next = sync(before, baseFile, { TOKEN: "t" });

    expect(next.workspace).toEqual(before);
    expect(next.summary).toEqual({ added: [], updated: [], removed: [] });
  });
});

describe("syncProject, secret variables", () => {
  const withSecrets = (secrets: string[], env: Record<string, string> = { PORT: "3000" }) => ({
    version: 1,
    items: [{ type: "service", name: "api", command: "npm run dev", env, secrets }],
  });
  const apiOf = (workspace: WorkspaceConfig) => itemNamed(workspace, "api");
  const setEnv = (workspace: WorkspaceConfig, env: Record<string, string>): WorkspaceConfig => ({
    ...workspace,
    items: workspace.items.map((item) => item.name === "api" ? { ...item, env } : item),
  });

  it("creates the item with the secrets named but no value for them", () => {
    const { workspace } = sync(empty(), withSecrets(["STRIPE_KEY"]), {});

    expect(apiOf(workspace)).toMatchObject({ env: { PORT: "3000" }, secrets: ["STRIPE_KEY"] });
    expect(workspace.project?.base.api).toMatchObject({ env: { PORT: "3000" }, secrets: ["STRIPE_KEY"] });
  });

  it("keeps the value the user typed for a secret through every later update of the file", () => {
    const first = sync(empty(), withSecrets(["STRIPE_KEY"]), {}).workspace;
    const typed = setEnv(first, { PORT: "3000", STRIPE_KEY: "sk_live_mine" });
    const updated = sync(typed, { ...withSecrets(["STRIPE_KEY"]), items: [{ type: "service", name: "api", command: "npm run start", env: { PORT: "4000" }, secrets: ["STRIPE_KEY"] }] }, {}).workspace;

    expect(apiOf(updated)).toMatchObject({ command: "npm run start", env: { PORT: "4000", STRIPE_KEY: "sk_live_mine" } });
  });

  it("does not mistake the secret value for a local change, so the file's other variables still update", () => {
    const first = sync(empty(), withSecrets(["STRIPE_KEY"]), {}).workspace;
    const typed = setEnv(first, { PORT: "3000", STRIPE_KEY: "sk_live_mine" });
    const same = sync(typed, withSecrets(["STRIPE_KEY"], { PORT: "5000" }), {}).workspace;

    expect(apiOf(same).env).toEqual({ PORT: "5000", STRIPE_KEY: "sk_live_mine" });
  });

  it("still keeps a plain variable the user changed here", () => {
    const first = sync(empty(), withSecrets(["STRIPE_KEY"]), {}).workspace;
    const edited = setEnv(first, { PORT: "9999", STRIPE_KEY: "sk_live_mine" });
    const updated = sync(edited, withSecrets(["STRIPE_KEY"], { PORT: "5000" }), {}).workspace;

    expect(apiOf(updated).env).toEqual({ PORT: "9999", STRIPE_KEY: "sk_live_mine" });
  });

  it("asks for a secret the file starts to need, without touching the others", () => {
    const first = sync(empty(), withSecrets(["STRIPE_KEY"]), {}).workspace;
    const typed = setEnv(first, { PORT: "3000", STRIPE_KEY: "sk_live_mine" });
    const updated = sync(typed, withSecrets(["STRIPE_KEY", "DATABASE_URL"]), {}).workspace;

    expect(apiOf(updated)).toMatchObject({ secrets: ["STRIPE_KEY", "DATABASE_URL"], env: { PORT: "3000", STRIPE_KEY: "sk_live_mine" } });
    expect(apiOf(updated).env.DATABASE_URL).toBeUndefined();
  });

  it("keeps a variable the user marked secret here, as theirs", () => {
    const first = sync(empty(), withSecrets([]), {}).workspace;
    const marked = { ...setEnv(first, { PORT: "3000", MINE: "x" }), items: setEnv(first, { PORT: "3000", MINE: "x" }).items.map((item) => ({ ...item, secrets: ["MINE"] })) };
    const updated = sync(marked, withSecrets([]), {}).workspace;

    expect(apiOf(updated)).toMatchObject({ secrets: ["MINE"], env: { PORT: "3000", MINE: "x" } });
  });

  it("shows a new secret in the changes the user is asked to approve", () => {
    const approved = sync(empty(), withSecrets([]), {}).workspace.project!.base;
    const changes = describeProjectChanges(approved, resolveProjectItems(file(withSecrets(["STRIPE_KEY"])).file, {}, projectDirectory));

    expect(changes.changed.map((entry) => entry.item.name)).toEqual(["api"]);
  });
});

describe("describeProjectChanges", () => {
  const resolvedNow = (value: unknown, values: Record<string, string> = { TOKEN: "t" }) =>
    resolveProjectItems(file(value).file, values, projectDirectory);

  it("calls everything added the first time", () => {
    const changes = describeProjectChanges(undefined, resolvedNow(baseFile));

    expect(changes.added.map((item) => item.name)).toEqual(["db", "api", "build"]);
    expect(changes.changed).toEqual([]);
    expect(changes.removed).toEqual([]);
  });

  it("lists added, changed and removed items against what was approved", () => {
    const approved = sync(empty(), baseFile, { TOKEN: "t" }).workspace.project!.base;
    const changes = describeProjectChanges(approved, resolvedNow({
      version: 1,
      items: [
        { type: "service", name: "api", command: "npm run dev -- --port 3000", cwd: "api", after: ["db"], env: { PORT: "3000" } },
        { type: "service", name: "db", command: "docker compose up db" },
        { type: "command", name: "seed", command: "npm run seed" },
      ],
    }));

    expect(changes.added.map((item) => item.name)).toEqual(["seed"]);
    expect(changes.removed).toEqual(["build"]);
    expect(changes.changed).toEqual([]);

    const edited = describeProjectChanges(approved, resolvedNow({
      ...baseFile,
      items: baseFile.items.map((item) => item.name === "build" ? { ...item, command: "rm -rf /" } : item),
    }));

    expect(edited.changed.map((entry) => [entry.item.name, entry.before.command, entry.item.command])).toEqual([["build", "npm run build", "rm -rf /"]]);
  });

  it("notices a different answer for a placeholder as a change to the commands that use it", () => {
    const approved = sync(empty(), baseFile, { TOKEN: "t" }).workspace.project!.base;
    const changes = describeProjectChanges(approved, resolvedNow(baseFile, { TOKEN: "t", API_PORT: "9999" }));

    expect(changes.changed.map((entry) => entry.item.name)).toEqual(["api"]);
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import { buildProjectFile } from "./project-export.js";
import { parseProjectFile } from "./project-file.js";

const projectDirectory = path.resolve("/work/shop");
const home = path.resolve("/home/me");

function item(partial: Record<string, unknown>) {
  return { kind: "service", after: [], id: "svc_x", name: "x", command: "npm run dev", cwd: projectDirectory, autoStart: true, env: {}, ...partial } as WorkspaceConfig["items"][number];
}

function workspaceOf(...items: WorkspaceConfig["items"]): WorkspaceConfig {
  return { id: "ws", name: "shop", projectDirectory, items };
}

const parsed = (text: string) => JSON.parse(text) as { name: string; placeholders?: Record<string, unknown>; items: Array<Record<string, unknown>> };

describe("buildProjectFile", () => {
  it("writes the workspace as a valid file with folders relative to the project and waits by name", () => {
    const db = item({ id: "svc_db", name: "db", command: "docker compose up db", autoStart: false });
    const api = item({ id: "svc_api", name: "api", cwd: path.join(projectDirectory, "api"), after: ["svc_db"], env: { PORT: "3000" } });
    const build = item({ kind: "command", id: "cmd_build", name: "build", command: "npm run build" });
    const { text, notes } = buildProjectFile(workspaceOf(db, api, build), home);
    const file = parsed(text);

    expect(file.name).toBe("shop");
    expect(file.items).toEqual([
      { type: "service", name: "db", command: "docker compose up db", autoStart: false },
      { type: "service", name: "api", command: "npm run dev", cwd: "api", after: ["db"], env: { PORT: "3000" } },
      { type: "command", name: "build", command: "npm run build" },
    ]);
    expect(notes).toEqual([]);
    expect(parseProjectFile(text).type).toBe("ok");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps a list of names on one line", () => {
    const db = item({ id: "svc_db", name: "db" });
    const cache = item({ id: "svc_cache", name: "cache" });
    const api = item({ id: "svc_api", name: "api", after: ["svc_db", "svc_cache"] });
    const { text } = buildProjectFile(workspaceOf(db, cache, api), home);

    expect(text).toContain('"after": ["db", "cache"]');
    expect(parseProjectFile(text).type).toBe("ok");
  });

  it("keeps values that look like secrets out of the file, using a placeholder and remembering the real value", () => {
    const api = item({ id: "svc_api", name: "api", env: { PORT: "3000", STRIPE_API_KEY: "sk_live_123", DB_PASSWORD: "hunter2" } });
    const { text, values, notes } = buildProjectFile(workspaceOf(api), home);
    const file = parsed(text);

    expect(text).not.toContain("sk_live_123");
    expect(text).not.toContain("hunter2");
    expect(file.items[0]?.env).toEqual({ PORT: "3000", STRIPE_API_KEY: "{{API_STRIPE_API_KEY}}", DB_PASSWORD: "{{API_DB_PASSWORD}}" });
    expect(Object.keys(file.placeholders ?? {})).toEqual(["API_STRIPE_API_KEY", "API_DB_PASSWORD"]);
    expect(values).toEqual({ API_STRIPE_API_KEY: "sk_live_123", API_DB_PASSWORD: "hunter2" });
    expect(notes.join(" ")).toContain("STRIPE_API_KEY looks like a secret");
    expect(parseProjectFile(text).type).toBe("ok");
  });

  it("gives each secret its own placeholder, even when two items use the same variable", () => {
    const first = item({ id: "svc_a", name: "a", env: { TOKEN: "one" } });
    const second = item({ id: "svc_b", name: "b", env: { TOKEN: "two" } });
    const { values } = buildProjectFile(workspaceOf(first, second), home);

    expect(values).toEqual({ A_TOKEN: "one", B_TOKEN: "two" });
  });

  it("makes valid placeholder names out of awkward item names", () => {
    const { values, text } = buildProjectFile(workspaceOf(item({ id: "svc_a", name: "my api!", env: { TOKEN: "t" } }), item({ id: "svc_b", name: "2nd", env: { TOKEN: "u" } })), home);

    expect(Object.keys(values)).toEqual(["MY_API_TOKEN", "X_2ND_TOKEN"]);
    expect(parseProjectFile(text).type).toBe("ok");
  });

  it("uses the project folder, and says so, for a folder outside the project", () => {
    const outside = item({ id: "svc_o", name: "outside", cwd: path.resolve("/somewhere/else") });
    const { text, notes } = buildProjectFile(workspaceOf(outside), home);

    expect(parsed(text).items[0]).not.toHaveProperty("cwd");
    expect(notes.join(" ")).toContain("outside the project");
  });

  it("warns about commands that mention a folder on this machine", () => {
    const home1 = item({ id: "svc_h", name: "home", command: `node ${path.join(home, "tools", "serve.js")}` });
    const proj = item({ id: "svc_p", name: "proj", env: { DATA: path.join(projectDirectory, "data") } });
    const { notes } = buildProjectFile(workspaceOf(home1, proj), home);

    expect(notes.filter((note) => note.includes("folder on this machine"))).toHaveLength(2);
  });

  it("renames a command that shares its name with a service, so the file stays valid", () => {
    const service = item({ id: "svc_b", name: "build" });
    const command = item({ kind: "command", id: "cmd_b", name: "build", command: "npm run build" });
    const { text, names, notes } = buildProjectFile(workspaceOf(service, command), home);

    expect(parsed(text).items.map((entry) => entry.name)).toEqual(["build", "build (command)"]);
    expect(names.get("cmd_b")).toBe("build (command)");
    expect(notes.join(" ")).toContain('called "build (command)"');
    expect(parseProjectFile(text).type).toBe("ok");
  });

  it("drops waits on items that no longer exist", () => {
    const api = item({ id: "svc_api", name: "api", after: ["svc_gone"] });
    const { text } = buildProjectFile(workspaceOf(api), home);

    expect(parsed(text).items[0]).not.toHaveProperty("after");
  });

  it("writes an empty workspace as a valid file", () => {
    expect(parseProjectFile(buildProjectFile(workspaceOf(), home).text).type).toBe("ok");
  });
});

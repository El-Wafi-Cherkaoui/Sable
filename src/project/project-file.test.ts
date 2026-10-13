import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashOf, parseProjectFile, projectFileName, readProjectFile } from "./project-file.js";

const minimal = { version: 1, items: [{ type: "service", name: "api", command: "npm run dev" }] };

function parse(value: unknown) {
  return parseProjectFile(JSON.stringify(value));
}

function problems(value: unknown): string {
  const result = parse(value);

  return result.type === "invalid" ? result.message : "";
}

describe("parseProjectFile", () => {
  it("fills in the defaults for a small file", () => {
    const result = parse(minimal);

    expect(result.type).toBe("ok");
    expect(result.type === "ok" && result.file).toEqual({
      version: 1,
      placeholders: {},
      items: [{ type: "service", name: "api", command: "npm run dev", cwd: ".", after: [], env: {} }],
    });
  });

  it("accepts a full file with placeholders, folders, env and order", () => {
    const result = parse({
      version: 1,
      name: "shop",
      placeholders: { API_PORT: { description: "Port for the API", default: "3000" } },
      items: [
        { type: "service", name: "db", command: "docker compose up db", autoStart: false },
        { type: "service", name: "api", command: "npm run dev -- --port {{API_PORT}}", cwd: "api", after: ["db"], env: { PORT: "{{API_PORT}}" } },
        { type: "command", name: "build", command: "npm run build", cwd: "./web" },
      ],
    });

    expect(result.type).toBe("ok");
  });

  it("gives the same hash for the same content however it is written, and a new one when it changes", () => {
    const first = parseProjectFile('{"version":1,"items":[{"type":"service","name":"api","command":"npm run dev"}]}');
    const second = parseProjectFile(`{
      "items": [ { "command": "npm run dev", "name": "api", "type": "service" } ],
      "version": 1
    }`);
    const changed = parse({ version: 1, items: [{ type: "service", name: "api", command: "npm run evil" }] });

    expect(first.type === "ok" && second.type === "ok" && first.hash).toBe(second.type === "ok" ? second.hash : "");
    expect(changed.type === "ok" && changed.hash).not.toBe(first.type === "ok" ? first.hash : "");
    expect(hashOf({ b: 1, a: [1, 2] })).toBe(hashOf({ a: [1, 2], b: 1 }));
  });

  it("says a file is not valid JSON", () => {
    const result = parseProjectFile("{ nope");

    expect(result.type === "invalid" && result.message).toContain("sable.json is not valid JSON");
  });

  it("rejects an unknown version, unknown keys (typos), and items without a type, name or command", () => {
    expect(problems({ ...minimal, version: 2 })).toContain("version");
    expect(problems({ version: 1, items: [{ type: "service", name: "api", comand: "npm run dev", command: "x" }] })).toContain("items.0");
    expect(problems({ version: 1, items: [{ type: "job", name: "a", command: "x" }] })).toContain("items.0.type");
    expect(problems({ version: 1, items: [{ type: "service", command: "x" }] })).toContain("items.0.name");
    expect(problems({ version: 1, items: [{ type: "service", name: "a" }] })).toContain("items.0.command");
  });

  it("rejects two items with the same name, and a command that auto-starts", () => {
    expect(problems({ version: 1, items: [{ ...minimal.items[0] }, { ...minimal.items[0], type: "command" }] }))
      .toContain('items.1.name: Two items are named "api".');
    expect(problems({ version: 1, items: [{ type: "command", name: "build", command: "x", autoStart: true }] }))
      .toContain("items.0.autoStart: Only services can auto-start.");
  });

  it("only allows folders inside the project, written relative to it", () => {
    for (const cwd of ["/home/me/app", "C:\\work\\app", "..", "../other", "a/../../b"]) {
      expect(problems({ version: 1, items: [{ type: "service", name: "a", command: "x", cwd }] })).toContain("items.0.cwd");
    }

    for (const cwd of [".", "api", "./api/web", "a/../b", "api\\web"]) {
      expect(parse({ version: 1, items: [{ type: "service", name: "a", command: "x", cwd }] }).type).toBe("ok");
    }
  });

  it("requires every placeholder in a command or env value to be declared, and names to be capitalized", () => {
    expect(problems({ version: 1, items: [{ type: "service", name: "a", command: "run {{PORT}}" }] }))
      .toContain("items.0.command: {{PORT}} is not declared");
    expect(problems({ version: 1, items: [{ type: "service", name: "a", command: "x", env: { P: "{{TOKEN}}" } }] }))
      .toContain("items.0.env.P: {{TOKEN}} is not declared");
    expect(problems({ ...minimal, placeholders: { port: {} } })).toContain('"port" is not a valid placeholder name');
    expect(problems({ version: 1, placeholders: { PORT: {} }, items: [{ type: "service", name: "a", command: "x", cwd: "{{PORT}}" }] }))
      .toContain("A folder can't contain a placeholder");
  });

  it("leaves shell variables alone", () => {
    expect(parse({ version: 1, items: [{ type: "service", name: "a", command: "echo ${HOME} $PORT" }] }).type).toBe("ok");
  });

  it("checks environment variable names", () => {
    expect(problems({ version: 1, items: [{ type: "service", name: "a", command: "x", env: { "BAD-NAME": "1" } }] }))
      .toContain('"BAD-NAME" is not a valid environment variable name');
  });

  it("rejects waiting for something that does not exist, for itself, or in a loop", () => {
    const item = (name: string, ...after: string[]) => ({ type: "service", name, command: "x", after });

    expect(problems({ version: 1, items: [item("a", "ghost")] })).toContain('items.0.after.0: There is no item named "ghost".');
    expect(problems({ version: 1, items: [item("a", "a")] })).toContain("An item can't wait for itself.");
    expect(problems({ version: 1, items: [item("a", "b"), item("b", "a")] })).toContain("Items wait for each other in a loop: a → b → a.");
  });
});

describe("readProjectFile", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-project-file-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("reports a missing file without failing", async () => {
    await expect(readProjectFile(directory)).resolves.toEqual({ type: "missing" });
  });

  it("reads a file from the folder", async () => {
    await fs.writeFile(path.join(directory, projectFileName), JSON.stringify(minimal));

    const result = await readProjectFile(directory);

    expect(result.type === "ok" && result.file.items[0]?.name).toBe("api");
  });

  it("explains a file with problems", async () => {
    await fs.writeFile(path.join(directory, projectFileName), "{}");

    const result = await readProjectFile(directory);

    expect(result.type === "invalid" && result.message).toContain("sable.json has problems:");
  });
});

import { describe, expect, it } from "vitest";
import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "./config-types.js";
import {
  addItem,
  afterNames,
  dependentsOf,
  findDependencyCycle,
  commandsOf,
  findCommand,
  findItem,
  findService,
  itemsOfKind,
  missingSecretsOf,
  moveService,
  removeItem,
  replaceItem,
  servicesOf,
} from "./workspace-items.js";

function service(id: string): ServiceConfig {
  return { kind: "service", after: [], id, name: id, command: `run ${id}`, cwd: "/p", autoStart: true, env: {} };
}

function command(id: string): CommandConfig {
  return { kind: "command", after: [], id, name: id, command: `run ${id}`, cwd: "/p", env: {} };
}

function workspaceOf(...items: Array<ServiceConfig | CommandConfig>): WorkspaceConfig {
  return { id: "ws", name: "ws", projectDirectory: "/p", items };
}

describe("workspace items", () => {
  const workspace = workspaceOf(service("a"), command("x"), service("b"), command("y"));

  it("lists services and commands in their saved order", () => {
    expect(servicesOf(workspace).map((item) => item.id)).toEqual(["a", "b"]);
    expect(commandsOf(workspace).map((item) => item.id)).toEqual(["x", "y"]);
    expect(itemsOfKind(workspace, "command").map((item) => item.id)).toEqual(["x", "y"]);
  });

  it("finds items by id, regardless of kind unless asked", () => {
    expect(findItem(workspace, "x")?.kind).toBe("command");
    expect(findItem(workspace, "nope")).toBeUndefined();
    expect(findService(workspace, "a")?.id).toBe("a");
    expect(findService(workspace, "x")).toBeUndefined();
    expect(findCommand(workspace, "x")?.id).toBe("x");
    expect(findCommand(undefined, "x")).toBeUndefined();
  });

  it("adds, replaces and removes items without changing the others", () => {
    const added = addItem(workspace, command("z"));
    const replaced = replaceItem(added, { ...command("x"), name: "renamed" });
    const removed = removeItem(replaced, "a");

    expect(added.items.map((item) => item.id)).toEqual(["a", "x", "b", "y", "z"]);
    expect(replaced.items.find((item) => item.id === "x")?.name).toBe("renamed");
    expect(removed.items.map((item) => item.id)).toEqual(["x", "b", "y", "z"]);
  });

  it("moves a service past the neighbouring service and leaves commands in place", () => {
    expect(moveService(workspace, "b", "up").items.map((item) => item.id)).toEqual(["b", "x", "a", "y"]);
    expect(moveService(workspace, "a", "down").items.map((item) => item.id)).toEqual(["b", "x", "a", "y"]);
  });

  it("does not move the first service up, the last down, or an unknown id", () => {
    expect(moveService(workspace, "a", "up")).toBe(workspace);
    expect(moveService(workspace, "b", "down")).toBe(workspace);
    expect(moveService(workspace, "x", "up")).toBe(workspace);
  });

  it("stops items waiting for a removed item", () => {
    const withDependents = workspaceOf(service("a"), { ...service("b"), after: ["a"] }, { ...command("x"), after: ["a", "b"] });
    const removed = removeItem(withDependents, "a");

    expect(removed.items.map((item) => item.after)).toEqual([[], ["b"]]);
    expect(dependentsOf(withDependents, "a").map((item) => item.id)).toEqual(["b", "x"]);
  });

  it("lists the names an item waits for, skipping ids that no longer exist", () => {
    const item = { ...service("c"), after: ["a", "gone", "x"] };

    expect(afterNames(workspace, item)).toEqual(["a", "x"]);
  });
});

describe("findDependencyCycle", () => {
  const node = (id: string, ...after: string[]) => ({ id, name: id.toUpperCase(), after });

  it("finds nothing in a chain, a diamond, or unrelated items", () => {
    expect(findDependencyCycle([node("a"), node("b", "a"), node("c", "b")])).toBeUndefined();
    expect(findDependencyCycle([node("a"), node("b", "a"), node("c", "a"), node("d", "b", "c")])).toBeUndefined();
    expect(findDependencyCycle([node("a"), node("b")])).toBeUndefined();
  });

  it("returns the loop as names, starting and ending at the same one", () => {
    expect(findDependencyCycle([node("a", "c"), node("b", "a"), node("c", "b")])).toEqual(["A", "C", "B", "A"]);
    expect(findDependencyCycle([node("a", "a")])).toEqual(["A", "A"]);
  });

  it("ignores ids that match no item", () => {
    expect(findDependencyCycle([node("a", "ghost")])).toBeUndefined();
  });
});

describe("missingSecretsOf", () => {
  const withEnv = (env: Record<string, string>, secrets?: string[]) => ({ ...service("a"), env, ...(secrets === undefined ? {} : { secrets }) });

  it("lists the secrets that have no value, or an empty one", () => {
    expect(missingSecretsOf(withEnv({ PORT: "3000", TOKEN: "" }, ["TOKEN", "DATABASE_URL", "PORT"]))).toEqual(["TOKEN", "DATABASE_URL"]);
  });

  it("finds nothing missing when all have values, when none are marked, or when the user never decided", () => {
    expect(missingSecretsOf(withEnv({ TOKEN: "abc" }, ["TOKEN"]))).toEqual([]);
    expect(missingSecretsOf(withEnv({}, []))).toEqual([]);
    expect(missingSecretsOf(withEnv({}, undefined))).toEqual([]);
  });

  it("lists a name once", () => {
    expect(missingSecretsOf(withEnv({}, ["A", "A"]))).toEqual(["A"]);
  });
});


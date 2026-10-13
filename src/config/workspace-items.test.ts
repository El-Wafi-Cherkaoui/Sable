import { describe, expect, it } from "vitest";
import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "./config-types.js";
import {
  addItem,
  commandsOf,
  findCommand,
  findItem,
  findService,
  itemsOfKind,
  moveService,
  removeItem,
  replaceItem,
  servicesOf,
} from "./workspace-items.js";

function service(id: string): ServiceConfig {
  return { kind: "service", id, name: id, command: `run ${id}`, cwd: "/p", autoStart: true, env: {} };
}

function command(id: string): CommandConfig {
  return { kind: "command", id, name: id, command: `run ${id}`, cwd: "/p", env: {} };
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
});

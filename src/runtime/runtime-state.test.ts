import { describe, expect, it } from "vitest";
import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import {
  addItemToRuntimeState,
  createRuntimeState,
  getSelectedCommand,
  getSelectedItem,
  getSelectedService,
  moveServiceInRuntimeState,
  removeItemFromRuntimeState,
  runtimeCommands,
  runtimeServices,
  selectNextItem,
  selectPreviousItem,
  setQueueStateInRuntimeState,
  updateItemConfigInRuntimeState,
  updateProcessState,
} from "./runtime-state.js";

describe("runtime state", () => {
  it("creates runtime state from workspace config", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.workspace).toEqual({ id: "ws_ecommerce", name: "ecommerce", projectDirectory: process.cwd() });
    expect(state.items.map((itemState) => itemState.item.name)).toEqual(["backend", "frontend", "build"]);
    expect(state.itemIndexById).toEqual({ svc_backend: 0, svc_frontend: 1, cmd_build: 2 });
    expect(runtimeServices(state).map((serviceState) => serviceState.item.name)).toEqual(["backend", "frontend"]);
    expect(runtimeCommands(state).map((commandState) => commandState.item.name)).toEqual(["build"]);
  });

  it("lists services before commands even when the saved list interleaves them", () => {
    const state = createRuntimeState({
      ...createWorkspace(),
      items: [createCommand("cmd_a"), createService("svc_a"), createCommand("cmd_b"), createService("svc_b")],
    });

    expect(state.items.map((itemState) => itemState.item.id)).toEqual(["svc_a", "svc_b", "cmd_a", "cmd_b"]);
  });

  it("initializes all items as stopped", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.items.map((itemState) => itemState.process)).toEqual([
      { status: "stopped" },
      { status: "stopped" },
      { status: "stopped" },
    ]);
  });

  it("selects the first item, a service when there is one", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.selectedItemIndex).toBe(0);
    expect(getSelectedItem(state)?.item.id).toBe("svc_backend");
    expect(getSelectedService(state)?.item.id).toBe("svc_backend");
    expect(getSelectedCommand(state)).toBeUndefined();
  });

  it("has no selection for empty workspaces", () => {
    const state = createRuntimeState({ ...createWorkspace(), items: [] });

    expect(state.selectedItemIndex).toBeUndefined();
    expect(getSelectedItem(state)).toBeUndefined();
    expect(selectNextItem(state)).toBe(state);
    expect(selectPreviousItem(state)).toBe(state);
  });

  it("walks from the last service into the commands, then wraps to the first service", () => {
    const first = createRuntimeState(createWorkspace());
    const second = selectNextItem(first);
    const command = selectNextItem(second);
    const wrapped = selectNextItem(command);

    expect(getSelectedService(second)?.item.id).toBe("svc_frontend");
    expect(getSelectedCommand(command)?.item.id).toBe("cmd_build");
    expect(wrapped.selectedItemIndex).toBe(0);
  });

  it("wraps previous selection from the first service to the last command", () => {
    const wrapped = selectPreviousItem(createRuntimeState(createWorkspace()));

    expect(getSelectedCommand(wrapped)?.item.id).toBe("cmd_build");
  });

  it("selects a command when a workspace has no services", () => {
    const state = createRuntimeState({ ...createWorkspace(), items: [createCommand("cmd_build")] });

    expect(getSelectedService(state)).toBeUndefined();
    expect(getSelectedCommand(state)?.item.id).toBe("cmd_build");
  });

  it("updates one item's process state by id without mutating the original state", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = updateProcessState(initialState, "svc_frontend", { status: "running", pid: 1234 });

    expect(nextState).not.toBe(initialState);
    expect(nextState.items[0]?.process).toEqual({ status: "stopped" });
    expect(nextState.items[1]?.process).toEqual({ status: "running", pid: 1234 });
    expect(initialState.items[1]?.process).toEqual({ status: "stopped" });
  });

  it("ignores unknown ids safely", () => {
    const initialState = createRuntimeState(createWorkspace());

    expect(updateProcessState(initialState, "missing", { status: "running", pid: 1234 })).toBe(initialState);
    expect(removeItemFromRuntimeState(initialState, "missing")).toBe(initialState);
    expect(updateItemConfigInRuntimeState(initialState, createService("missing"))).toBe(initialState);
  });

  it("adds a service after the last service and selects it", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = addItemToRuntimeState(initialState, createService("svc_api"));

    expect(nextState.items.map((itemState) => itemState.item.id)).toEqual(["svc_backend", "svc_frontend", "svc_api", "cmd_build"]);
    expect(nextState.selectedItemIndex).toBe(2);
    expect(nextState.itemIndexById).toEqual({ svc_backend: 0, svc_frontend: 1, svc_api: 2, cmd_build: 3 });
  });

  it("adds a command at the end and selects it", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = addItemToRuntimeState(initialState, createCommand("cmd_lint"));

    expect(nextState.items.map((itemState) => itemState.item.id)).toEqual(["svc_backend", "svc_frontend", "cmd_build", "cmd_lint"]);
    expect(getSelectedCommand(nextState)?.item.id).toBe("cmd_lint");
  });

  it("adds the first item to an empty workspace", () => {
    const nextState = addItemToRuntimeState(createRuntimeState({ ...createWorkspace(), items: [] }), createCommand("cmd_build"));

    expect(nextState.itemIndexById).toEqual({ cmd_build: 0 });
    expect(nextState.selectedItemIndex).toBe(0);
  });

  it("does not add an item twice", () => {
    const initialState = createRuntimeState(createWorkspace());

    expect(addItemToRuntimeState(initialState, createService("svc_backend"))).toBe(initialState);
  });

  it("updates an item's config without changing its process state", () => {
    const initialState = updateProcessState(createRuntimeState(createWorkspace()), "svc_backend", {
      status: "failed",
      error: new Error("boom"),
    });
    const nextState = updateItemConfigInRuntimeState(initialState, {
      ...initialState.items[0]!.item,
      command: "npm run dev:new",
    });

    expect(nextState.items[0]?.item.command).toBe("npm run dev:new");
    expect(nextState.items[0]?.process.status).toBe("failed");
  });

  it("removes a service and keeps the selection in range", () => {
    const initialState = selectNextItem(createRuntimeState(createWorkspace()));
    const nextState = removeItemFromRuntimeState(initialState, "svc_frontend");

    expect(nextState.items.map((itemState) => itemState.item.id)).toEqual(["svc_backend", "cmd_build"]);
    expect(getSelectedService(nextState)?.item.id).toBe("svc_backend");
    expect(nextState.itemIndexById).toEqual({ svc_backend: 0, cmd_build: 1 });
  });

  it("selects the first command after the last service is removed", () => {
    const state = createRuntimeState({ ...createWorkspace(), items: [createService("svc_a"), createCommand("cmd_a"), createCommand("cmd_b")] });
    const nextState = removeItemFromRuntimeState(state, "svc_a");

    expect(getSelectedCommand(nextState)?.item.id).toBe("cmd_a");
  });

  it("goes back to the first service after a command is removed", () => {
    const state = selectPreviousItem(createRuntimeState(createWorkspace()));
    const nextState = removeItemFromRuntimeState(state, "cmd_build");

    expect(getSelectedService(nextState)?.item.id).toBe("svc_backend");
  });

  it("leaves no selection when the last item is removed", () => {
    const state = createRuntimeState({ ...createWorkspace(), items: [createCommand("cmd_build")] });
    const nextState = removeItemFromRuntimeState(state, "cmd_build");

    expect(nextState.items).toEqual([]);
    expect(nextState.selectedItemIndex).toBeUndefined();
  });

  it("moves a service and keeps it selected", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = moveServiceInRuntimeState(initialState, "svc_frontend", "up");

    expect(nextState.items.map((itemState) => itemState.item.id)).toEqual(["svc_frontend", "svc_backend", "cmd_build"]);
    expect(nextState.selectedItemIndex).toBe(0);
    expect(nextState.itemIndexById).toEqual({ svc_frontend: 0, svc_backend: 1, cmd_build: 2 });
  });

  it("does not move a service beyond the services, into the commands, or move a command", () => {
    const initialState = createRuntimeState(createWorkspace());

    expect(moveServiceInRuntimeState(initialState, "svc_backend", "up")).toBe(initialState);
    expect(moveServiceInRuntimeState(initialState, "svc_frontend", "down")).toBe(initialState);
    expect(moveServiceInRuntimeState(initialState, "cmd_build", "up")).toBe(initialState);
  });

  it("marks an item as waiting or skipped and clears the mark without touching the others", () => {
    const initialState = createRuntimeState(createWorkspace());
    const waiting = setQueueStateInRuntimeState(initialState, "svc_frontend", { status: "waiting", for: ["backend"] });

    expect(waiting.items[1]?.queue).toEqual({ status: "waiting", for: ["backend"] });
    expect(waiting.items[0]?.queue).toBeUndefined();
    expect(initialState.items[1]?.queue).toBeUndefined();

    const cleared = setQueueStateInRuntimeState(waiting, "svc_frontend", undefined);

    expect("queue" in cleared.items[1]!).toBe(false);
    expect(setQueueStateInRuntimeState(initialState, "missing", { status: "skipped", reason: "x" })).toBe(initialState);
  });

  it("stops items waiting for a removed item", () => {
    const state = createRuntimeState({
      ...createWorkspace(),
      items: [createService("svc_a"), { ...createService("svc_b"), after: ["svc_a"] }, { ...createCommand("cmd_c"), after: ["svc_a", "svc_b"] }],
    });
    const nextState = removeItemFromRuntimeState(state, "svc_a");

    expect(nextState.items.map((itemState) => itemState.item.after)).toEqual([[], ["svc_b"]]);
  });
});

function createWorkspace(): WorkspaceConfig {
  return {
    id: "ws_ecommerce",
    name: "ecommerce",
    projectDirectory: process.cwd(),
    items: [
      { ...createService("svc_backend"), name: "backend", cwd: "./backend" },
      { ...createService("svc_frontend"), name: "frontend", cwd: "./frontend" },
      { ...createCommand("cmd_build"), name: "build" },
    ],
  };
}

function createService(id: string): ServiceConfig {
  return { kind: "service", after: [], id, name: id, command: "npm run dev", cwd: ".", autoStart: true, env: {} };
}

function createCommand(id: string): CommandConfig {
  return { kind: "command", after: [], id, name: id, command: "npm run build", cwd: process.cwd(), env: {} };
}

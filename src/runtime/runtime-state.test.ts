import { describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import {
  createRuntimeState,
  getSelectedService,
  selectNextService,
  selectPreviousService,
  updateServiceProcessState,
  addServiceToRuntimeState,
  updateServiceConfigInRuntimeState,
  removeServiceFromRuntimeState,
} from "./runtime-state.js";

describe("runtime state", () => {
  it("creates runtime state from workspace config", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.workspace).toEqual({ id: "ws_ecommerce", name: "ecommerce" });
    expect(state.services).toHaveLength(2);
    expect(state.services.map((serviceState) => serviceState.service.name)).toEqual([
      "backend",
      "frontend",
    ]);
    expect(state.serviceIndexById).toEqual({
      svc_backend: 0,
      svc_frontend: 1,
    });
  });

  it("initializes all services as stopped", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.services.map((serviceState) => serviceState.process)).toEqual([
      { status: "stopped" },
      { status: "stopped" },
    ]);
  });

  it("selects the first service when services exist", () => {
    const state = createRuntimeState(createWorkspace());

    expect(state.selectedServiceIndex).toBe(0);
    expect(getSelectedService(state)?.service.id).toBe("svc_backend");
  });

  it("has no selected service for empty workspaces", () => {
    const state = createRuntimeState({
      id: "ws_empty",
      name: "empty",
      services: [],
    });

    expect(state.selectedServiceIndex).toBeUndefined();
    expect(getSelectedService(state)).toBeUndefined();
    expect(selectNextService(state)).toBe(state);
    expect(selectPreviousService(state)).toBe(state);
  });

  it("wraps next selection from the last service to the first", () => {
    const initialState = createRuntimeState(createWorkspace());
    const lastSelectedState = selectNextService(initialState);
    const wrappedState = selectNextService(lastSelectedState);

    expect(lastSelectedState.selectedServiceIndex).toBe(1);
    expect(getSelectedService(lastSelectedState)?.service.id).toBe("svc_frontend");
    expect(wrappedState.selectedServiceIndex).toBe(0);
    expect(getSelectedService(wrappedState)?.service.id).toBe("svc_backend");
  });

  it("wraps previous selection from the first service to the last", () => {
    const initialState = createRuntimeState(createWorkspace());
    const wrappedState = selectPreviousService(initialState);

    expect(wrappedState.selectedServiceIndex).toBe(1);
    expect(getSelectedService(wrappedState)?.service.id).toBe("svc_frontend");
  });

  it("updates one service process state by id without mutating the original state", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = updateServiceProcessState(initialState, "svc_frontend", {
      status: "running",
      pid: 1234,
    });

    expect(nextState).not.toBe(initialState);
    expect(nextState.services[0]?.process).toEqual({ status: "stopped" });
    expect(nextState.services[1]?.process).toEqual({
      status: "running",
      pid: 1234,
    });
    expect(initialState.services[1]?.process).toEqual({ status: "stopped" });
  });

  it("adds a service and selects it", () => {
    const initialState = createRuntimeState({
      id: "ws_empty",
      name: "empty",
      projectDirectory: process.cwd(),
      services: [],
    });
    const nextState = addServiceToRuntimeState(initialState, {
      id: "svc_api",
      name: "api",
      command: "npm run dev",
      cwd: ".",
      autoStart: true,
      env: {},
    });

    expect(nextState.services.map((serviceState) => serviceState.service.id)).toEqual(["svc_api"]);
    expect(nextState.selectedServiceIndex).toBe(0);
    expect(nextState.serviceIndexById).toEqual({ svc_api: 0 });
  });

  it("updates service config without changing process state", () => {
    const initialState = updateServiceProcessState(createRuntimeState(createWorkspace()), "svc_backend", {
      status: "failed",
      error: new Error("boom"),
    });
    const nextState = updateServiceConfigInRuntimeState(initialState, {
      ...initialState.services[0]!.service,
      command: "npm run dev:new",
    });

    expect(nextState.services[0]?.service.command).toBe("npm run dev:new");
    expect(nextState.services[0]?.process.status).toBe("failed");
  });

  it("removes a service and keeps selection in range", () => {
    const initialState = selectPreviousService(createRuntimeState(createWorkspace()));
    const nextState = removeServiceFromRuntimeState(initialState, "svc_frontend");

    expect(nextState.services.map((serviceState) => serviceState.service.id)).toEqual(["svc_backend"]);
    expect(nextState.selectedServiceIndex).toBe(0);
    expect(nextState.serviceIndexById).toEqual({ svc_backend: 0 });
  });

  it("ignores unknown service ids safely", () => {
    const initialState = createRuntimeState(createWorkspace());
    const nextState = updateServiceProcessState(initialState, "missing", {
      status: "running",
      pid: 1234,
    });

    expect(nextState).toBe(initialState);
  });
});

function createWorkspace(): WorkspaceConfig {
  return {
    id: "ws_ecommerce",
    name: "ecommerce",
    projectDirectory: process.cwd(),
    services: [
      {
        id: "svc_backend",
        name: "backend",
        command: "npm run dev",
        cwd: "./backend",
        autoStart: true,
        env: {},
      },
      {
        id: "svc_frontend",
        name: "frontend",
        command: "npm run dev",
        cwd: "./frontend",
        autoStart: true,
        env: {},
      },
    ],
  };
}

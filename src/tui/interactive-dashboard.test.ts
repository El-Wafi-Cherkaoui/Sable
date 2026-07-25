import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { createRuntimeState } from "../runtime/runtime-state.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { runInteractiveDashboard } from "./interactive-dashboard.js";

describe("runInteractiveDashboard", () => {
  it("renders, handles selection keys, and quits", async () => {
    let state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => {
        state = { ...state, selectedServiceIndex: 1 };
        return state;
      }),
      selectPreviousService: vi.fn(() => {
        state = { ...state, selectedServiceIndex: 0 };
        return state;
      }),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
    };
    const keyInput = createKeyInput([
      { sequence: "j" },
      { sequence: "k" },
      { sequence: "q" },
    ]);
    const clear = vi.fn();
    const write = vi.fn();
    const render = vi.fn((runtimeState: RuntimeWorkspaceState) =>
      `selected:${runtimeState.selectedServiceIndex}`,
    );

    await runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear, write },
      render,
    });

    expect(controller.selectNextService).toHaveBeenCalledOnce();
    expect(controller.selectPreviousService).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenNthCalledWith(1, "selected:0\n");
    expect(write).toHaveBeenNthCalledWith(2, "selected:1\n");
    expect(write).toHaveBeenNthCalledWith(3, "selected:0\n");
  });

  it("ignores unknown keys without re-rendering", async () => {
    const state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => state),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
    };
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "x" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(controller.selectNextService).not.toHaveBeenCalled();
    expect(controller.selectPreviousService).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs selected service actions and re-renders after each action", async () => {
    const state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => state),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
    };
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { sequence: "S" },
        { sequence: "s" },
        { sequence: "r" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(controller.startSelectedService).toHaveBeenCalledOnce();
    expect(controller.stopSelectedService).toHaveBeenCalledOnce();
    expect(controller.restartSelectedService).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(4);
  });
});

function createKeyInput(keys: Array<{ sequence?: string; name?: string }>): KeyInput {
  return {
    async readKey() {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key was provided for this test.");
      }

      return key;
    },
    close() {},
  };
}

function createState(): RuntimeWorkspaceState {
  return createRuntimeState({
    id: "ws_ecommerce",
    name: "ecommerce",
    services: [
      {
        id: "svc_backend",
        name: "backend",
        command: "npm run dev",
        cwd: ".",
        autoStart: true,
        env: {},
      },
      {
        id: "svc_frontend",
        name: "frontend",
        command: "npm run dev",
        cwd: ".",
        autoStart: true,
        env: {},
      },
    ],
  });
}

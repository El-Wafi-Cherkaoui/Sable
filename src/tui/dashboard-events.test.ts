import { describe, expect, it } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { createDashboardEventReader } from "./dashboard-events.js";

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

// A key input whose read only resolves when the test says so.
function createManualKeyInput(): { keyInput: KeyInput; press(key: { sequence: string }): void; reads(): number } {
  const resolvers: Array<(key: { sequence: string }) => void> = [];

  return {
    keyInput: {
      readKey: () => new Promise((resolve) => resolvers.push(resolve)),
      close() {},
    },
    press: (key) => resolvers.shift()?.(key),
    reads: () => resolvers.length,
  };
}

describe("createDashboardEventReader", () => {
  it("returns the next key", async () => {
    const reader = createDashboardEventReader(createKeyInput([{ sequence: "a" }]), undefined);

    expect(await reader.readKeyOrAbort()).toEqual({ type: "key", keypress: { sequence: "a" } });
  });

  it("returns a refresh when no key arrives in time, then still gets the key", async () => {
    const { keyInput, press, reads } = createManualKeyInput();
    const reader = createDashboardEventReader(keyInput, undefined);

    expect(await reader.readKeyOrRefresh(5)).toEqual({ type: "refresh" });
    expect(reads()).toBe(1);

    const next = reader.readKeyOrRefresh(1000);

    press({ sequence: "x" });

    expect(await next).toEqual({ type: "key", keypress: { sequence: "x" } });
    expect(reads()).toBe(0);
  });

  it("reports an abort, even when it happened before reading", async () => {
    const { keyInput } = createManualKeyInput();
    const controller = new AbortController();
    const reader = createDashboardEventReader(keyInput, controller.signal);

    controller.abort();

    expect(await reader.readKeyOrAbort()).toEqual({ type: "abort" });
    expect(await reader.readKeyOrRefresh(1000)).toEqual({ type: "abort" });
  });

  it("reports an abort that arrives while waiting", async () => {
    const { keyInput } = createManualKeyInput();
    const controller = new AbortController();
    const reader = createDashboardEventReader(keyInput, controller.signal);
    const next = reader.readKeyOrAbort();

    controller.abort();

    expect(await next).toEqual({ type: "abort" });
  });
});

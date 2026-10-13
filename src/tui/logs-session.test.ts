import { describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { createLogsSession } from "./logs-session.js";

function makeLogs(count: number, lineAt: (index: number) => string = (index) => `line ${index}`): ServiceLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    stream: "stdout" as const,
    line: lineAt(index),
    timestamp: new Date(0),
  }));
}

describe("createLogsSession", () => {
  it("opens at the bottom, following the tail", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(20), visibleLineCount: 5 });

    session.open();

    expect(session.viewProps()).toMatchObject({ scrollOffset: 15, following: true, visibleLineCount: 5 });
  });

  it("stops following when scrolling up and follows again at the bottom", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(20), visibleLineCount: 5 });

    session.open();
    session.handleKey({ name: "up" });
    expect(session.viewProps()).toMatchObject({ scrollOffset: 14, following: false });

    session.handleKey({ sequence: "G" });
    expect(session.viewProps()).toMatchObject({ scrollOffset: 15, following: true });
  });

  it("reveals the first lines gradually until a key is pressed", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(30), visibleLineCount: 9 });

    session.open();
    expect(session.isRevealActive()).toBe(true);

    session.handleKey({ sequence: "g" });
    expect(session.isRevealActive()).toBe(false);
  });

  it("clears an active search with Esc before leaving the logs", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(10), visibleLineCount: 5 });

    session.open();
    expect(session.handleKey({ sequence: "/" })).toBe("render");
    expect(session.handleKey({ sequence: "7" })).toBe("render");
    expect(session.handleKey({ name: "return", sequence: "\r" })).toBe("render");
    expect(session.viewProps().search).toEqual({ query: "7", editing: false });
    expect(session.viewProps().highlightIndex).toBe(7);

    expect(session.handleKey({ name: "escape" })).toBe("render");
    expect(session.viewProps().search).toBeUndefined();
    expect(session.handleKey({ name: "escape" })).toBe("back");
  });

  it("reports when there are no errors to jump to", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(5), visibleLineCount: 5 });

    session.open();
    session.handleKey({ sequence: "e" });

    expect(session.viewProps().message).toBe("No errors in this output.");
  });

  it("asks the dashboard to open help and ignores unknown keys", () => {
    const session = createLogsSession({ getLogs: () => makeLogs(5), visibleLineCount: 5 });

    session.open();

    expect(session.handleKey({ sequence: "?" })).toBe("openHelp");
    expect(session.handleKey({ sequence: "~" })).toBe("none");
  });

  it("keeps following the tail as new lines arrive", () => {
    let logs = makeLogs(10);
    const session = createLogsSession({ getLogs: () => logs, visibleLineCount: 5 });

    session.open();
    logs = makeLogs(14);
    session.refresh();

    expect(session.viewProps().scrollOffset).toBe(9);
  });
});

import { describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { createRuntimeState } from "../runtime/runtime-state.js";
import { clampScrollOffset, maxScrollOffset, renderLogsView } from "./logs-view.js";

describe("renderLogsView", () => {
  it("renders selected service logs with stream labels", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [
        createLog("stdout", "server ready"),
        createLog("stderr", "warning"),
      ],
      scrollOffset: 0,
      visibleLineCount: 10,
      viewportColumns: 60,
    });

    expect(rendered).toContain("Logs");
    expect(rendered).toContain("workspace ecommerce");
    expect(rendered).toContain("range     lines 1-2 of 2");
    expect(rendered).toContain(`┌${"─".repeat(54)}┐`);
    expect(rendered).toContain("│ stdout server ready");
    expect(rendered).toContain("│ stderr warning");
    expect(rendered).toContain(`└${"─".repeat(54)}┘`);
    expect(rendered).toContain("j/k scroll  Esc back  ? help  q quit");
  });

  it("keeps the log box width stable and truncates long lines", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [createLog("stdout", "this is a very long log line that should not wrap the viewport")],
      scrollOffset: 0,
      visibleLineCount: 1,
      viewportColumns: 52,
    });

    expect(rendered).toContain(`┌${"─".repeat(46)}┐`);
    expect(rendered).toContain("stdout this is a very long log line that ...");
  });

  it("renders system lifecycle entries with logs", () => {
    expect(
      renderLogsView({
        state: createState(),
        logs: [createLog("system", "service stopped")],
        scrollOffset: 0,
        visibleLineCount: 10,
      }),
    ).toContain("system service stopped");
  });

  it("can render logs with restrained color", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [createLog("stderr", "warning")],
      scrollOffset: 0,
      visibleLineCount: 10,
      color: true,
    });

    expect(rendered).toContain("\x1b[1mLogs\x1b[22m");
    expect(rendered).toContain("\x1b[31mstderr\x1b[39m warning");
  });

  it("renders a visible slice based on scroll offset", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [createLog("stdout", "one"), createLog("stdout", "two"), createLog("stdout", "three")],
      scrollOffset: 1,
      visibleLineCount: 2,
    });

    expect(rendered).toContain("stdout two");
    expect(rendered).toContain("stdout three");
    expect(
      renderLogsView({
        state: createState(),
        logs: [createLog("stdout", "one"), createLog("stdout", "two"), createLog("stdout", "three")],
        scrollOffset: 1,
        visibleLineCount: 2,
      }),
    ).toContain("lines 2-3 of 3");
  });

  it("renders an empty state", () => {
    expect(
      renderLogsView({
        state: createState(),
        logs: [],
        scrollOffset: 0,
        visibleLineCount: 10,
      }),
    ).toContain("No logs yet.");
    expect(
      renderLogsView({
        state: createState(),
        logs: [],
        scrollOffset: 0,
        visibleLineCount: 10,
      }),
    ).toContain("0 lines");
    expect(
      renderLogsView({
        state: createState(),
        logs: [],
        scrollOffset: 0,
        visibleLineCount: 10,
      }),
    ).toContain("Start the service or wait for output.");
  });
});

describe("log scrolling", () => {
  it("clamps scroll offsets", () => {
    expect(clampScrollOffset(-1, 10, 3)).toBe(0);
    expect(clampScrollOffset(99, 10, 3)).toBe(7);
    expect(clampScrollOffset(2, 10, 3)).toBe(2);
  });

  it("calculates max scroll offset", () => {
    expect(maxScrollOffset(10, 3)).toBe(7);
    expect(maxScrollOffset(2, 3)).toBe(0);
  });
});

function createLog(stream: ServiceLogEntry["stream"], line: string): ServiceLogEntry {
  return {
    stream,
    line,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function createState() {
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
    ],
  });
}

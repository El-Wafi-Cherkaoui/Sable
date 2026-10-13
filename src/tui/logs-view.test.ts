import { describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { createRuntimeState, updateProcessState } from "../runtime/runtime-state.js";
import {
  bottomScrollOffset,
  clampScrollOffset,
  errorIndexes,
  findMatches,
  nextIndex,
  renderLogsView as renderLogsViewAt,
} from "./logs-view.js";
import { formatDateTime, needsDates } from "./log-lines.js";
import { visibleLength } from "./width.js";

// The test lines are all from 2026-01-01, so that is "today" unless a test says otherwise.
const jan1 = new Date("2026-01-01T12:00:00");
const renderLogsView = (options: Parameters<typeof renderLogsViewAt>[0]) => renderLogsViewAt({ now: jan1, ...options });

describe("renderLogsView", () => {
  it("renders a one-line header, timestamped lines, an stderr bar, and run dividers", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [
        createLog("system", "service started", "10:41:58"),
        createLog("stdout", "server ready", "10:42:01"),
        createLog("stderr", "Error: ECONNREFUSED", "10:42:03"),
      ],
      scrollOffset: 0,
      visibleLineCount: 4,
      viewportColumns: 50,
    });

    expect(rendered).toBe(
      [
        "api · ecommerce · ● running · 3 lines · following",
        "",
        "  ── service started · 10:41:58 ─────────────────",
        "  10:42:01   server ready",
        "  10:42:03 ▌ Error: ECONNREFUSED",
        "",
        "",
        "",
        "[/] search  [e] next error  [w] wrap  [Esc] back",
      ].join("\n"),
    );
  });

  it("says where you are when not following the bottom", () => {
    const logs = Array.from({ length: 1500 }, (_, index) => createLog("stdout", `line ${index}`));
    const rendered = renderLogsView({ state: createState(), logs, scrollOffset: 9, following: false, visibleLineCount: 3 });

    expect(rendered.split("\n")[0]).toBe("api · ecommerce · ● running · 1,500 lines · from line 10");
  });

  it("keeps the body height fixed so the footer does not jump", () => {
    const short = renderLogsView({ state: createState(), logs: [createLog("stdout", "one")], scrollOffset: 0, visibleLineCount: 5 });
    const full = renderLogsView({
      state: createState(),
      logs: Array.from({ length: 9 }, (_, index) => createLog("stdout", `${index}`)),
      scrollOffset: 0,
      visibleLineCount: 5,
    });

    expect(short.split("\n")).toHaveLength(full.split("\n").length);
  });

  describe("child colors", () => {
    const colored = createLog("stdout", "\x1b[32mready\x1b[0m in 12ms");

    it("keeps them on stdout rows when color is on", () => {
      const rendered = renderLogsView({ state: createState(), logs: [colored], scrollOffset: 0, visibleLineCount: 1, color: true });

      expect(rendered).toContain("\x1b[32mready\x1b[0m in 12ms");
    });

    it("removes them when color is off", () => {
      const rendered = renderLogsView({ state: createState(), logs: [colored], scrollOffset: 0, visibleLineCount: 1 });

      expect(rendered).not.toContain("\x1b[32m");
      expect(rendered).toContain("ready in 12ms");
    });

    it("never cuts a color code when wrapping", () => {
      const logs = [createLog("stdout", `\x1b[31m${"x".repeat(60)}\x1b[0m`)];
      const rendered = renderLogsView({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 4, viewportColumns: 40, wrap: true, color: true });
      const body = rendered.split("\n").slice(2, 4);

      for (const row of body) {
        expect(row.match(/\x1b\[31m/g)).toHaveLength(1);
        expect(row.endsWith("\x1b[0m") || row.includes("\x1b[0m")).toBe(true);
      }
    });

    it("finds search matches in the visible text only", () => {
      const logs = [createLog("stdout", "\x1b[31mred\x1b[0m"), createLog("stdout", "plain 31")];

      expect(findMatches(logs, "31")).toEqual([1]);
      expect(findMatches(logs, "red")).toEqual([0]);
    });
  });

  it("truncates long lines to the terminal width and scrolls them sideways", () => {
    const logs = [createLog("stdout", "abcdefghijklmnopqrstuvwxyz".repeat(4))];
    const rendered = renderLogsView({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 1, viewportColumns: 40 });
    const shifted = renderLogsView({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 1, viewportColumns: 40, horizontalScrollOffset: 8 });

    expect(visibleLength(rendered.split("\n")[2]!)).toBeLessThan(40);
    expect(rendered).toContain("  abcdefghijklmnopqrstu");
    expect(shifted).toContain("  ijklmnopqrstuvwxyzab");
  });

  it("wraps long lines under the text column when wrap is on", () => {
    const logs = [createLog("stdout", "x".repeat(40), "10:00:00")];
    const lines = renderLogsView({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 3, viewportColumns: 34, wrap: true }).split("\n");

    expect(lines[2]).toBe(`  10:00:00   ${"x".repeat(20)}`);
    expect(lines[3]).toBe(`${" ".repeat(13)}${"x".repeat(20)}`);
  });

  it("offers every logs key on a wide terminal, with the wrap label matching the mode", () => {
    const footer = (wrap: boolean) => renderLogsView({ state: createState(), logs: [], scrollOffset: 0, visibleLineCount: 1, viewportColumns: 100, wrap }).split("\n").at(-1);

    expect(footer(false)).toBe("[/] search  [e] next error  [w] wrap  [G] follow  [↑↓] scroll  [Esc] back");
    expect(footer(true)).toContain("[w] no wrap");
  });

  it("marks the highlighted line and shows search progress", () => {
    const logs = [createLog("stdout", "GET /health"), createLog("stdout", "GET /users"), createLog("stdout", "POST /users")];
    const rendered = renderLogsView({
      state: createState(),
      logs,
      scrollOffset: 0,
      visibleLineCount: 3,
      search: { query: "users", editing: false },
      highlightIndex: 2,
    });
    const lines = rendered.split("\n");

    expect(lines[4]).toMatch(/^> \d\d:\d\d:\d\d {3}POST \/users$/);
    expect(lines.at(-2)).toBe("/users  match 2 of 2");
    expect(lines.at(-1)).toBe("[n] next  [N] previous  [/] new search  [Esc] clear");
  });

  it("shows the query being typed and the keys to finish it", () => {
    const lines = renderLogsView({ state: createState(), logs: [], scrollOffset: 0, visibleLineCount: 1, search: { query: "err", editing: true } }).split("\n");

    expect(lines.at(-2)).toBe("/err▏");
    expect(lines.at(-1)).toBe("[Enter] find  [Esc] cancel");
  });

  it("highlights matches and stderr in color", () => {
    const rendered = renderLogsView({
      state: createState(),
      logs: [createLog("stderr", "boom here")],
      scrollOffset: 0,
      visibleLineCount: 1,
      search: { query: "boom", editing: false },
      color: true,
    });

    expect(rendered).toContain("\x1b[7mboom\x1b[27m");
    expect(rendered).toContain("\x1b[31m▌\x1b[39m");
  });

  it("reveals only part of the visible lines during the opening animation", () => {
    const logs = Array.from({ length: 5 }, (_, index) => createLog("stdout", `line ${index}`));
    const rendered = renderLogsView({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 5, revealLineCount: 2 });

    expect(rendered).toContain("line 1");
    expect(rendered).not.toContain("line 2");
  });

  it("explains how to get output when there is none", () => {
    expect(renderLogsView({ state: createState(), logs: [], scrollOffset: 0, visibleLineCount: 3 }))
      .toContain("No output yet. Start it with s, or wait for it to print something.");
  });

  it("shows a message in place of the search line", () => {
    const lines = renderLogsView({ state: createState(), logs: [], scrollOffset: 0, visibleLineCount: 1, message: "No errors in this output." }).split("\n");

    expect(lines.at(-2)).toBe("› No errors in this output.");
  });

  it("shows why the item failed when there is no message and no search, and lets those take over", () => {
    const hint = "A port it needs is already in use here.";
    const base = { state: createState(), logs: [], scrollOffset: 0, visibleLineCount: 1, hint };

    expect(renderLogsView(base).split("\n").at(-2)).toBe(`! ${hint}`);
    expect(renderLogsView({ ...base, message: "No errors in this output." }).split("\n").at(-2)).toBe("› No errors in this output.");
    expect(renderLogsView({ ...base, search: { query: "err", editing: true } }).split("\n").at(-2)).toBe("/err▏");
  });
});

describe("log scrolling", () => {
  const logs = Array.from({ length: 10 }, (_, index) => createLog("stdout", index === 7 ? "y".repeat(50) : `${index}`));

  it("finds the bottom offset without wrapping", () => {
    expect(bottomScrollOffset(logs, { height: 4, width: 33, wrap: false })).toBe(6);
    expect(bottomScrollOffset(logs.slice(0, 2), { height: 4, width: 33, wrap: false })).toBe(0);
  });

  it("accounts for wrapped lines taking more rows", () => {
    // Width 33 leaves 20 columns of text, so the 50-character line needs 3 rows.
    expect(bottomScrollOffset(logs, { height: 4, width: 33, wrap: true })).toBe(8);
    expect(bottomScrollOffset(logs, { height: 6, width: 33, wrap: true })).toBe(6);
  });

  it("clamps offsets between the top and the bottom", () => {
    expect(clampScrollOffset(-3, logs, { height: 4, width: 33, wrap: false })).toBe(0);
    expect(clampScrollOffset(99, logs, { height: 4, width: 33, wrap: false })).toBe(6);
  });
});

describe("finding lines", () => {
  const logs = [
    createLog("system", "service started"),
    createLog("stdout", "GET /Users"),
    createLog("stderr", "boom"),
    createLog("stdout", "get /users again"),
    createLog("stderr", "boom again"),
  ];

  it("matches case-insensitively and skips Sable's own lines", () => {
    expect(findMatches(logs, "users")).toEqual([1, 3]);
    expect(findMatches(logs, "started")).toEqual([]);
    expect(findMatches(logs, "")).toEqual([]);
  });

  it("lists stderr lines as errors", () => {
    expect(errorIndexes(logs)).toEqual([2, 4]);
  });

  it("moves to the next or previous candidate and wraps around", () => {
    expect(nextIndex([2, 4], undefined, 1)).toBe(2);
    expect(nextIndex([2, 4], undefined, -1)).toBe(4);
    expect(nextIndex([2, 4], 2, 1)).toBe(4);
    expect(nextIndex([2, 4], 4, 1)).toBe(2);
    expect(nextIndex([2, 4], 2, -1)).toBe(4);
    expect(nextIndex([], 0, 1)).toBeUndefined();
  });
});

function createState() {
  const state = createRuntimeState({
    id: "ws_ecommerce",
    name: "ecommerce",
    projectDirectory: "/srv/shop",
    items: [{ kind: "service", after: [], id: "svc_api", name: "api", command: "npm run dev", cwd: ".", autoStart: true, env: {} }],
  });

  return updateProcessState(state, "svc_api", { status: "running", pid: 1 });
}

function createLog(stream: ServiceLogEntry["stream"], line: string, time = "10:00:00"): ServiceLogEntry {
  return { stream, line, timestamp: new Date(`2026-01-01T${time}`) };
}

describe("dates on old lines", () => {
  const at = (stamp: string, line: string, stream: ServiceLogEntry["stream"] = "stdout"): ServiceLogEntry => ({ stream, line, timestamp: new Date(stamp), });
  const earlier = at("2026-01-01T23:58:10", "yesterday's output");
  const later = at("2026-01-02T00:05:30", "today's output");
  const render = (logs: ServiceLogEntry[], extra: Partial<Parameters<typeof renderLogsViewAt>[0]> = {}) =>
    renderLogsViewAt({ state: createState(), logs, scrollOffset: 0, visibleLineCount: 6, now: new Date("2026-01-02T09:00:00"), ...extra });

  it("shows the month and day on every line once the log has lines from an earlier day", () => {
    const lines = render([earlier, later]).split("\n");

    expect(lines).toContain("  01-01 23:58:10   yesterday's output");
    expect(lines).toContain("  01-02 00:05:30   today's output");
  });

  it("keeps the plain time while every line is from today", () => {
    const lines = render([later, at("2026-01-02T00:06:00", "more")]).split("\n");

    expect(lines).toContain("  00:05:30   today's output");
    expect(lines.join("\n")).not.toContain("01-02");
  });

  it("dates the run dividers too", () => {
    const rendered = render([at("2026-01-01T23:58:10", "service started", "system"), later]);

    expect(rendered).toContain("── service started · 01-01 23:58:10 ");
  });

  it("wraps under the wider text column when dates are shown", () => {
    const rendered = render([earlier, at("2026-01-02T00:05:30", "x".repeat(60))], { viewportColumns: 40, wrap: true, visibleLineCount: 8 });
    const rows = rendered.split("\n");
    const first = rows.findIndex((row) => row.includes("00:05:30"));

    expect(rows[first + 1]?.startsWith(" ".repeat(19))).toBe(true);
    expect(rows.every((row) => visibleLength(row) <= 40)).toBe(true);
  });

  it("decides from the oldest line, using the local calendar day", () => {
    const now = new Date("2026-01-02T09:00:00");

    expect(needsDates([], now)).toBe(false);
    expect(needsDates([later], now)).toBe(false);
    expect(needsDates([earlier, later], now)).toBe(true);
    expect(formatDateTime(new Date("2026-03-04T05:06:07"))).toBe("03-04 05:06:07");
  });
});


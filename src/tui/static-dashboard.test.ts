import { describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderStaticDashboard } from "./static-dashboard.js";
import { stripAnsi, visibleLength } from "./width.js";

describe("renderStaticDashboard", () => {
  it("renders a header, sections, status symbols, and a selection marker", () => {
    expect(renderStaticDashboard(createState())).toBe(
      [
        "ecommerce · /srv/shop · 1 of 3 running",
        "",
        "SERVICES",
        "> backend         ● running",
        "  frontend        ○ stopped",
        "  worker          ✕ failed: spawn ENOENT",
        "",
        "COMMANDS",
        "  migrate         ✓ done",
        "",
        "",
        "[s] stop  [r] restart  [Enter] logs  [e] edit  [?] help  [S] start all  [q] quit",
      ].join("\n"),
    );
  });

  it("explains services and commands when the workspace is empty", () => {
    const rendered = renderStaticDashboard({
      ...createState(),
      items: [],
      itemIndexById: {},
      selectedItemIndex: undefined,
    });

    expect(rendered).toContain("No services or commands yet.");
    expect(rendered).toContain("Services keep running, like a dev server or a worker.");
    expect(rendered).toContain("Commands run once, like a migration or a build.");
    expect(rendered.split("\n").at(-1)).toBe("[a] add  [?] help  [q] quit");
    expect(rendered.split("\n")[0]).toBe("ecommerce · /srv/shop");
  });

  it("only shows real messages in the status line", () => {
    expect(renderStaticDashboard(createState()).split("\n").at(-2)).toBe("");
    expect(renderStaticDashboard(createState(), { statusMessage: "Saved." }).split("\n").at(-2)).toBe("› Saved.");
  });

  it("keeps the frame height stable when a status message appears", () => {
    expect(renderStaticDashboard(createState(), { statusMessage: "Saved." }).split("\n"))
      .toHaveLength(renderStaticDashboard(createState()).split("\n").length);
  });

  it("anchors the footer near the bottom when terminal rows are known", () => {
    const lines = renderStaticDashboard(createState(), { columns: 80, rows: 18 }).split("\n");

    expect(lines).toHaveLength(17);
    expect(lines.at(-1)).toBe("[s] stop  [r] restart  [Enter] logs  [e] edit  [?] help  [q] quit");
  });

  it("shows start for a stopped service and the move keys in move mode", () => {
    const state = { ...createState(), selectedItemIndex: 1 };

    expect(renderStaticDashboard(state, { quitLabel: "back" }).split("\n").at(-1)).toBe(
      "[s] start  [Enter] logs  [e] edit  [a] add  [?] help  [S] start all  [q] back",
    );

    const moving = renderStaticDashboard(state, { moving: true }).split("\n");

    expect(moving.at(-2)).toBe('› Moving service "frontend"');
    expect(moving.at(-1)).toBe("[↑↓] move  [Enter] done  [Esc] cancel");
  });

  it("shows run keys for a selected command", () => {
    const state = { ...createState(), selectedItemIndex: 3 };
    const rendered = renderStaticDashboard(state);

    expect(rendered).toContain("> migrate         ✓ done");
    expect(rendered.split("\n").at(-1)).toBe("[r] run  [Enter] output  [e] edit  [a] add  [?] help  [S] start all  [q] quit");
  });

  it("shows waiting and skipped items with what they are waiting for or why they were skipped", () => {
    const state = createState();
    const queued = {
      ...state,
      items: state.items.map((itemState, index) => index === 1
        ? { ...itemState, queue: { status: "waiting" as const, for: ["backend", "cache"] } }
        : index === 2
          ? { ...itemState, queue: { status: "skipped" as const, reason: "migrate failed" } }
          : itemState),
    };
    const rendered = renderStaticDashboard(queued, { columns: 80 });

    expect(rendered).toContain("  frontend        ◌ after backend, cache");
    expect(rendered).toContain("  worker          ✕ skipped");
    expect(renderStaticDashboard({ ...queued, selectedItemIndex: 2 }, { columns: 120, rows: 14 })).toContain("worker · skipped: migrate failed · no output yet");
  });

  it("offers cancel for an item that is waiting, and start all only when there are services", () => {
    const state = createState();
    const waiting = {
      ...state,
      selectedItemIndex: 1,
      items: state.items.map((itemState, index) => index === 1 ? { ...itemState, queue: { status: "waiting" as const, for: ["backend"] } } : itemState),
    };

    expect(renderStaticDashboard(waiting).split("\n").at(-1)).toBe("[s] cancel  [Enter] logs  [e] edit  [?] help  [S] start all  [q] quit");

    const commandsOnly = { ...state, selectedItemIndex: 0, items: state.items.slice(3), itemIndexById: { cmd_migrate: 0 } };

    expect(renderStaticDashboard(commandsOnly).split("\n").at(-1)).not.toContain("start all");
  });

  it("names what the selected item runs after in the preview", () => {
    const state = createState();
    const withAfter = {
      ...state,
      items: state.items.map((itemState, index) => index === 0 ? { ...itemState, item: { ...itemState.item, after: ["svc_frontend", "cmd_migrate"] } } : itemState),
    };
    const rendered = renderStaticDashboard(withAfter, { columns: 120, rows: 14, selectedServiceLogs: [createLog("stdout", "hi")] });

    expect(rendered).toContain("backend (after frontend, migrate) · last 1 lines");
  });

  it("highlights the selected row across the width and pulses it when asked", () => {
    const highlighted = renderStaticDashboard(createState(), { color: true, columns: 60 });
    const selectedLine = highlighted.split("\n").find((line) => stripAnsi(line).startsWith("> backend"));

    expect(selectedLine).toContain("\x1b[48;5;236m");
    expect(visibleLength(selectedLine ?? "")).toBe(59);
    expect(renderStaticDashboard(createState(), { color: true, pulseItemIndex: 0 })).toContain("\x1b[48;5;239m");
  });

  it("shows the selected item's latest output beside the list on wide terminals", () => {
    const logs = [
      createLog("system", "service started"),
      createLog("stdout", "GET /health 200"),
      createLog("stderr", "Error: boom"),
    ];
    const lines = renderStaticDashboard(createState(), { columns: 100, rows: 14, selectedServiceLogs: logs }).split("\n");

    expect(lines[2]).toMatch(/^SERVICES\s+backend · last 3 lines$/);
    expect(lines[3]).toMatch(/^> backend\s+● running\s+· service started$/);
    expect(lines[4]).toMatch(/^ {2}frontend\s+○ stopped\s+ {2}GET \/health 200$/);
    expect(lines[5]).toMatch(/▌ Error: boom$/);
    expect(lines.join("\n")).not.toContain("┌");
  });

  it("says when the selected item has no output yet", () => {
    const rendered = renderStaticDashboard(createState(), { columns: 100, rows: 14, selectedServiceLogs: [] });

    expect(rendered).toContain("backend · no output yet");
  });

  it("shows only the latest lines that fit", () => {
    const logs = Array.from({ length: 30 }, (_, index) => createLog("stdout", `line ${index + 1}`));
    const rendered = renderStaticDashboard(createState(), { columns: 100, rows: 14, selectedServiceLogs: logs });

    expect(rendered).toContain("line 30");
    expect(rendered).not.toMatch(/line 1$/m);
  });

  it("keeps the single-column layout below the wide threshold", () => {
    const rendered = renderStaticDashboard(createState(), { columns: 99, selectedServiceLogs: [createLog("stdout", "hidden")] });

    expect(rendered).not.toContain("hidden");
  });

  it("scrolls the item list around the selection on wide terminals", () => {
    const rendered = renderStaticDashboard(createManyServiceState(30, 25), { columns: 120, rows: 14 });

    expect(rendered).toContain("> service-26");
    expect(rendered).not.toMatch(/service-1\s/);
  });

  it("leaves the last terminal column empty on wide terminals", () => {
    const longLog = createLog("stdout", "x".repeat(300));
    const rendered = renderStaticDashboard(createState(), { columns: 120, rows: 14, selectedServiceLogs: [longLog] });

    for (const line of rendered.split("\n")) {
      expect(visibleLength(line)).toBeLessThan(120);
    }
  });
});

function createState(): RuntimeWorkspaceState {
  return stateOf([
    { item: createService("svc_backend", "backend"), process: { status: "running", pid: 1234 } },
    { item: createService("svc_frontend", "frontend"), process: { status: "stopped" } },
    { item: createService("svc_worker", "worker"), process: { status: "failed", error: new Error("spawn ENOENT") } },
    { item: createCommand("cmd_migrate", "migrate"), process: { status: "exited", exitCode: 0, signal: null } },
  ], 0, { id: "ws_ecommerce", name: "ecommerce", projectDirectory: "/srv/shop" });
}

function stateOf(
  items: RuntimeWorkspaceState["items"],
  selectedItemIndex: number,
  workspace: RuntimeWorkspaceState["workspace"] = { id: "ws_many", name: "many" },
): RuntimeWorkspaceState {
  return {
    workspace,
    items,
    itemIndexById: Object.fromEntries(items.map((itemState, index) => [itemState.item.id, index])),
    selectedItemIndex,
  };
}

function createCommand(id: string, name: string) {
  return { kind: "command" as const, after: [], id, name, command: "npm run migrate", cwd: ".", env: {} };
}

function createService(id: string, name: string) {
  return { kind: "service" as const, after: [], id, name, command: "npm run dev", cwd: ".", autoStart: true, env: {} };
}

function createLog(stream: ServiceLogEntry["stream"], line: string): ServiceLogEntry {
  return { stream, line, timestamp: new Date("2026-01-01T10:42:01") };
}

function createManyServiceState(serviceCount: number, selectedServiceIndex: number): RuntimeWorkspaceState {
  return stateOf(
    Array.from({ length: serviceCount }, (_, index) => ({
      item: createService(`svc_${index + 1}`, `service-${index + 1}`),
      process: { status: "stopped" as const },
    })),
    selectedServiceIndex,
  );
}

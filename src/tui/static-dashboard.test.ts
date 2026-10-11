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
        "[s] stop  [r] restart  [Enter] logs  [e] edit  [?] help  [q] quit",
      ].join("\n"),
    );
  });

  it("explains services and commands when the workspace is empty", () => {
    const rendered = renderStaticDashboard({
      ...createState(),
      services: [],
      commands: [],
      serviceIndexById: {},
      commandIndexById: {},
      selectedServiceIndex: undefined,
      selectedItem: undefined,
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
    const state = { ...createState(), selectedServiceIndex: 1, selectedItem: { type: "service" as const, index: 1 } };

    expect(renderStaticDashboard(state, { quitLabel: "back" }).split("\n").at(-1)).toBe(
      "[s] start  [Enter] logs  [e] edit  [a] add  [?] help  [q] back",
    );

    const moving = renderStaticDashboard(state, { moving: true }).split("\n");

    expect(moving.at(-2)).toBe('› Moving service "frontend"');
    expect(moving.at(-1)).toBe("[↑↓] move  [Enter] done  [Esc] cancel");
  });

  it("shows run keys for a selected command", () => {
    const state = {
      ...createState(),
      selectedServiceIndex: undefined,
      selectedCommandIndex: 0,
      selectedItem: { type: "command" as const, index: 0 },
    };
    const rendered = renderStaticDashboard(state);

    expect(rendered).toContain("> migrate         ✓ done");
    expect(rendered.split("\n").at(-1)).toBe("[r] run  [Enter] output  [e] edit  [a] add  [?] help  [q] quit");
  });

  it("highlights the selected row across the width and pulses it when asked", () => {
    const highlighted = renderStaticDashboard(createState(), { color: true, columns: 60 });
    const selectedLine = highlighted.split("\n").find((line) => stripAnsi(line).startsWith("> backend"));

    expect(selectedLine).toContain("\x1b[48;5;236m");
    expect(visibleLength(selectedLine ?? "")).toBe(59);
    expect(renderStaticDashboard(createState(), { color: true, pulseServiceIndex: 0 })).toContain("\x1b[48;5;239m");
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
  return {
    workspace: { id: "ws_ecommerce", name: "ecommerce", projectDirectory: "/srv/shop" },
    selectedServiceIndex: 0,
    selectedCommandIndex: undefined,
    selectedItem: { type: "service", index: 0 },
    serviceIndexById: { svc_backend: 0, svc_frontend: 1, svc_worker: 2 },
    commandIndexById: { cmd_migrate: 0 },
    services: [
      { service: createService("svc_backend", "backend"), process: { status: "running", pid: 1234 } },
      { service: createService("svc_frontend", "frontend"), process: { status: "stopped" } },
      { service: createService("svc_worker", "worker"), process: { status: "failed", error: new Error("spawn ENOENT") } },
    ],
    commands: [
      { command: createCommand("cmd_migrate", "migrate"), process: { status: "exited", exitCode: 0, signal: null } },
    ],
  };
}

function createCommand(id: string, name: string) {
  return { id, name, command: "npm run migrate", cwd: ".", env: {} };
}

function createService(id: string, name: string) {
  return { id, name, command: "npm run dev", cwd: ".", autoStart: true, env: {} };
}

function createLog(stream: ServiceLogEntry["stream"], line: string): ServiceLogEntry {
  return { stream, line, timestamp: new Date("2026-01-01T10:42:01") };
}

function createManyServiceState(serviceCount: number, selectedServiceIndex: number): RuntimeWorkspaceState {
  const services = Array.from({ length: serviceCount }, (_, index) => ({
    service: createService(`svc_${index + 1}`, `service-${index + 1}`),
    process: { status: "stopped" as const },
  }));

  return {
    workspace: { id: "ws_many", name: "many" },
    selectedServiceIndex,
    selectedCommandIndex: undefined,
    selectedItem: { type: "service", index: selectedServiceIndex },
    serviceIndexById: Object.fromEntries(services.map((serviceState, index) => [serviceState.service.id, index])),
    commandIndexById: {},
    services,
    commands: [],
  };
}

import { describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { stripAnsi, visibleLength } from "./logs-view.js";
import { renderStaticDashboard } from "./static-dashboard.js";

describe("renderStaticDashboard", () => {
  it("renders workspace name and ordered service statuses", () => {
    expect(renderStaticDashboard(createState())).toBe(
      [
        "Workspace: ecommerce",
        "",
        "  Service   Status",
        "  backend   running",
        "  frontend  stopped",
        "  worker    failed: failed",
        "",
        "Status: Service stays running; use S start, s stop, r restart, Enter for logs.",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("renders empty workspaces safely", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_empty", name: "empty" },
        services: [],
        commands: [],
        serviceIndexById: {},
        commandIndexById: {},
        selectedServiceIndex: undefined,
        selectedCommandIndex: undefined,
        selectedItem: undefined,
      }),
    ).toBe(
      [
        "Workspace: empty",
        "",
        "No services or commands yet.",
        "",
        "Press a to add a service to this workspace.",
        "",
        "Status: Add services for long-running processes or commands for one-shot work.",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("renders dashboard messages in a reserved footer status slot", () => {
    expect(renderStaticDashboard(createState(), { statusMessage: "Cannot edit while running." })).toBe(
      [
        "Workspace: ecommerce",
        "",
        "  Service   Status",
        "  backend   running",
        "  frontend  stopped",
        "  worker    failed: failed",
        "",
        "Status: Cannot edit while running.",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("keeps dashboard frame height stable when status messages appear", () => {
    const withoutMessage = renderStaticDashboard(createState());
    const withMessage = renderStaticDashboard(createState(), {
      statusMessage: "Cannot edit while running.",
    });

    expect(withMessage.split("\n")).toHaveLength(withoutMessage.split("\n").length);
  });

  it("anchors the compact dashboard footer near the bottom when terminal rows are known", () => {
    const rendered = renderStaticDashboard(createState(), { columns: 80, rows: 18 });
    const lines = rendered.split("\n");

    expect(lines).toHaveLength(17);
    expect(lines.at(-1)).toBe("j/k select  ? help  q quit");
    expect(lines.at(-2)).toBe("Status: Service stays running; use S start, s stop, r restart, Enter for logs.");
  });

  it("can render process states with restrained color", () => {
    const rendered = renderStaticDashboard(createState(), { color: true });

    expect(rendered).toContain("\x1b[2mWorkspace:\x1b[22m \x1b[1mecommerce\x1b[22m");
    expect(rendered).toContain("\x1b[32mrunning\x1b[39m");
    expect(rendered).toContain("\x1b[31mfailed: failed\x1b[39m");
  });

  it("extends the selected service highlight across the compact table width", () => {
    const rendered = renderStaticDashboard(createState(), { color: true });
    const selectedLine = rendered.split("\n").find((line) => line.startsWith("\x1b[48;5;236m"));

    expect(selectedLine).toBeDefined();
    expect(stripAnsi(selectedLine ?? "")).toHaveLength(visibleLength("  worker    failed: failed"));
    expect(stripAnsi(selectedLine ?? "")).toBe("  backend   running       ");
  });

  it("can pulse the selected service row for selection feedback", () => {
    const rendered = renderStaticDashboard(createState(), {
      color: true,
      pulseServiceIndex: 0,
    });
    const pulsedLine = rendered.split("\n").find((line) => line.startsWith("\x1b[48;5;239m\x1b[1m"));

    expect(pulsedLine).toBeDefined();
    expect(stripAnsi(pulsedLine ?? "")).toBe("  backend   running       ");
  });

  it("renders workspace commands in a separate dashboard section", () => {
    const rendered = renderStaticDashboard({
      ...createState(),
      selectedServiceIndex: undefined,
      selectedCommandIndex: 0,
      selectedItem: { type: "command", index: 0 },
      commands: [
        {
          command: createCommand("cmd_build", "build"),
          process: { status: "exited", exitCode: 0, signal: null },
        },
      ],
      commandIndexById: { cmd_build: 0 },
    });

    expect(rendered).toContain(["  Command  Status", "  build    success"].join("\n"));
    expect(rendered).toContain("Status: Command runs once; use r to run, s to stop while running, Enter for output.");
  });

  it("renders exited status details", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_ecommerce", name: "ecommerce" },
        selectedServiceIndex: 0,
        selectedCommandIndex: undefined,
        selectedItem: { type: "service", index: 0 },
        serviceIndexById: { svc_api: 0, svc_worker: 1 },
        commandIndexById: {},
        services: [
          {
            service: createService("svc_api", "api"),
            process: { status: "exited", exitCode: 7, signal: null },
          },
          {
            service: createService("svc_worker", "worker"),
            process: { status: "exited", exitCode: null, signal: "SIGTERM" },
          },
        ],
        commands: [],
      }),
    ).toContain(["  api      exited code 7", "  worker   exited signal SIGTERM"].join("\n"));
  });

  it("truncates long failure messages", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_ecommerce", name: "ecommerce" },
        selectedServiceIndex: 0,
        selectedCommandIndex: undefined,
        selectedItem: { type: "service", index: 0 },
        serviceIndexById: { svc_api: 0 },
        commandIndexById: {},
        services: [
          {
            service: createService("svc_api", "api"),
            process: {
              status: "failed",
              error: new Error("this is a very long failure message that should be shortened in the dashboard"),
            },
          },
        ],
        commands: [],
      }),
    ).toContain("failed: this is a very long failure message that should be shorte...");
  });

  it("renders a boxed selected-service log preview on wide dashboards", () => {
    const rendered = renderStaticDashboard(createState(), {
      columns: 120,
      rows: 18,
      selectedServiceLogs: [
        createLog("stdout", "server listening"),
        createLog("stderr", "warning from backend"),
      ],
    });

    expect(rendered).toContain("Services 1/3");
    expect(rendered).toContain("Logs · backend");
    expect(rendered).toContain("┌");
    expect(rendered).toContain("stdout server listening");
    expect(rendered).toContain("stderr warning from backend");
  });

  it("keeps the wide log preview when commands exist", () => {
    const rendered = renderStaticDashboard({
      ...createState(),
      commands: [
        {
          command: createCommand("cmd_build", "build"),
          process: { status: "stopped" },
        },
      ],
      commandIndexById: { cmd_build: 0 },
    }, {
      columns: 120,
      rows: 18,
      selectedServiceLogs: [createLog("stdout", "server listening")],
    });

    expect(rendered).toContain("Services 1/3");
    expect(rendered).toContain("Commands");
    expect(rendered).toContain("Logs · backend");
    expect(rendered).toContain("stdout server listening");
  });

  it("shows selected command output in the wide preview", () => {
    const rendered = renderStaticDashboard({
      ...createState(),
      selectedServiceIndex: undefined,
      selectedCommandIndex: 0,
      selectedItem: { type: "command", index: 0 },
      commands: [
        {
          command: createCommand("cmd_build", "build"),
          process: { status: "exited", exitCode: 0, signal: null },
        },
      ],
      commandIndexById: { cmd_build: 0 },
    }, {
      columns: 120,
      rows: 18,
      selectedServiceLogs: [createLog("stdout", "build complete")],
    });

    expect(rendered).toContain("Commands 1/1");
    expect(rendered).toContain("Logs · build");
    expect(rendered).toContain("stdout build complete");
  });

  it("keeps the existing dashboard layout below the wide threshold", () => {
    const rendered = renderStaticDashboard(createState(), {
      columns: 99,
      rows: 18,
      selectedServiceLogs: [createLog("stdout", "server listening")],
    });

    expect(rendered).toContain("  Service   Status");
    expect(rendered).not.toContain("Logs · backend");
    expect(rendered).not.toContain("server listening");
  });

  it("scrolls the services viewport around the selected service on wide dashboards", () => {
    const state = createManyServiceState(8, 6);
    const rendered = renderStaticDashboard(state, { columns: 120, rows: 11 });

    expect(rendered).toContain("Services 7/8");
    expect(rendered).not.toContain("  service-1");
    expect(rendered).toContain("  service-5");
    expect(rendered).toContain("  service-8");
  });

  it("shows only the latest logs in the wide dashboard preview", () => {
    const rendered = renderStaticDashboard(createState(), {
      columns: 120,
      rows: 11,
      selectedServiceLogs: [
        createLog("stdout", "old line"),
        createLog("stdout", "recent one"),
        createLog("stdout", "recent two"),
        createLog("stdout", "recent three"),
      ],
    });

    expect(rendered).not.toContain("old line");
    expect(rendered).toContain("recent one");
    expect(rendered).toContain("recent three");
  });

  it("keeps wide dashboard rows within the terminal width", () => {
    const rendered = renderStaticDashboard({
      workspace: { id: "ws_long", name: "long" },
      selectedServiceIndex: 0,
      selectedCommandIndex: undefined,
      selectedItem: { type: "service", index: 0 },
      serviceIndexById: { svc_long: 0 },
      commandIndexById: {},
      services: [
        {
          service: createService("svc_long", "very-long-service-name-that-would-wrap"),
          process: {
            status: "failed",
            error: new Error("this failure detail is long enough to overflow the compact service column"),
          },
        },
      ],
      commands: [],
    }, {
      columns: 100,
      rows: 12,
      selectedServiceLogs: [createLog("stdout", "this log line should fit inside the preview box")],
    });

    for (const line of rendered.split("\n")) {
      expect(visibleLength(line)).toBeLessThanOrEqual(100);
    }
  });

  it("leaves a trailing-column margin in wide dashboard rows to avoid terminal auto-wrap", () => {
    const rendered = renderStaticDashboard(createState(), {
      columns: 100,
      rows: 12,
      selectedServiceLogs: [
        createLog("stdout", "a long log line that fills most of the available preview width"),
      ],
    });

    for (const line of rendered.split("\n")) {
      expect(visibleLength(line)).toBeLessThanOrEqual(99);
    }
  });

  it("keeps wide dashboard frames below terminal height to avoid redraw scrolling", () => {
    const rendered = renderStaticDashboard(createState(), {
      columns: 120,
      rows: 24,
      selectedServiceLogs: Array.from({ length: 40 }, (_, index) =>
        createLog("stdout", `line ${index + 1}`),
      ),
    });

    expect(rendered.split("\n")).toHaveLength(23);
  });
});

function createState(): RuntimeWorkspaceState {
  return {
    workspace: { id: "ws_ecommerce", name: "ecommerce" },
    selectedServiceIndex: 0,
    selectedCommandIndex: undefined,
    selectedItem: { type: "service", index: 0 },
    serviceIndexById: {
      svc_backend: 0,
      svc_frontend: 1,
      svc_worker: 2,
    },
    commandIndexById: {},
    services: [
      {
        service: createService("svc_backend", "backend"),
        process: { status: "running", pid: 1234 },
      },
      {
        service: createService("svc_frontend", "frontend"),
        process: { status: "stopped" },
      },
      {
        service: createService("svc_worker", "worker"),
        process: { status: "failed", error: new Error("failed") },
      },
    ],
    commands: [],
  };
}

function createCommand(id: string, name: string) {
  return {
    id,
    name,
    command: "npm run build",
    cwd: ".",
    env: {},
  };
}

function createService(id: string, name: string) {
  return {
    id,
    name,
    command: "npm run dev",
    cwd: ".",
    autoStart: true,
    env: {},
  };
}

function createLog(stream: ServiceLogEntry["stream"], line: string): ServiceLogEntry {
  return {
    stream,
    line,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };
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
    serviceIndexById: Object.fromEntries(
      services.map((serviceState, index) => [serviceState.service.id, index]),
    ),
    commandIndexById: {},
    services,
    commands: [],
  };
}

import { describe, expect, it } from "vitest";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderStaticDashboard } from "./static-dashboard.js";

describe("renderStaticDashboard", () => {
  it("renders workspace name and ordered service statuses", () => {
    expect(renderStaticDashboard(createState())).toBe(
      [
        "Workspace",
        "ecommerce",
        "",
        "  Service   Status",
        "  backend   running",
        "  frontend  stopped",
        "  worker    failed: failed",
        "",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("renders empty workspaces safely", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_empty", name: "empty" },
        services: [],
        serviceIndexById: {},
        selectedServiceIndex: undefined,
      }),
    ).toBe(
      [
        "Workspace",
        "empty",
        "",
        "No services yet.",
        "",
        "Press a to add a service to this workspace.",
        "",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("can render process states with restrained color", () => {
    const rendered = renderStaticDashboard(createState(), { color: true });

    expect(rendered).toContain("\x1b[1mecommerce\x1b[22m");
    expect(rendered).toContain("\x1b[32mrunning\x1b[39m");
    expect(rendered).toContain("\x1b[31mfailed: failed\x1b[39m");
  });

  it("renders exited status details", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_ecommerce", name: "ecommerce" },
        selectedServiceIndex: 0,
        serviceIndexById: { svc_api: 0, svc_worker: 1 },
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
      }),
    ).toContain(["  api      exited code 7", "  worker   exited signal SIGTERM"].join("\n"));
  });

  it("truncates long failure messages", () => {
    expect(
      renderStaticDashboard({
        workspace: { id: "ws_ecommerce", name: "ecommerce" },
        selectedServiceIndex: 0,
        serviceIndexById: { svc_api: 0 },
        services: [
          {
            service: createService("svc_api", "api"),
            process: {
              status: "failed",
              error: new Error("this is a very long failure message that should be shortened in the dashboard"),
            },
          },
        ],
      }),
    ).toContain("failed: this is a very long failure message that should be shorte...");
  });
});

function createState(): RuntimeWorkspaceState {
  return {
    workspace: { id: "ws_ecommerce", name: "ecommerce" },
    selectedServiceIndex: 0,
    serviceIndexById: {
      svc_backend: 0,
      svc_frontend: 1,
      svc_worker: 2,
    },
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

import { describe, expect, it } from "vitest";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderStaticDashboard } from "./static-dashboard.js";

describe("renderStaticDashboard", () => {
  it("renders workspace name and ordered service statuses", () => {
    expect(renderStaticDashboard(createState())).toBe(
      [
        "ecommerce",
        "",
        "> backend   running",
        "  frontend  stopped",
        "  worker    failed",
        "",
        "j/k move  S start  s stop  r restart  Enter logs  ? help  : command  q quit",
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
        "empty",
        "",
        "No services configured.",
        "",
        "j/k move  S start  s stop  r restart  Enter logs  ? help  : command  q quit",
      ].join("\n"),
    );
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

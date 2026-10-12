import { describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import type { ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderDeleteDialog } from "./delete-dialog.js";
import { renderForm, type FormField } from "./form-view.js";
import { renderHelpView } from "./help-view.js";
import { renderLogsView } from "./logs-view.js";
import { renderStaticDashboard } from "./static-dashboard.js";
import { renderUpdateDialog } from "./update-dialog.js";
import { createWorkspacePickerState, renderWorkspacePicker, renderWorkspacePickerHelp } from "./workspace-picker.js";
import { plainStyle } from "./style.js";
import { visibleLength } from "./width.js";

// Every screen must fit a narrow terminal: a line as wide as the terminal wraps and
// shifts everything under it.
describe.each([30, 40, 60])("on a %i column terminal", (columns) => {
  const fits = (screen: string) => {
    for (const line of screen.split("\n")) {
      expect(visibleLength(line), line).toBeLessThan(columns);
    }
  };

  it("fits the dashboard", () => {
    fits(renderStaticDashboard(state, { columns, rows: 24, statusMessage: "Stopping backend-with-a-long-name..." }));
  });

  it("fits the workspace picker and its welcome screen", () => {
    fits(renderWorkspacePicker(createWorkspacePickerState(workspaces), { columns, rows: 24 }));
    fits(renderWorkspacePicker(createWorkspacePickerState([]), { columns, rows: 24 }));
  });

  it("fits the logs view", () => {
    fits(renderLogsView({ state, logs, scrollOffset: 0, viewportColumns: columns, visibleLineCount: 10, wrap: true }));
  });

  it("fits the form", () => {
    fits(renderForm({ title: "Edit service", subtitle: "a-long-workspace-name", fields }, { values: { name: "api" }, focus: 0, cursor: 0, errors: {} } as never, plainStyle, false, columns));
  });

  it("fits the popups", () => {
    fits(renderHelpView("dashboard", { columns, rows: 30 }));
    fits(renderWorkspacePickerHelp({ columns, rows: 30 }));
    fits(renderDeleteDialog({ title: "Delete workspace", explanation: ["This removes the workspace."], name: "a-long-workspace-name", columns, rows: 24 }, "", undefined));
    fits(renderUpdateDialog({ latestVersion: "0.4.0", currentVersion: "0.3.0", installCommand: "npm install -g sable-workspaces@latest" }, 0, plainStyle, columns, 24));
  });
});

describe("on a short terminal", () => {
  it.each([12, 16, 20, 24])("keeps help inside %i rows", (rows) => {
    expect(renderHelpView("dashboard", { columns: 80, rows }).split("\n").length).toBeLessThan(rows);
    expect(renderHelpView("logs", { columns: 80, rows }).split("\n").length).toBeLessThan(rows);
  });

  it("keeps the whole help when there is room", () => {
    const help = renderHelpView("dashboard", { columns: 80, rows: 40 });

    expect(help).toContain("Ctrl+C");
    expect(help).not.toContain("...");
  });
});

const fields = (): FormField[] => [
  { type: "text", key: "name", label: "Name" },
  { type: "text", key: "command", label: "Command" },
];

const logs: ServiceLogEntry[] = [
  { stream: "stdout", line: "hello world ".repeat(10), timestamp: new Date("2026-01-01T10:42:01") },
  { stream: "stderr", line: "boom", timestamp: new Date("2026-01-01T10:42:02") },
];

const workspaces: WorkspaceConfig[] = [
  {
    id: "ws_long",
    name: "a-long-workspace-name",
    projectDirectory: "/srv/some/deeply/nested/project/folder",
    services: [{ id: "svc_api", name: "api", command: "npm run dev", cwd: ".", autoStart: true, env: {} }],
  },
];

const state: RuntimeWorkspaceState = {
  workspace: { id: "ws_long", name: "a-long-workspace-name", projectDirectory: "/srv/some/deeply/nested/project/folder" },
  selectedServiceIndex: 0,
  selectedCommandIndex: undefined,
  selectedItem: { type: "service", index: 0 },
  serviceIndexById: { svc_api: 0 },
  commandIndexById: {},
  services: [
    {
      service: { id: "svc_api", name: "backend-with-a-long-name", command: "npm run dev", cwd: ".", autoStart: true, env: {} },
      process: { status: "failed", error: new Error("spawn ENOENT while starting something long") },
    },
  ],
  commands: [],
};

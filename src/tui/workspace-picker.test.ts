import { describe, expect, it, vi } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import {
  createWorkspacePickerState,
  getSelectedWorkspace,
  renderWorkspacePicker,
  renderWorkspaceDetails,
  renderWorkspacePickerHelp,
  runWorkspacePicker,
  selectNextWorkspace,
  selectPreviousWorkspace,
} from "./workspace-picker.js";

describe("workspace picker state", () => {
  it("selects the first workspace by default and wraps selection", () => {
    const state = createWorkspacePickerState(workspaces);

    expect(getSelectedWorkspace(state)?.name).toBe("ecommerce");
    expect(getSelectedWorkspace(selectNextWorkspace(state))?.name).toBe("portfolio");
    expect(getSelectedWorkspace(selectPreviousWorkspace(state))?.name).toBe("portfolio");
  });

  it("has no selected workspace when empty", () => {
    const state = createWorkspacePickerState([]);

    expect(state.selectedWorkspaceIndex).toBeUndefined();
    expect(getSelectedWorkspace(state)).toBeUndefined();
    expect(selectNextWorkspace(state)).toBe(state);
  });
});

describe("renderWorkspacePicker", () => {
  it("renders workspaces with service counts", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces))).toBe(
      [
        "workspaces",
        "",
        "> ecommerce  2 services",
        "  portfolio  1 service",
        "",
        "j/k move  Enter run  v view  a add service  e edit service  ? help  q quit",
      ].join("\n"),
    );
  });



  it("renders a status message", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces, 'Auto-start disabled for "api".'))).toContain(
      'Auto-start disabled for "api".',
    );
  });

  it("renders selected workspace details", () => {
    expect(renderWorkspaceDetails(workspaces[0])).toBe(
      [
        "ecommerce",
        "",
        "services",
        "",
        "api",
        "  command     npm run dev",
        `  cwd         ${process.cwd()}`,
        "  autoStart   yes",
        "",
        "web",
        "  command     npm run web",
        `  cwd         ${process.cwd()}`,
        "  autoStart   no",
        "  env         1 variable",
        "",
        "Esc back  q back",
      ].join("\n"),
    );
  });

  it("renders empty workspace details", () => {
    expect(renderWorkspaceDetails({ id: "ws_empty", name: "empty", services: [] })).toBe(
      [
        "empty",
        "",
        "services",
        "",
        "No services configured.",
        "",
        "Esc back  q back",
      ].join("\n"),
    );
  });

  it("renders an empty state", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState([]))).toContain(
      "No workspaces found.",
    );
  });

  it("renders help", () => {
    expect(renderWorkspacePickerHelp()).toContain("Enter       run selected workspace");
    expect(renderWorkspacePickerHelp()).toContain("v           view selected workspace");
    expect(renderWorkspacePickerHelp()).toContain(
      "a           add service to selected workspace",
    );
    expect(renderWorkspacePickerHelp()).toContain(
      "e           edit service in selected workspace",
    );
  });
});

describe("runWorkspacePicker", () => {
  it("navigates and returns the selected workspace on Enter", async () => {
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "j" }, { name: "return" }]),
      screen: { clear: vi.fn(), write },
    });

    expect(result).toEqual({ type: "run", workspace: workspaces[1] });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("opens help and returns to the picker", async () => {
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([
        { sequence: "?" },
        { name: "escape" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      renderHelp: () => "help",
    });

    expect(result).toEqual({ type: "exit" });
    expect(write).toHaveBeenNthCalledWith(1, "picker\n");
    expect(write).toHaveBeenNthCalledWith(2, "help\n");
    expect(write).toHaveBeenNthCalledWith(3, "picker\n");
  });

  it("opens workspace details and returns to the picker", async () => {
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([
        { sequence: "v" },
        { name: "escape" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      renderDetails: (workspace) => `details:${workspace.name}`,
    });

    expect(result).toEqual({ type: "exit" });
    expect(write).toHaveBeenNthCalledWith(1, "picker\n");
    expect(write).toHaveBeenNthCalledWith(2, "details:ecommerce\n");
    expect(write).toHaveBeenNthCalledWith(3, "picker\n");
  });

  it("returns the selected workspace on add service", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "a" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "addService", workspace: workspaces[0] });
  });

  it("returns the selected workspace on edit service", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "e" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "editService", workspace: workspaces[0] });
  });

  it("exits on Ctrl+C", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "exit" });
  });
});

function createKeyInput(keys: Awaited<ReturnType<KeyInput["readKey"]>>[]): KeyInput {
  return {
    readKey: vi.fn(async () => {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key queued.");
      }

      return key;
    }),
    close: vi.fn(),
  };
}

const workspaces: WorkspaceConfig[] = [
  {
    id: "ws_ecommerce",
    name: "ecommerce",
    services: [
      {
        id: "svc_api",
        name: "api",
        command: "npm run dev",
        cwd: process.cwd(),
        autoStart: true,
        env: {},
      },
      {
        id: "svc_web",
        name: "web",
        command: "npm run web",
        cwd: process.cwd(),
        autoStart: false,
        env: { PORT: "3000" },
      },
    ],
  },
  {
    id: "ws_portfolio",
    name: "portfolio",
    services: [
      {
        id: "svc_site",
        name: "site",
        command: "npm run dev",
        cwd: process.cwd(),
        autoStart: true,
        env: {},
      },
    ],
  },
];

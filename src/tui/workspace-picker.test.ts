import { describe, expect, it, vi } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { stripAnsi, visibleLength } from "./logs-view.js";
import {
  createWorkspacePickerState,
  getSelectedWorkspace,
  renderWorkspacePicker,
  renderWorkspaceDetails,
  renderWorkspacePickerHelp,
  renderWorkspaceStartupMoment,
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

  it("clears transient status messages when selection changes", () => {
    const state = createWorkspacePickerState(workspaces, "Created workspace.");

    expect(selectNextWorkspace(state).statusMessage).toBeUndefined();
    expect(selectPreviousWorkspace(state).statusMessage).toBeUndefined();
  });

  it("has no selected workspace when empty", () => {
    const state = createWorkspacePickerState([]);

    expect(state.selectedWorkspaceIndex).toBeUndefined();
    expect(getSelectedWorkspace(state)).toBeUndefined();
    expect(selectNextWorkspace(state)).toBe(state);
  });

  it("selects a workspace by id when provided", () => {
    const state = createWorkspacePickerState(workspaces, undefined, "ws_portfolio");

    expect(getSelectedWorkspace(state)?.name).toBe("portfolio");
  });

  it("tracks the active workspace id", () => {
    const state = createWorkspacePickerState(workspaces, undefined, undefined, "ws_ecommerce");

    expect(state.activeWorkspaceId).toBe("ws_ecommerce");
  });
});

describe("renderWorkspacePicker", () => {
  it("renders workspaces with service counts", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces))).toBe(
      [
        "Workspaces",
        "",
        "  Workspace  Services",
        "  ecommerce  2",
        "  portfolio  1",
        "",
        "",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("renders status messages in a reserved footer slot", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces, 'Auto-start disabled for "api".'))).toBe(
      [
        "Workspaces",
        "",
        "  Workspace  Services",
        "  ecommerce  2",
        "  portfolio  1",
        "",
        'Status: Auto-start disabled for "api".',
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("marks the active workspace as running", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces, undefined, undefined, "ws_ecommerce"))).toBe(
      [
        "Workspaces",
        "",
        "  Workspace  Services  State  ",
        "  ecommerce  2  running",
        "  portfolio  1         ",
        "",
        "",
        "j/k select  ? help  q quit",
      ].join("\n"),
    );
  });

  it("keeps picker frame height stable when status messages appear", () => {
    const withoutMessage = renderWorkspacePicker(createWorkspacePickerState(workspaces));
    const withMessage = renderWorkspacePicker(
      createWorkspacePickerState(workspaces, 'Auto-start disabled for "api".'),
    );

    expect(withMessage.split("\n")).toHaveLength(withoutMessage.split("\n").length);
  });

  it("anchors the picker footer near the bottom when terminal rows are known", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState(workspaces), { rows: 18 });
    const lines = rendered.split("\n");

    expect(lines).toHaveLength(17);
    expect(lines.at(-1)).toBe("j/k select  ? help  q quit");
    expect(lines.at(-2)).toBe("");
  });

  it("can render with restrained color", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState(workspaces), { color: true });

    expect(rendered).toContain("\x1b[1mWorkspaces\x1b[22m");
    expect(rendered).toContain("\x1b[2m2\x1b[22m");
  });

  it("renders the Sable startup banner on wide terminals", () => {
    const rendered = renderWorkspaceStartupMoment({ columns: 80, rows: 12 });

    expect(rendered).toContain("███████╗ █████╗ ██████╗ ██╗     ███████╗");
    expect(rendered).toContain("Keyboard-first Workspace Manager");
    expect(rendered).toContain("─".repeat(40));
  });

  it("keeps startup banner rows aligned as one fixed-width block", () => {
    const bannerRows = renderWorkspaceStartupMoment({ columns: 80, rows: 12 })
      .split("\n")
      .filter((line) => /[█╚]/.test(line));
    const firstVisibleColumns = bannerRows.map((line) => stripAnsi(line).search(/\S/));

    expect(new Set(firstVisibleColumns).size).toBe(1);
  });

  it("renders a compact startup moment on narrow terminals", () => {
    const rendered = renderWorkspaceStartupMoment({ columns: 20, rows: 7 });

    expect(rendered.split("\n")).toEqual([
      "",
      "",
      "     · sable ·",
      "",
      "  workspace ready",
    ]);
  });

  it("extends the selected workspace highlight across the table width", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState(workspaces), { color: true });
    const selectedLine = rendered.split("\n").find((line) => line.startsWith("\x1b[48;5;236m"));

    expect(selectedLine).toBeDefined();
    expect(stripAnsi(selectedLine ?? "")).toHaveLength(visibleLength("  Workspace  Services"));
    expect(stripAnsi(selectedLine ?? "")).toBe("  ecommerce  2       ");
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
    expect(renderWorkspaceDetails({ id: "ws_empty", name: "empty", projectDirectory: process.cwd(), services: [] })).toBe(
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
      "No workspaces yet.",
    );
    expect(renderWorkspacePicker(createWorkspacePickerState([]))).toContain(
      "Press c to create your first workspace.",
    );
  });

  it("renders help", () => {
    expect(renderWorkspacePickerHelp()).toContain("Enter       run selected workspace");
    expect(renderWorkspacePickerHelp()).toContain("c           create blank workspace");
    expect(renderWorkspacePickerHelp()).toContain("e           rename selected workspace");
    expect(renderWorkspacePickerHelp()).toContain("d           delete selected workspace");
    expect(renderWorkspacePickerHelp()).toContain("K           move selected workspace up");
    expect(renderWorkspacePickerHelp()).toContain("J           move selected workspace down");
    expect(renderWorkspacePickerHelp()).toContain("v           view selected workspace");
    expect(renderWorkspacePickerHelp()).not.toContain("add service");
    expect(renderWorkspacePickerHelp()).not.toContain("edit service");
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

  it("shows an interruptible startup moment before the picker", async () => {
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      renderStartupMoment: () => "intro",
      startupMomentMs: 1_000,
    });

    expect(result).toEqual({ type: "exit" });
    expect(write).toHaveBeenNthCalledWith(1, "intro\n");
    expect(write).toHaveBeenNthCalledWith(2, "picker\n");
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

  it("returns create workspace on c", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "c" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "createWorkspace" });
  });

  it("returns the selected workspace on rename", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "e" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "renameWorkspace", workspace: workspaces[0] });
  });

  it("returns the selected workspace on move up", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "K" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "moveWorkspaceUp", workspace: workspaces[0] });
  });

  it("returns the selected workspace on move down", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "J" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "moveWorkspaceDown", workspace: workspaces[0] });
  });

  it("returns the selected workspace on delete", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "d" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "deleteWorkspace", workspace: workspaces[0] });
  });

  it("ignores service action keys in the picker", async () => {
    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "a" }, { sequence: "S" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
    });

    expect(result).toEqual({ type: "exit" });
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
    projectDirectory: process.cwd(),
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
    projectDirectory: process.cwd(),
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

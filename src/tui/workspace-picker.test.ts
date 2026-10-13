import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import { product } from "../shared/product.js";
import { sableLogoAnsi, sableLogoAnsiHeight, sableLogoAnsiWidth } from "../generated/sable-logo-ansi.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { stripAnsi, visibleLength } from "./logs-view.js";
import {
  createWorkspacePickerState,
  getSelectedWorkspace,
  renderWorkspacePicker,
  renderWorkspaceDetails,
  renderWorkspacePickerHelp,
  describeWorkspaces,
  renderWorkspaceStartupMoment,
  runWorkspacePicker,
  selectNextWorkspace,
  selectPreviousWorkspace,
  type WorkspacePickerState,
} from "./workspace-picker.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  it("renders workspaces with status, service counts, and folders", () => {
    expect(renderWorkspacePicker(createWorkspacePickerState(workspaces))).toBe(
      [
        "Sable · 2 workspaces",
        "",
        "> ecommerce  ○ stopped  2 services  /srv/ecommerce",
        "  portfolio  ○ stopped  1 service   /srv/portfolio",
        "",
        "",
        "[↑↓] select  [Enter] open  [a] add  [e] rename  [?] help  [q] quit",
      ].join("\n"),
    );
  });
  it("shows the import key only when the launch folder has a sable.json", () => {
    const without = renderWorkspacePicker(createWorkspacePickerState(workspaces)).split("\n").at(-1);
    const withFile = renderWorkspacePicker({ ...createWorkspacePickerState(workspaces), projectFileHere: true }).split("\n").at(-1);

    expect(without).not.toContain("import");
    expect(withFile).toBe("[↑↓] select  [Enter] open  [a] add  [i] import sable.json  [e] rename  [?] help  [q] quit");
  });

  it("renders status messages in a reserved footer slot", () => {
    const lines = renderWorkspacePicker(createWorkspacePickerState(workspaces, 'Auto-start disabled for "api".')).split("\n");

    expect(lines.at(-2)).toBe('› Auto-start disabled for "api".');
  });
  it("marks the active workspace as running with its running service count", () => {
    const state = { ...createWorkspacePickerState(workspaces, undefined, undefined, "ws_ecommerce"), activeRunningServiceCount: 1 };
    const rendered = renderWorkspacePicker(state);

    expect(rendered).toContain("> ecommerce  ● running  1/2 services  /srv/ecommerce");
    expect(rendered).toContain("  portfolio  ○ stopped  1 service     /srv/portfolio");
    expect(rendered.split("\n").at(-1)).toBe("[↑↓] select  [Enter] open  [s] stop  [r] restart  [?] help  [q] quit");
  });
  it("marks the active workspace as stopped when none of its services run", () => {
    const state = { ...createWorkspacePickerState(workspaces, undefined, undefined, "ws_ecommerce"), activeRunningServiceCount: 0 };

    expect(renderWorkspacePicker(state)).toContain("> ecommerce  ○ stopped  0/2 services  /srv/ecommerce");
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
    expect(lines.at(-1)).toBe("[↑↓] select  [Enter] open  [a] add  [e] rename  [?] help  [q] quit");
    expect(lines.at(-2)).toBe("");
  });

  it("can render with restrained color", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState(workspaces), { color: true });

    expect(rendered).toContain("\x1b[1mSable\x1b[22m");
    expect(rendered).toContain("\x1b[2m2 services\x1b[22m");
  });
  it("renders the Sable startup banner on wide terminals", () => {
    const rendered = renderWorkspaceStartupMoment({ columns: 80, rows: 12 });

    expect(rendered).toContain("███████╗ █████╗ ██████╗ ██╗     ███████╗");
    expect(rendered).toContain("Keyboard-first Workspace Manager");
    expect(rendered).toContain("─".repeat(40));
  });

  it("renders the generated 16-color ANSI logo when color output is safe", () => {
    const rendered = renderWorkspaceStartupMoment({ color: true, columns: 80, rows: 20 });
    const logoRows = rendered.split("\n").filter((line) => /\x1b\[(?:3\d|9\d)m/.test(line));

    expect(rendered).toMatch(/\x1b\[(?:3\d|9\d)m/);
    expect(rendered).toMatch(/\x1b\[(?:4\d|10\d)m/);
    expect(rendered).not.toContain("\x1b[38;2;");
    expect(rendered).not.toContain("\x1b[48;2;");
    expect(rendered).not.toContain("███████╗ █████╗ ██████╗ ██╗     ███████╗");
    expect(logoRows).toHaveLength(sableLogoAnsiHeight);
    expect(logoRows.every((line) => visibleLength(line.trimStart()) <= sableLogoAnsiWidth)).toBe(true);
  });

  it("falls back to the textual startup banner for dumb terminals", () => {
    vi.stubEnv("TERM", "dumb");

    const rendered = renderWorkspaceStartupMoment({ color: true, columns: 80, rows: 12 });

    expect(rendered).toContain("███████╗ █████╗ ██████╗ ██╗     ███████╗");
    expect(rendered).not.toContain("\x1b[38;2;");
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
      `  · sable ${product.version} ·`,
      "",
      "  workspace ready",
    ]);
  });

  it("shows the version beside the name and a summary line under the banner", () => {
    const rendered = renderWorkspaceStartupMoment({ columns: 80, rows: 14, summary: "2 workspaces · 3 services" });

    expect(rendered).toContain(`Sable ${product.version}`);
    expect(rendered).toContain("2 workspaces · 3 services");
  });

  it("builds the colored logo up dot by dot without moving it", () => {
    const frame = (options: Parameters<typeof renderWorkspaceStartupMoment>[0]) =>
      renderWorkspaceStartupMoment({ color: true, columns: 80, rows: 20, summary: "1 workspace · 2 services", ...options });
    const early = frame({ stage: 0, reveal: { revealedDots: 40, glowDots: 10 } });
    const late = frame({ stage: 0, reveal: { revealedDots: 300, glowDots: 10 } });
    const named = frame({ stage: 1 });
    const complete = frame({ stage: 2 });
    const dots = (text: string) => [...stripAnsi(text)].filter((char) => char > "\u2800" && char <= "\u28ff").length;

    expect(dots(early)).toBeLessThan(dots(late));
    expect(dots(late)).toBeLessThan(dots(complete));
    expect(stripAnsi(late)).not.toContain(`Sable ${product.version}`);
    expect(stripAnsi(named)).toContain(`Sable ${product.version}`);
    expect(stripAnsi(named)).not.toContain("Keyboard-first");
    expect(stripAnsi(complete)).toContain("Keyboard-first Workspace Manager");
    expect(stripAnsi(complete)).toContain("1 workspace · 2 services");
    expect(new Set([early, late, named, complete].map((text) => text.split("\n").length)).size).toBe(1);
    expect(complete).toContain(sableLogoAnsi[0]!.replace("\x1b[0m", ""));
  });

  it("describes your workspaces in a few words", () => {
    expect(describeWorkspaces([])).toBe("No workspaces yet · press a to create one");
    expect(describeWorkspaces(workspaces)).toMatch(/^2 workspaces · \d+ services?$/);
  });

  it("highlights the selected row across the table width", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState(workspaces), { color: true });
    const highlighted = rendered.split("\n").filter((line) => line.includes("\x1b[48;5;236m"));
    const plainRows = renderWorkspacePicker(createWorkspacePickerState(workspaces)).split("\n").slice(2, 4);

    expect(highlighted).toHaveLength(1);
    expect(visibleLength(highlighted[0]!)).toBe(Math.max(...plainRows.map((row) => visibleLength(row))));
  });

  it("shortens long folders so each row stays on one line", () => {
    const longFolder = { ...workspaces[0]!, projectDirectory: `/srv/${"deep/".repeat(30)}project` };
    const rendered = renderWorkspacePicker(createWorkspacePickerState([longFolder]), { columns: 60 });
    const row = rendered.split("\n")[2]!;

    expect(visibleLength(row)).toBeLessThan(60);
    expect(row).toContain("> ecommerce  ○ stopped  2 services  /srv/deep/");
  });

  it("renders selected workspace details with services and commands", () => {
    const workspace = {
      ...workspaces[0]!,
      items: [...workspaces[0]!.items, { kind: "command", after: [], id: "cmd_migrate", name: "migrate", command: "npm run migrate", cwd: ".", env: {} }],
    };

    expect(renderWorkspaceDetails(workspace)).toBe(
      [
        "ecommerce · /srv/ecommerce",
        "",
        "SERVICES",
        `  api       npm run dev`,
        `            in ${process.cwd()} · auto-start`,
        `  web       npm run web`,
        `            in ${process.cwd()} · 1 env variable`,
        "",
        "COMMANDS",
        "  migrate   npm run migrate",
        "            in .",
        "",
        "[Esc] back",
      ].join("\n"),
    );
  });

  it("renders empty workspace details", () => {
    expect(renderWorkspaceDetails({ id: "ws_empty", name: "empty", projectDirectory: "/srv/empty", items: [] })).toBe(
      ["empty · /srv/empty", "", "No services or commands yet.", "", "[Esc] back"].join("\n"),
    );
  });

  it("welcomes a new user and explains what a workspace is", () => {
    const rendered = renderWorkspacePicker(createWorkspacePickerState([]));

    expect(rendered.split("\n")[0]).toBe("Welcome to Sable");
    expect(rendered).toContain("A workspace is a project folder plus the services you run in it,");
    expect(rendered.split("\n").at(-1)).toBe("[a] create your first workspace  [?] help  [q] quit");
  });


  it("renders help", () => {
    const help = renderWorkspacePickerHelp();

    expect(help).toContain("Enter       open selected workspace");
    expect(help).toContain("a           add a workspace");
    expect(help).toContain("e           rename selected workspace");
    expect(help).toContain("d           delete selected workspace");
    expect(help).toContain("m           move selected workspace (↑ ↓, then Enter)");
    expect(help).toContain("s           stop it");
    expect(help).toContain("r           restart its services");
    expect(help).not.toContain("K  ");
  });
});

describe("runWorkspacePicker", () => {
  it("navigates and returns the selected workspace on Enter", async () => {
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ name: "down" }, { name: "return" }]),
      screen: { clear: vi.fn(), write },
    });

    expect(result).toEqual({ type: "run", workspace: workspaces[1] });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("plays soft cues when moving and opening", async () => {
    const sound = { play: vi.fn(), isEnabled: () => true, setEnabled: vi.fn(async () => {}) };

    await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ name: "down" }, { name: "return" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      sound,
    });

    expect(sound.play.mock.calls).toEqual([["move"], ["open"]]);
  });

  it("opens settings with a comma and redraws the list afterwards", async () => {
    const settings = fakeSettings();
    const runSettings = vi.fn(async () => "close" as const);
    const write = vi.fn();

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "," }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      settings,
      runSettings,
    });

    expect(result).toEqual({ type: "exit" });
    expect(runSettings).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("ignores the settings key when settings are not available", async () => {
    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "," }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
    });

    expect(result).toEqual({ type: "exit" });
  });

  it("shows the settings key in the footer only when available", () => {
    const base = createWorkspacePickerState(workspaces);

    expect(renderWorkspacePicker(base)).not.toContain("[,] settings");
    expect(renderWorkspacePicker({ ...base, settingsAvailable: true })).toContain("[?] help  [,] settings  [q] quit");
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

  it("builds the logo up, then shows the name and the rest, and plays the open tone once", async () => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", undefined as unknown as string);
    const frames: Array<{ stage?: number; revealed?: number }> = [];
    const write = vi.fn();
    const sound = { play: vi.fn(), isEnabled: () => true, setEnabled: vi.fn(async () => {}), close: vi.fn() };

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: { readKey: () => new Promise((resolve) => setTimeout(() => resolve({ sequence: "q" }), 600)), close: vi.fn() },
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      renderStartupMoment: (frameOptions) => {
        frames.push({ stage: frameOptions?.stage, revealed: frameOptions?.reveal?.revealedDots });
        return "intro";
      },
      startupMomentMs: 200,
      sound,
    });

    const build = frames.filter((frame) => frame.stage === 0);
    const revealed = build.map((frame) => frame.revealed!);

    expect(result).toEqual({ type: "exit" });
    expect(build.length).toBeGreaterThan(1);
    expect(revealed).toEqual([...revealed].sort((a, b) => a - b));
    expect(frames.filter((frame) => frame.stage !== 0).map((frame) => frame.stage)).toEqual([1, 2]);
    expect(sound.play.mock.calls).toEqual([["open"]]);
    // After the first frame, frames draw over the last one instead of clearing the screen.
    expect(write.mock.calls[0]![0]).toBe("intro\n");
    expect(write.mock.calls[1]![0]).toMatch(/^\x1b\[H/);
  });

  it("stops fading and goes to the list when a key is pressed during the launch screen", async () => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", undefined as unknown as string);
    const stages: number[] = [];

    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "picker",
      renderStartupMoment: (stageOptions) => {
        stages.push(stageOptions?.stage ?? -1);
        return "intro";
      },
      startupMomentMs: 60_000,
    });

    expect(result).toEqual({ type: "exit" });
    expect(stages).toEqual([0]);
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

  it("redraws the list when the terminal is resized", async () => {
    const write = vi.fn();

    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ name: "resize" }, { sequence: "q" }]),
        screen: { clear: vi.fn(), write },
      }),
    ).resolves.toEqual({ type: "exit" });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("returns create workspace on a", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "a" }]),
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

  it("returns the selected workspace on stop", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "s" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "stopActiveWorkspace", workspace: workspaces[0] });
  });

  it("returns the selected workspace on restart", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "r" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "restartActiveWorkspace", workspace: workspaces[0] });
  });

  it("reorders a workspace with move mode and returns its new position on Enter", async () => {
    const write = vi.fn();

    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "m" }, { name: "down" }, { name: "return" }]),
        screen: { clear: vi.fn(), write },
      }),
    ).resolves.toEqual({ type: "reorderWorkspace", workspace: workspaces[0], index: 1 });
    expect(write.mock.calls.map(([contents]) => contents).join("")).toContain("[↑↓] move  [Enter] done  [Esc] cancel");
  });

  it("cancels move mode with Escape and restores the original order", async () => {
    const render = vi.fn((state: WorkspacePickerState) => state.workspaces.map((workspace) => workspace.name).join(","));

    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "m" }, { name: "down" }, { name: "escape" }, { name: "return" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
        render,
      }),
    ).resolves.toEqual({ type: "run", workspace: workspaces[0] });
    expect(render.mock.results.map((result) => result.value)).toEqual([
      "ecommerce,portfolio",
      "ecommerce,portfolio",
      "portfolio,ecommerce",
      "ecommerce,portfolio",
    ]);
  });

  it("runs the after-startup hook once after the logo, and can hand back an update", async () => {
    const afterStartup = vi.fn(async () => "update" as const);

    await expect(runWorkspacePicker({
      workspaces,
      keyInput: { readKey: () => new Promise(() => {}), close: vi.fn() },
      screen: { clear: vi.fn(), write: vi.fn() },
      startupMomentMs: 1,
      afterStartup,
    })).resolves.toEqual({ type: "update" });
    expect(afterStartup).toHaveBeenCalledOnce();
  });

  it("does not replay a key pressed in the popup to the workspace list", async () => {
    // Like the real terminal, every pending read receives each key.
    const waiters: Array<(key: { name?: string; sequence?: string }) => void> = [];
    const press = (key: { name?: string; sequence?: string }) => waiters.splice(0).forEach((resolve) => resolve(key));
    const keyInput = { readKey: () => new Promise<{ name?: string; sequence?: string }>((resolve) => waiters.push(resolve)), close: vi.fn() };
    const afterStartup = vi.fn(async () => {
      const key = await keyInput.readKey();

      expect(key.name).toBe("return");
      setTimeout(() => press({ sequence: "q" }), 5);
      return "continue" as const;
    });
    const picking = runWorkspacePicker({ workspaces, keyInput, screen: { clear: vi.fn(), write: vi.fn() }, startupMomentMs: 1, afterStartup });

    await new Promise((resolve) => setTimeout(resolve, 20));
    press({ name: "return" });

    await expect(picking).resolves.toEqual({ type: "exit" });
  });

  it("still runs the after-startup hook when there is no logo, then shows the list", async () => {
    const afterStartup = vi.fn(async () => "continue" as const);
    const write = vi.fn();

    await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "picker",
      startupMomentMs: 0,
      afterStartup,
    });

    expect(afterStartup).toHaveBeenCalledOnce();
    expect(write).toHaveBeenNthCalledWith(1, "picker\n");
  });

  it("returns the selected workspace on delete", async () => {
    await expect(
      runWorkspacePicker({
        workspaces,
        keyInput: createKeyInput([{ sequence: "d" }]),
        screen: { clear: vi.fn(), write: vi.fn() },
      }),
    ).resolves.toEqual({ type: "deleteWorkspace", workspace: workspaces[0], background: expect.stringContaining("ecommerce") });
  });

  it("ignores service action keys in the picker", async () => {
    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "z" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
    });

    expect(result).toEqual({ type: "exit" });
  });

  it("asks to import with i and to write a sable.json for the selected workspace with x", async () => {
    await expect(runWorkspacePicker({ workspaces, keyInput: createKeyInput([{ sequence: "i" }]), screen: { clear: vi.fn(), write: vi.fn() } }))
      .resolves.toEqual({ type: "importProject" });
    await expect(runWorkspacePicker({ workspaces, keyInput: createKeyInput([{ sequence: "x" }]), screen: { clear: vi.fn(), write: vi.fn() } }))
      .resolves.toEqual({ type: "exportProject", workspace: workspaces[0] });
  });

  it("opens the saved logs with L, over the list as it was drawn", async () => {
    const result = await runWorkspacePicker({
      workspaces,
      keyInput: createKeyInput([{ sequence: "L" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "THE LIST",
    });

    expect(result).toEqual({ type: "savedLogs", background: "THE LIST" });
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

const toggle = (enabled = true) => {
  let on = enabled;

  return { isEnabled: () => on, setEnabled: vi.fn(async (next: boolean) => { on = next; }) };
};
const fakeSettings = () => ({ sound: { play: vi.fn(), close: vi.fn(), ...toggle() }, welcomeScreen: toggle(), persistLogs: toggle() });

const workspaces: WorkspaceConfig[] = [
  {
    id: "ws_ecommerce",
    name: "ecommerce",
    projectDirectory: "/srv/ecommerce",
    items: [
      {
        kind: "service", after: [],
        id: "svc_api",
        name: "api",
        command: "npm run dev",
        cwd: process.cwd(),
        autoStart: true,
        env: {},
      },
      {
        kind: "service", after: [],
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
    projectDirectory: "/srv/portfolio",
    items: [
      {
        kind: "service", after: [],
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

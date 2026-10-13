import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { LogFiles, LogUsage } from "../logs/log-files.js";
import type { runSavedLogsDialog, SavedLogRow } from "../tui/saved-logs-dialog.js";
import { runAllSavedLogs, runWorkspaceSavedLogs } from "./saved-logs-flow.js";
import type { RunWorkspaceController } from "./run-workspace.js";

const keyInput: KeyInput = { readKey: async () => { throw new Error("no keys"); }, close() {} };

function fakeLogFiles(sizes: Record<string, number>) {
  const usage = (key: string): LogUsage => ({ bytes: sizes[key] ?? 0, files: sizes[key] === undefined ? 0 : 1 });

  return {
    usage: vi.fn(async (target: { workspace: string; name: string }) => usage(`${target.workspace}/${target.name}`)),
    workspaceUsage: vi.fn(async (workspace: string) => usage(workspace)),
    totalUsage: vi.fn(async () => ({ bytes: Object.entries(sizes).filter(([key]) => !key.includes("/")).reduce((sum, [, bytes]) => sum + bytes, 0), files: 9 })),
    remove: vi.fn(async () => undefined),
    removeWorkspace: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
  } as unknown as LogFiles & Record<"usage" | "workspaceUsage" | "totalUsage" | "remove" | "removeWorkspace" | "removeAll", ReturnType<typeof vi.fn>>;
}

function fakeController() {
  return {
    getState: () => ({
      workspace: { id: "ws", name: "stack" },
      items: [
        { item: { id: "svc_db", name: "db", kind: "service" }, process: { status: "stopped" } },
        { item: { id: "cmd_build", name: "build", kind: "command" }, process: { status: "stopped" } },
      ],
    }),
    clearEarlierOutput: vi.fn(),
  } as unknown as RunWorkspaceController & { clearEarlierOutput: ReturnType<typeof vi.fn> };
}

// Captures what the flow would show, and lets the test press "delete" on a row.
function captureDialog() {
  let options: Parameters<typeof runSavedLogsDialog>[0] | undefined;
  const dialog = vi.fn(async (given: Parameters<typeof runSavedLogsDialog>[0]) => {
    options = given;

    return "close" as const;
  }) as unknown as typeof runSavedLogsDialog;

  return { dialog, get: () => options! };
}

describe("runWorkspaceSavedLogs", () => {
  it("lists the workspace as a whole and each item with what is saved for it", async () => {
    const logFiles = fakeLogFiles({ stack: 5000, "stack/db": 3000, "stack/build": 2000 });
    const { dialog, get } = captureDialog();

    await runWorkspaceSavedLogs({ logFiles, controller: fakeController(), keyInput, saving: true, dialog });

    expect(get().title).toBe("Saved logs · stack");
    expect(get().note).toBeUndefined();
    expect(await get().load()).toEqual<SavedLogRow[]>([
      { label: "Everything in this workspace", bytes: 5000 },
      { label: "db", bytes: 3000 },
      { label: "build (command)", bytes: 2000 },
    ]);
  });

  it("says when saving is off, because then the files listed are old ones", async () => {
    const { dialog, get } = captureDialog();

    await runWorkspaceSavedLogs({ logFiles: fakeLogFiles({}), controller: fakeController(), keyInput, saving: false, dialog });

    expect(get().note).toBe("Saving logs is off. These are files from earlier.");
  });

  it("deletes one item's files and forgets its earlier output on screen", async () => {
    const logFiles = fakeLogFiles({});
    const controller = fakeController();
    const { dialog, get } = captureDialog();

    await runWorkspaceSavedLogs({ logFiles, controller, keyInput, saving: true, dialog });
    await get().remove(2);

    expect(logFiles.remove).toHaveBeenCalledWith([{ workspace: "stack", name: "build", kind: "command" }]);
    expect(controller.clearEarlierOutput).toHaveBeenCalledWith(["cmd_build"]);
    expect(logFiles.removeWorkspace).not.toHaveBeenCalled();
  });

  it("deletes the whole workspace folder from the first row, including files of items that no longer exist", async () => {
    const logFiles = fakeLogFiles({});
    const controller = fakeController();
    const { dialog, get } = captureDialog();

    await runWorkspaceSavedLogs({ logFiles, controller, keyInput, saving: true, dialog });
    await get().remove(0);

    expect(logFiles.removeWorkspace).toHaveBeenCalledWith("stack");
    expect(controller.clearEarlierOutput).toHaveBeenCalledWith();
  });

  it("passes the result of the popup on", async () => {
    const dialog = vi.fn(async () => "exit" as const) as unknown as typeof runSavedLogsDialog;

    await expect(runWorkspaceSavedLogs({ logFiles: fakeLogFiles({}), controller: fakeController(), keyInput, saving: true, dialog })).resolves.toBe("exit");
  });
});

describe("runAllSavedLogs", () => {
  const workspaces = [{ name: "stack" }, { name: "blog" }];

  it("lists everything and each workspace", async () => {
    const { dialog, get } = captureDialog();

    await runAllSavedLogs({ logFiles: fakeLogFiles({ stack: 4000, blog: 100 }), keyInput, saving: true, workspaces, dialog });

    expect(get().title).toBe("Saved logs");
    expect(await get().load()).toEqual<SavedLogRow[]>([
      { label: "Everything", bytes: 4100 },
      { label: "stack", bytes: 4000 },
      { label: "blog", bytes: 100 },
    ]);
  });

  it("deletes one workspace's folder, and clears the screen only for the workspace that is running", async () => {
    const logFiles = fakeLogFiles({});
    const controller = fakeController();
    const { dialog, get } = captureDialog();

    await runAllSavedLogs({ logFiles, keyInput, saving: true, workspaces, active: { name: "stack", controller }, dialog });
    await get().remove(2);
    expect(logFiles.removeWorkspace).toHaveBeenCalledWith("blog");
    expect(controller.clearEarlierOutput).not.toHaveBeenCalled();

    await get().remove(1);
    expect(logFiles.removeWorkspace).toHaveBeenCalledWith("stack");
    expect(controller.clearEarlierOutput).toHaveBeenCalledOnce();
  });

  it("deletes the whole logs folder from the first row", async () => {
    const logFiles = fakeLogFiles({});
    const controller = fakeController();
    const { dialog, get } = captureDialog();

    await runAllSavedLogs({ logFiles, keyInput, saving: false, workspaces, active: { name: "stack", controller }, dialog });
    await get().remove(0);

    expect(get().note).toBe("Saving logs is off. These are files from earlier.");
    expect(logFiles.removeAll).toHaveBeenCalledOnce();
    expect(controller.clearEarlierOutput).toHaveBeenCalledOnce();
  });
});

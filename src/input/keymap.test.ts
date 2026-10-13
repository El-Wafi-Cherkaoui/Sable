import { describe, expect, it } from "vitest";
import {
  mapDashboardKey,
  mapHelpKey,
  mapLogsKey,
  mapMoveKey,
  mapWorkspacePickerKey,
} from "./keymap.js";

describe("mapWorkspacePickerKey", () => {
  it("maps navigation keys", () => {
    expect(mapWorkspacePickerKey({ name: "down" })).toBe("selectNext");
    expect(mapWorkspacePickerKey({ name: "up" })).toBe("selectPrevious");
    expect(mapWorkspacePickerKey({ name: "return" })).toBe("run");
    expect(mapWorkspacePickerKey({ sequence: "\r" })).toBe("run");
  });

  it("maps workspace keys", () => {
    expect(mapWorkspacePickerKey({ sequence: "a" })).toBe("createWorkspace");
    expect(mapWorkspacePickerKey({ sequence: "e" })).toBe("renameWorkspace");
    expect(mapWorkspacePickerKey({ sequence: "d" })).toBe("deleteWorkspace");
    expect(mapWorkspacePickerKey({ sequence: "m" })).toBe("startMove");
    expect(mapWorkspacePickerKey({ sequence: "s" })).toBe("stopActiveWorkspace");
    expect(mapWorkspacePickerKey({ sequence: "r" })).toBe("restartActiveWorkspace");
    expect(mapWorkspacePickerKey({ sequence: "v" })).toBe("view");
    expect(mapWorkspacePickerKey({ sequence: "?" })).toBe("openHelp");
    expect(mapWorkspacePickerKey({ sequence: "q" })).toBe("quit");
  });

  it("no longer maps the pre-0.3 keys", () => {
    expect(mapWorkspacePickerKey({ sequence: "j" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "k" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "c" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "K" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "J" })).toBe("none");
  });

  it("imports a project file with i", () => {
    expect(mapWorkspacePickerKey({ sequence: "i" })).toBe("importProject");
    expect(mapWorkspacePickerKey({ sequence: "x" })).toBe("exportProject");
  });

  it("does not quit on Escape or unknown keys", () => {
    expect(mapWorkspacePickerKey({ name: "escape" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "S" })).toBe("none");
    expect(mapWorkspacePickerKey({ sequence: "z" })).toBe("none");
  });
});

describe("mapDashboardKey", () => {
  it("maps navigation keys", () => {
    expect(mapDashboardKey({ name: "down" })).toBe("selectNext");
    expect(mapDashboardKey({ name: "up" })).toBe("selectPrevious");
    expect(mapDashboardKey({ name: "return" })).toBe("openLogs");
  });

  it("maps Escape and q to back", () => {
    expect(mapDashboardKey({ name: "escape" })).toBe("back");
    expect(mapDashboardKey({ sequence: "q" })).toBe("back");
  });

  it("maps item action keys", () => {
    expect(mapDashboardKey({ sequence: "s" })).toBe("toggle");
    expect(mapDashboardKey({ sequence: "r" })).toBe("restart");
    expect(mapDashboardKey({ sequence: "a" })).toBe("addService");
    expect(mapDashboardKey({ sequence: "e" })).toBe("editService");
    expect(mapDashboardKey({ sequence: "d" })).toBe("deleteService");
    expect(mapDashboardKey({ sequence: "m" })).toBe("startMove");
    expect(mapDashboardKey({ sequence: "?" })).toBe("openHelp");
  });

  it("no longer maps the pre-0.3 keys", () => {
    expect(mapDashboardKey({ sequence: "j" })).toBe("none");
    expect(mapDashboardKey({ sequence: "k" })).toBe("none");
    expect(mapDashboardKey({ sequence: "K" })).toBe("none");
    expect(mapDashboardKey({ sequence: "J" })).toBe("none");
  });

  it("starts every service with a capital S", () => {
    expect(mapDashboardKey({ sequence: "S" })).toBe("startAll");
    expect(mapDashboardKey({ sequence: "s" })).toBe("toggle");
  });

  it("no longer opens command mode", () => {
    expect(mapDashboardKey({ sequence: ":" })).toBe("none");
  });
});

describe("mapLogsKey", () => {
  it("maps scroll keys", () => {
    expect(mapLogsKey({ name: "down" })).toBe("scrollDown");
    expect(mapLogsKey({ name: "up" })).toBe("scrollUp");
    expect(mapLogsKey({ name: "left" })).toBe("scrollLeft");
    expect(mapLogsKey({ name: "right" })).toBe("scrollRight");
    expect(mapLogsKey({ sequence: "g" })).toBe("scrollTop");
    expect(mapLogsKey({ name: "home" })).toBe("scrollTop");
    expect(mapLogsKey({ sequence: "G" })).toBe("scrollBottom");
    expect(mapLogsKey({ name: "end" })).toBe("scrollBottom");
    expect(mapLogsKey({ sequence: "0" })).toBe("resetHorizontalScroll");
  });

  it("maps search, error, and wrap keys", () => {
    expect(mapLogsKey({ sequence: "/" })).toBe("search");
    expect(mapLogsKey({ sequence: "n" })).toBe("nextMatch");
    expect(mapLogsKey({ sequence: "N" })).toBe("previousMatch");
    expect(mapLogsKey({ sequence: "e" })).toBe("nextError");
    expect(mapLogsKey({ sequence: "w" })).toBe("toggleWrap");
  });

  it("maps Escape and q to back and ? to help", () => {
    expect(mapLogsKey({ name: "escape" })).toBe("back");
    expect(mapLogsKey({ sequence: "q" })).toBe("back");
    expect(mapLogsKey({ sequence: "?" })).toBe("openHelp");
    expect(mapLogsKey({ sequence: ":" })).toBe("none");
  });

  it("no longer maps the pre-0.3 keys", () => {
    expect(mapLogsKey({ sequence: "j" })).toBe("none");
    expect(mapLogsKey({ sequence: "k" })).toBe("none");
    expect(mapLogsKey({ sequence: "h" })).toBe("none");
    expect(mapLogsKey({ sequence: "l" })).toBe("none");
  });
});

describe("mapHelpKey", () => {
  it("closes help with Escape, q, or ?", () => {
    expect(mapHelpKey({ name: "escape" })).toBe("back");
    expect(mapHelpKey({ sequence: "q" })).toBe("back");
    expect(mapHelpKey({ sequence: "?" })).toBe("back");
    expect(mapHelpKey({ sequence: ":" })).toBe("none");
  });
});

describe("mapMoveKey", () => {
  it("maps move, done, and cancel keys", () => {
    expect(mapMoveKey({ name: "up" })).toBe("moveUp");
    expect(mapMoveKey({ name: "down" })).toBe("moveDown");
    expect(mapMoveKey({ name: "return" })).toBe("done");
    expect(mapMoveKey({ sequence: "m" })).toBe("done");
    expect(mapMoveKey({ name: "escape" })).toBe("cancel");
    expect(mapMoveKey({ sequence: "q" })).toBe("cancel");
    expect(mapMoveKey({ sequence: "x" })).toBe("none");
  });
});

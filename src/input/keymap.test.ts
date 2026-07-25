import { describe, expect, it } from "vitest";
import { mapDashboardKey, mapLogsKey } from "./keymap.js";

describe("mapDashboardKey", () => {
  it("maps down and j to select next", () => {
    expect(mapDashboardKey({ name: "down" })).toBe("selectNext");
    expect(mapDashboardKey({ sequence: "j" })).toBe("selectNext");
  });

  it("maps up and k to select previous", () => {
    expect(mapDashboardKey({ name: "up" })).toBe("selectPrevious");
    expect(mapDashboardKey({ sequence: "k" })).toBe("selectPrevious");
  });

  it("maps escape and q to quit", () => {
    expect(mapDashboardKey({ name: "escape" })).toBe("quit");
    expect(mapDashboardKey({ sequence: "q" })).toBe("quit");
  });

  it("maps service action keys", () => {
    expect(mapDashboardKey({ sequence: "S" })).toBe("start");
    expect(mapDashboardKey({ sequence: "s" })).toBe("stop");
    expect(mapDashboardKey({ sequence: "r" })).toBe("restart");
  });

  it("maps enter to open logs", () => {
    expect(mapDashboardKey({ name: "return" })).toBe("openLogs");
    expect(mapDashboardKey({ sequence: "\r" })).toBe("openLogs");
  });

  it("ignores unknown keys", () => {
    expect(mapDashboardKey({ sequence: "x" })).toBe("none");
  });
});

describe("mapLogsKey", () => {
  it("maps scroll keys", () => {
    expect(mapLogsKey({ name: "down" })).toBe("scrollDown");
    expect(mapLogsKey({ sequence: "j" })).toBe("scrollDown");
    expect(mapLogsKey({ name: "up" })).toBe("scrollUp");
    expect(mapLogsKey({ sequence: "k" })).toBe("scrollUp");
  });

  it("maps jump, back, and quit keys", () => {
    expect(mapLogsKey({ sequence: "g" })).toBe("scrollTop");
    expect(mapLogsKey({ sequence: "G" })).toBe("scrollBottom");
    expect(mapLogsKey({ name: "escape" })).toBe("back");
    expect(mapLogsKey({ sequence: "q" })).toBe("quit");
  });

  it("ignores unknown log keys", () => {
    expect(mapLogsKey({ sequence: "x" })).toBe("none");
  });
});

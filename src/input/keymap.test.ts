import { describe, expect, it } from "vitest";
import { mapDashboardKey } from "./keymap.js";

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

  it("ignores unknown keys", () => {
    expect(mapDashboardKey({ sequence: "x" })).toBe("none");
  });
});

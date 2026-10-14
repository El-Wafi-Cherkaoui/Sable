import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayPath, formatStatus, isProblemItem } from "./format.js";
import { plainStyle } from "./style.js";

describe("formatStatus", () => {
  it("pairs a symbol with a word for every state", () => {
    expect(formatStatus({ status: "running", pid: 1 }, "service", plainStyle)).toBe("● running");
    expect(formatStatus({ status: "stopped" }, "service", plainStyle)).toBe("○ stopped");
    expect(formatStatus({ status: "stopped" }, "command", plainStyle)).toBe("○ idle");
    expect(formatStatus({ status: "exited", exitCode: 0, signal: null }, "command", plainStyle)).toBe("✓ done");
    expect(formatStatus({ status: "exited", exitCode: 0, signal: null }, "service", plainStyle)).toBe("○ exited 0");
    expect(formatStatus({ status: "exited", exitCode: 1, signal: null }, "service", plainStyle)).toBe("✕ exited 1");
    expect(formatStatus({ status: "exited", exitCode: null, signal: "SIGKILL" }, "service", plainStyle)).toBe("✕ killed (SIGKILL)");
    expect(formatStatus({ status: "failed", error: new Error("spawn ENOENT\nmore") }, "service", plainStyle)).toBe("✕ failed: spawn ENOENT");
  });
});

describe("displayPath", () => {
  const home = path.join(path.sep, "home", "dev");

  it("shortens paths inside the home directory", () => {
    expect(displayPath(home, home)).toBe("~");
    expect(displayPath(path.join(home, "code", "shop"), home)).toBe(`~${path.sep}${path.join("code", "shop")}`);
  });

  it("leaves other paths alone", () => {
    expect(displayPath(path.join(path.sep, "srv", "app"), home)).toBe(path.join(path.sep, "srv", "app"));
    expect(displayPath(path.join(path.sep, "home", "devops"), home)).toBe(path.join(path.sep, "home", "devops"));
    expect(displayPath("relative/dir", home)).toBe("relative/dir");
  });
});

describe("isProblemItem", () => {
  it("counts failed, killed, non-zero and skipped items, not running, idle or clean exits", () => {
    expect(isProblemItem({ process: { status: "failed", error: new Error("x") } })).toBe(true);
    expect(isProblemItem({ process: { status: "exited", exitCode: 1, signal: null } })).toBe(true);
    expect(isProblemItem({ process: { status: "exited", exitCode: null, signal: "SIGKILL" } })).toBe(true);
    expect(isProblemItem({ process: { status: "stopped" }, queue: { status: "skipped", reason: "db failed" } })).toBe(true);
    expect(isProblemItem({ process: { status: "exited", exitCode: 0, signal: null } })).toBe(false);
    expect(isProblemItem({ process: { status: "running" } })).toBe(false);
    expect(isProblemItem({ process: { status: "stopped" }, queue: { status: "waiting", for: ["db"] } })).toBe(false);
  });
});

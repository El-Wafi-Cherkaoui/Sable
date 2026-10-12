import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPathCompleter } from "./path-completion.js";

const tree: Record<string, string[]> = {
  [path.resolve("/work")]: ["api", "app", "docs", ".git", "Web"],
  [path.resolve("/work/api")]: ["src", "scripts"],
  [path.resolve("/home/me")]: ["projects", "photos"],
};

function completer() {
  return createPathCompleter({
    homeDirectory: path.resolve("/home/me"),
    listDirectories: (directory) => tree[directory] ?? [],
  });
}

describe("createPathCompleter", () => {
  const base = path.resolve("/work");

  it("suggests nothing for empty text", () => {
    expect(completer()("", base)).toBeUndefined();
  });

  it("completes a relative name from the base folder, alphabetically first", () => {
    expect(completer()("a", base)).toBe("pi/");
  });

  it("completes inside a nested folder", () => {
    expect(completer()("api/s", base)).toBe("cripts/");
    expect(completer()(`api${path.sep}s`, base)).toBe("cripts/");
  });

  it("offers the first subfolder after a trailing separator", () => {
    expect(completer()("api/", base)).toBe("scripts/");
  });

  it("completes absolute paths and ~", () => {
    expect(completer()(`${path.resolve("/work")}${path.sep}d`, "/elsewhere")).toBe("ocs/");
    expect(completer()("~/pro", base)).toBe("jects/");
  });

  it("hides dot folders unless a dot was typed", () => {
    expect(completer()("", base)).toBeUndefined();
    expect(completer()(".", base)).toBe("git/");
  });

  it("suggests nothing when nothing continues the text, or the name is already complete", () => {
    expect(completer()("zzz", base)).toBeUndefined();
    expect(completer()("docs", base)).toBeUndefined();
  });

  it("suggests nothing for a folder that cannot be read", () => {
    expect(completer()("missing/x", base)).toBeUndefined();
  });
});

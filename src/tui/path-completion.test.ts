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

// The completer ends a suggestion with the separator the text already uses ("/" if one
// was typed), and otherwise the platform's own.
const native = path.sep;

describe("createPathCompleter", () => {
  const base = path.resolve("/work");

  it("suggests nothing for empty text", () => {
    expect(completer()("", base)).toEqual([]);
  });

  it("completes a relative name from the base folder, alphabetically", () => {
    expect(completer()("a", base)).toEqual([`pi${native}`, `pp${native}`]);
  });

  it("completes inside a nested folder", () => {
    expect(completer()("api/s", base)).toEqual(["cripts/", "rc/"]);
    expect(completer()(`api${path.sep}s`, base)).toEqual([`cripts${native}`, `rc${native}`]);
  });

  it("offers every subfolder after a trailing separator, alphabetically", () => {
    expect(completer()("api/", base)).toEqual(["scripts/", "src/"]);
  });

  it("completes absolute paths and ~", () => {
    expect(completer()(`${path.resolve("/work")}${path.sep}d`, "/elsewhere")).toEqual([`ocs${native}`]);
    expect(completer()("~/pro", base)).toEqual(["jects/"]);
  });

  it("hides dot folders unless a dot was typed", () => {
    expect(completer()("", base)).toEqual([]);
    expect(completer()(".", base)).toEqual([`git${native}`]);
  });

  it("suggests nothing when nothing continues the text, or the name is already complete", () => {
    expect(completer()("zzz", base)).toEqual([]);
    expect(completer()("docs", base)).toEqual([]);
  });

  it("suggests nothing for a folder that cannot be read", () => {
    expect(completer()("missing/x", base)).toEqual([]);
  });
});

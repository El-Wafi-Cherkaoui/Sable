import path from "node:path";
import { describe, expect, it } from "vitest";
import { changesReviewLines, importReviewLines } from "./review-lines.js";
import type { ResolvedProjectItem } from "./project-sync.js";

const projectDirectory = path.resolve("/work/shop");

const api: ResolvedProjectItem = {
  name: "api",
  kind: "service",
  command: "npm run dev",
  cwd: path.join(projectDirectory, "api"),
  env: { PORT: "3000", MODE: "dev" },
  autoStart: true,
  after: ["db"],
};
const build: ResolvedProjectItem = { name: "build", kind: "command", command: "npm run build", cwd: projectDirectory, env: {}, after: [] };

const text = (lines: Array<{ text: string }>) => lines.map((line) => line.text).join("\n");

describe("importReviewLines", () => {
  it("lists every item with what it runs, where, with which variables and what it waits for", () => {
    const rendered = text(importReviewLines([api, build], [], projectDirectory));

    expect(rendered).toContain("• service api");
    expect(rendered).toContain("    run    npm run dev");
    expect(rendered).toContain("    in     api");
    expect(rendered).toContain("    env    PORT=3000 MODE=dev");
    expect(rendered).toContain("    after  db");
    expect(rendered).toContain("    starts when the workspace opens");
    expect(rendered).toContain("• command build");
  });

  it("leaves out empty facts, the project folder, and the start rule for commands", () => {
    const rendered = text(importReviewLines([build], [], projectDirectory));

    expect(rendered).not.toContain("in ");
    expect(rendered).not.toContain("env");
    expect(rendered).not.toContain("after");
    expect(rendered).not.toContain("starts");
  });

  it("says when a service only starts on request", () => {
    expect(text(importReviewLines([{ ...api, autoStart: false }], [], projectDirectory))).toContain("only when you start it");
  });

  it("names the placeholders the user will be asked for", () => {
    const rendered = text(importReviewLines([build], [{ name: "API_PORT", description: "Port for the API", default: "3000" }, { name: "TOKEN" }], projectDirectory));

    expect(rendered).toContain("Sable will ask you for:");
    expect(rendered).toContain("{{API_PORT}}  Port for the API, default 3000");
    expect(rendered).toContain("{{TOKEN}}");
  });
});

describe("changesReviewLines", () => {
  it("shows added items in full, changed items as before and after, and removed items by name", () => {
    const { name: _name, ...before } = build;
    const rendered = changesReviewLines({
      added: [api],
      changed: [{ item: { ...build, command: "rm -rf ~", env: { A: "1" } }, before }],
      removed: ["old"],
    }, projectDirectory);

    expect(text(rendered)).toContain("+ new service api");
    expect(text(rendered)).toContain("~ changed command build");
    expect(text(rendered)).toContain("    - run    npm run build");
    expect(text(rendered)).toContain("    + run    rm -rf ~");
    expect(text(rendered)).toContain("    + env    A=1");
    expect(text(rendered)).toContain("- removed old");
    expect(rendered.find((line) => line.text.includes("+ run"))?.tone).toBe("added");
    expect(rendered.find((line) => line.text.includes("- run"))?.tone).toBe("removed");
  });

  it("only lists the facts that differ", () => {
    const { name: _name, ...before } = api;
    const rendered = text(changesReviewLines({ added: [], changed: [{ item: { ...api, command: "npm start" }, before }], removed: [] }, projectDirectory));

    expect(rendered).toContain("- run    npm run dev");
    expect(rendered).not.toContain("PORT");
    expect(rendered).not.toContain("after");
  });

  it("says when an item changed from a service to a command", () => {
    const { name: _name, ...before } = api;
    const rendered = text(changesReviewLines({ added: [], changed: [{ item: { ...build, name: "api" }, before }], removed: [] }, projectDirectory));

    expect(rendered).toContain("- was a service");
    expect(rendered).toContain("+ is now a command");
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPackageManager, runScriptCommand, suggestScripts, type ProjectFiles } from "./script-suggestions.js";

const project = path.resolve(path.sep, "code", "shop");

describe("suggestScripts", () => {
  it("turns scripts into services and one-shot commands, preselecting the dev server", () => {
    const files = fakeFiles({
      "package.json": JSON.stringify({
        scripts: {
          dev: "vite",
          "dev:api": "node server.js",
          preview: "vite preview",
          build: "vite build",
          "test:unit": "vitest",
          "db:migrate": "prisma migrate deploy",
          prebuild: "rimraf dist",
          postinstall: "patch-package",
          prepare: "husky",
        },
      }),
    });

    expect(suggestScripts(project, files)).toEqual({
      manager: "npm",
      suggestions: [
        { name: "dev", script: "vite", command: "npm run dev", kind: "service", selected: true },
        { name: "dev:api", script: "node server.js", command: "npm run dev:api", kind: "service", selected: true },
        { name: "preview", script: "vite preview", command: "npm run preview", kind: "service", selected: false },
        { name: "build", script: "vite build", command: "npm run build", kind: "command", selected: false },
        { name: "test:unit", script: "vitest", command: "npm run test:unit", kind: "command", selected: false },
        { name: "db:migrate", script: "prisma migrate deploy", command: "npm run db:migrate", kind: "command", selected: false },
      ],
    });
  });

  it("returns nothing without a usable package.json", () => {
    expect(suggestScripts(project, fakeFiles({}))).toBeUndefined();
    expect(suggestScripts(project, fakeFiles({ "package.json": "{ not json" }))).toBeUndefined();
    expect(suggestScripts(project, fakeFiles({ "package.json": "{}" }))).toBeUndefined();
    expect(suggestScripts(project, fakeFiles({ "package.json": JSON.stringify({ scripts: { prepare: "husky" } }) }))).toBeUndefined();
  });
});

describe("detectPackageManager", () => {
  it("picks the package manager from the lockfile", () => {
    expect(detectPackageManager(project, fakeFiles({ "pnpm-lock.yaml": "" }))).toBe("pnpm");
    expect(detectPackageManager(project, fakeFiles({ "yarn.lock": "" }))).toBe("yarn");
    expect(detectPackageManager(project, fakeFiles({ "bun.lock": "" }))).toBe("bun");
    expect(detectPackageManager(project, fakeFiles({ "package-lock.json": "" }))).toBe("npm");
  });

  it("builds the run command for each package manager", () => {
    expect(runScriptCommand("npm", "dev")).toBe("npm run dev");
    expect(runScriptCommand("pnpm", "dev")).toBe("pnpm run dev");
    expect(runScriptCommand("yarn", "dev")).toBe("yarn dev");
    expect(runScriptCommand("bun", "dev")).toBe("bun run dev");
  });
});

function fakeFiles(contents: Record<string, string>): ProjectFiles {
  const byPath = new Map(Object.entries(contents).map(([name, text]) => [path.join(project, name), text]));

  return {
    exists: (filePath) => byPath.has(filePath),
    read: (filePath) => {
      const text = byPath.get(filePath);

      if (text === undefined) {
        throw new Error(`ENOENT: ${filePath}`);
      }

      return text;
    },
  };
}

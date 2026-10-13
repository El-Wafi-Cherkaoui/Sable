import path from "node:path";
import { describe, expect, it } from "vitest";
import { suggestProject } from "./project-suggestions.js";
import type { ProjectFiles } from "./script-suggestions.js";

const project = path.resolve(path.sep, "code", "shop");

function fakeFiles(contents: Record<string, string>): ProjectFiles {
  const byPath = new Map(Object.entries(contents).map(([name, text]) => [path.join(project, ...name.split("/")), text]));

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

const summary = (found: ReturnType<typeof suggestProject>) => found?.suggestions.map((item) => [item.name, item.kind, item.selected, item.command]);

describe("suggestProject", () => {
  it("finds nothing in a folder without any known project file", () => {
    expect(suggestProject(project, fakeFiles({ "README.md": "# hi" }), "linux")).toBeUndefined();
  });

  it("keeps the package.json suggestions exactly as they were", () => {
    const found = suggestProject(project, fakeFiles({ "package.json": JSON.stringify({ scripts: { dev: "vite", build: "vite build" } }) }), "linux");

    expect(found?.sources).toEqual(["package.json (npm)"]);
    expect(summary(found)).toEqual([["dev", "service", true, "npm run dev"], ["build", "command", false, "npm run build"]]);
  });

  describe("Makefile", () => {
    const makefile = [
      "CC := gcc",
      "BIN = app",
      ".PHONY: all build run test clean",
      "",
      "all: build",
      "",
      "build:",
      "\t@go build -o app ./...",
      "",
      "run: build",
      "\t./app --port 8080",
      "",
      "dev:",
      "\t-air",
      "",
      "dev-build:",
      "\tnpm run build -- --watch",
      "",
      "test:",
      "\tgo test ./...",
      "",
      "%.o: %.c",
      "\t$(CC) -c $<",
      "",
      "build/out:",
      "\tmkdir -p build",
    ].join("\n");

    it("turns targets into commands and services named after the tool, with their first line as the detail", () => {
      const found = suggestProject(project, fakeFiles({ Makefile: makefile }), "linux");

      expect(found?.sources).toEqual(["Makefile"]);
      expect(summary(found)).toEqual([
        ["make all", "command", false, "make all"],
        ["make build", "command", false, "make build"],
        ["make run", "service", true, "make run"],
        ["make dev", "service", false, "make dev"],
        ["make dev-build", "command", false, "make dev-build"],
        ["make test", "command", false, "make test"],
      ]);
      expect(found?.suggestions.find((item) => item.name === "make build")?.script).toBe("go build -o app ./...");
      expect(found?.suggestions.find((item) => item.name === "make dev")?.script).toBe("air");
      expect(found?.suggestions.find((item) => item.name === "make all")?.script).toBe("make all");
    });

    it("skips variables, special targets, patterns and paths", () => {
      const names = suggestProject(project, fakeFiles({ Makefile: makefile }), "linux")?.suggestions.map((item) => item.name) ?? [];

      expect(names.join(" ")).not.toMatch(/CC|BIN|PHONY|%|out/);
    });

    it("lists a target once, accepts the other spellings of the file name, and caps a huge file", () => {
      expect(suggestProject(project, fakeFiles({ makefile: "a:\n\tx\na:\n\ty\n" }), "linux")?.suggestions).toHaveLength(1);
      expect(suggestProject(project, fakeFiles({ GNUmakefile: "a:\n\tx\n" }), "linux")?.suggestions).toHaveLength(1);

      const big = Array.from({ length: 40 }, (_, index) => `t${index}:\n\techo ${index}`).join("\n");

      expect(suggestProject(project, fakeFiles({ Makefile: big }), "linux")?.suggestions).toHaveLength(12);
    });

    it("copes with Windows line endings", () => {
      expect(suggestProject(project, fakeFiles({ Makefile: "build:\r\n\tgo build\r\n" }), "linux")?.suggestions[0]?.script).toBe("go build");
    });
  });

  describe("justfile", () => {
    const justfile = [
      "set shell := [\"bash\", \"-c\"]",
      "version := \"1\"",
      "",
      "# run the dev server",
      "dev:",
      "    npm run dev",
      "",
      "test: build",
      "    @cargo test",
      "",
      "deploy env:",
      "    ./deploy {{env}}",
      "",
      "_helper:",
      "    echo private",
      "",
      "serve port=\"3000\":",
      "    run {{port}}",
    ].join("\n");

    it("offers recipes that take no arguments, as just commands", () => {
      const found = suggestProject(project, fakeFiles({ justfile }), "linux");

      expect(found?.sources).toEqual(["justfile"]);
      expect(summary(found)).toEqual([
        ["just dev", "service", true, "just dev"],
        ["just test", "command", false, "just test"],
      ]);
      expect(found?.suggestions[1]?.script).toBe("cargo test");
    });
  });

  describe("Docker Compose", () => {
    const compose = [
      "name: shop",
      "services:",
      "  db:",
      "    image: postgres:16",
      "    ports:",
      "      - \"5432:5432\"",
      "  # the cache",
      "  \"cache\":",
      "    image: redis",
      "  web:",
      "    build: .",
      "volumes:",
      "  data:",
    ].join("\n");

    it("offers to start everything, and each service on its own", () => {
      const found = suggestProject(project, fakeFiles({ "compose.yaml": compose }), "linux");

      expect(found?.sources).toEqual(["Docker Compose"]);
      expect(summary(found)).toEqual([
        ["compose up", "service", true, "docker compose up"],
        ["compose db", "service", false, "docker compose up db"],
        ["compose cache", "service", false, "docker compose up cache"],
        ["compose web", "service", false, "docker compose up web"],
      ]);
    });

    it("finds the older file name too, and still offers up when no service can be read", () => {
      expect(suggestProject(project, fakeFiles({ "docker-compose.yml": compose }), "linux")?.suggestions).toHaveLength(4);
      expect(summary(suggestProject(project, fakeFiles({ "docker-compose.yml": "version: '3'\n" }), "linux"))).toEqual([["compose up", "service", true, "docker compose up"]]);
    });
  });

  describe("Cargo and Go", () => {
    it("offers run only for a program, plus test and build", () => {
      expect(summary(suggestProject(project, fakeFiles({ "Cargo.toml": "[package]\nname = \"x\"\n", "src/main.rs": "fn main() {}" }), "linux"))).toEqual([
        ["cargo run", "service", true, "cargo run"],
        ["cargo test", "command", false, "cargo test"],
        ["cargo build", "command", false, "cargo build"],
      ]);
      expect(summary(suggestProject(project, fakeFiles({ "Cargo.toml": "[package]\nname = \"lib\"\n" }), "linux"))?.map((row) => row[0])).toEqual(["cargo test", "cargo build"]);
      expect(summary(suggestProject(project, fakeFiles({ "Cargo.toml": "[package]\n[[bin]]\nname = \"x\"\n" }), "linux"))?.[0]?.[0]).toBe("cargo run");
    });

    it("offers go run only when there is a main.go", () => {
      expect(summary(suggestProject(project, fakeFiles({ "go.mod": "module x", "main.go": "package main" }), "linux"))?.map((row) => row[3])).toEqual(["go run .", "go test ./...", "go build ./..."]);
      expect(summary(suggestProject(project, fakeFiles({ "go.mod": "module x" }), "linux"))?.map((row) => row[3])).toEqual(["go test ./...", "go build ./..."]);
    });
  });

  describe("Python", () => {
    it("offers the Django server, migrations and tests, with the right python for the system", () => {
      expect(summary(suggestProject(project, fakeFiles({ "manage.py": "" }), "linux"))?.map((row) => row[3])).toEqual([
        "python3 manage.py runserver",
        "python3 manage.py migrate",
        "python3 manage.py test",
      ]);
      expect(suggestProject(project, fakeFiles({ "manage.py": "" }), "win32")?.suggestions[0]?.command).toBe("python manage.py runserver");
    });

    it("offers pytest when the project mentions it, but not for every Python project", () => {
      expect(summary(suggestProject(project, fakeFiles({ "pytest.ini": "" }), "linux"))).toEqual([["pytest", "command", false, "pytest"]]);
      expect(suggestProject(project, fakeFiles({ "pyproject.toml": "[tool.poetry.dev-dependencies]\npytest = \"^8\"" }), "linux")?.sources).toEqual(["pytest"]);
      expect(suggestProject(project, fakeFiles({ "requirements.txt": "requests\nflask" }), "linux")).toBeUndefined();
    });
  });

  describe("Rails and Laravel", () => {
    it("recognises a Rails app and uses ruby on Windows", () => {
      const rails = { "bin/rails": "", "config/application.rb": "" };

      expect(summary(suggestProject(project, fakeFiles(rails), "linux"))?.map((row) => row[3])).toEqual(["bin/rails server", "bin/rails test", "bin/rails db:migrate"]);
      expect(suggestProject(project, fakeFiles(rails), "win32")?.suggestions[0]?.command).toBe("ruby bin/rails server");
      expect(suggestProject(project, fakeFiles({ "bin/rails": "" }), "linux")).toBeUndefined();
    });

    it("recognises a Laravel app", () => {
      expect(summary(suggestProject(project, fakeFiles({ artisan: "", "composer.json": "{}" }), "linux"))?.map((row) => row[3])).toEqual(["php artisan serve", "php artisan test", "php artisan migrate"]);
      expect(suggestProject(project, fakeFiles({ artisan: "" }), "linux")).toBeUndefined();
    });
  });

  it("ticks only the first service of each file other than package.json", () => {
    const found = suggestProject(project, fakeFiles({
      "package.json": JSON.stringify({ scripts: { dev: "vite", start: "node ." } }),
      Makefile: "run:\n\tx\ndev:\n\ty\n",
      "compose.yaml": "services:\n  db:\n    image: x\n",
    }), "linux");

    expect(found?.suggestions.filter((item) => item.selected).map((item) => item.name)).toEqual(["dev", "start", "make run", "compose up"]);
  });

  it("combines every kind of file it finds, listing the sources in order", () => {
    const found = suggestProject(project, fakeFiles({
      "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      Makefile: "build:\n\tgo build\n",
      "go.mod": "module x",
      "compose.yaml": "services:\n  db:\n    image: x\n",
    }), "linux");

    expect(found?.sources).toEqual(["package.json (npm)", "Makefile", "Docker Compose", "go.mod"]);
    // "build" from package.json and "make build" from the Makefile do not clash.
    expect(found?.suggestions.map((item) => item.name).filter((name) => name.endsWith("build"))).toEqual(["build", "make build", "go build"]);
    expect(new Set(found?.suggestions.map((item) => `${item.kind}:${item.name}`)).size).toBe(found?.suggestions.length);
  });

  it("ignores a file it cannot read", () => {
    const files: ProjectFiles = {
      exists: (filePath) => filePath === path.join(project, "Makefile"),
      read: () => {
        throw new Error("EACCES");
      },
    };

    expect(suggestProject(project, files, "linux")).toBeUndefined();
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { FormResult, RunFormOptions } from "../tui/form-view.js";
import type { ReviewOptions, ReviewResult } from "../tui/review-view.js";
import { runImportProjectFlow, runUpdateProjectFlow, type ProjectFlowStore } from "./project-flows.js";

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-project-flows-"));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

const baseFile = {
  version: 1,
  name: "shop",
  items: [
    { type: "service", name: "db", command: "docker compose up db" },
    { type: "service", name: "api", command: "npm run dev", after: ["db"] },
    { type: "command", name: "build", command: "npm run build" },
  ],
};

async function writeFile(value: unknown) {
  await fs.writeFile(path.join(directory, "sable.json"), JSON.stringify(value));
}

function createStore(config: AppConfig = { version: 2, workspaces: [] }): ProjectFlowStore & { saved?: AppConfig; saves: number } {
  return {
    saves: 0,
    async load() {
      return this.saved ?? config;
    },
    async save(next: AppConfig) {
      this.saved = next;
      this.saves += 1;
    },
  };
}

function noKeys(): KeyInput {
  return {
    async readKey() {
      throw new Error("No key was provided for this test.");
    },
    close() {},
  };
}

function reviewing(result: ReviewResult) {
  return vi.fn(async (_options: ReviewOptions) => result);
}

function answering(values: Record<string, string>) {
  return vi.fn(async (_options: RunFormOptions): Promise<FormResult> => ({ type: "submit", values }));
}

let ids = 0;
const generateId = ((prefix: string) => `${prefix}_${++ids}`) as never;

const reviewText = (review: ReturnType<typeof reviewing>, call = 0) => review.mock.calls[call]![0].lines.map((line) => line.text).join("\n");

describe("runImportProjectFlow", () => {
  it("says so when the folder has no sable.json or a broken one", async () => {
    const store = createStore();
    const missing = await runImportProjectFlow({ store, keyInput: noKeys(), directory });

    expect(missing).toEqual({ type: "back", message: expect.stringContaining("There is no sable.json") });

    await fs.writeFile(path.join(directory, "sable.json"), JSON.stringify({ version: 1, items: [{ type: "service", name: "a" }] }));

    const broken = await runImportProjectFlow({ store, keyInput: noKeys(), directory });

    expect(broken.type === "back" && broken.message).toContain("sable.json has problems:");
    expect(broken.type === "back" && broken.message).toContain("items.0.command");
    expect(store.saves).toBe(0);
  });

  it("shows exactly what would run and saves nothing when the user says not now", async () => {
    await writeFile(baseFile);
    const store = createStore();
    const review = reviewing("cancel");

    const result = await runImportProjectFlow({ store, keyInput: noKeys(), directory, review, generateId });

    expect(result).toEqual({ type: "back", message: "Nothing imported." });
    expect(store.saves).toBe(0);
    expect(reviewText(review)).toContain("docker compose up db");
    expect(reviewText(review)).toContain("• command build");
    expect(review.mock.calls[0]![0].confirmLabel).toBe("trust and import");
  });

  it("quits without saving when the user presses Ctrl+C", async () => {
    await writeFile(baseFile);
    const store = createStore();

    await expect(runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("exit"), generateId })).resolves.toEqual({ type: "exit" });
    expect(store.saves).toBe(0);
  });

  it("creates a workspace named in the file once the user agrees", async () => {
    await writeFile(baseFile);
    const store = createStore();
    const form = answering({});

    const result = await runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("confirm"), form, generateId });

    expect(result).toEqual({ type: "completed", message: 'Imported "shop" from sable.json: 2 services and 1 command.', workspaceId: expect.any(String) });
    expect(form).not.toHaveBeenCalled();

    const workspace = store.saved!.workspaces[0]!;

    expect(workspace).toMatchObject({ name: "shop", projectDirectory: directory });
    expect(workspace.items.map((item) => [item.name, item.fromProject])).toEqual([["db", "db"], ["api", "api"], ["build", "build"]]);
    expect(workspace.project?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the workspace after the folder when the file gives no name, and avoids a taken name", async () => {
    await writeFile({ ...baseFile, name: undefined });
    const store = createStore({ version: 2, workspaces: [{ id: "ws_old", name: path.basename(directory), projectDirectory: "/elsewhere", items: [] }] });

    await runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("confirm"), generateId });

    expect(store.saved!.workspaces.map((workspace) => workspace.name)).toEqual([path.basename(directory), `${path.basename(directory)}-2`]);
  });

  it("asks for the file's placeholders, offering defaults, and stores the answers", async () => {
    await writeFile({
      version: 1,
      name: "shop",
      placeholders: { API_PORT: { description: "Port for the API", default: "3000" }, TOKEN: {} },
      items: [{ type: "service", name: "api", command: "npm run dev -- --port {{API_PORT}}", env: { TOKEN: "{{TOKEN}}" } }],
    });
    const store = createStore();
    const form = answering({ name: "shop-dev", "value.API_PORT": "4000", "value.TOKEN": "abc" });
    const review = reviewing("confirm");

    await runImportProjectFlow({ store, keyInput: noKeys(), directory, review, form, generateId });

    const options = form.mock.calls[0]![0];

    expect(options.values).toEqual({ name: "shop", "value.API_PORT": "3000", "value.TOKEN": "" });
    expect(options.validate?.({ name: "shop", "value.API_PORT": "3000", "value.TOKEN": "" })).toEqual({ "value.TOKEN": "This one is required." });
    expect(options.validate?.({ name: "bad name", "value.API_PORT": "", "value.TOKEN": "x" })).toEqual({ name: "Use letters, numbers, dashes and underscores." });
    expect(reviewText(review)).toContain("npm run dev -- --port 3000");
    expect(reviewText(review)).toContain("{{TOKEN}}");

    const workspace = store.saved!.workspaces[0]!;

    expect(workspace.name).toBe("shop-dev");
    expect(workspace.items[0]).toMatchObject({ command: "npm run dev -- --port 4000", env: { TOKEN: "abc" } });
    expect(workspace.project?.values).toEqual({ API_PORT: "4000", TOKEN: "abc" });
  });

  it("does not let the form pick a name that is already taken", async () => {
    await writeFile({ version: 1, placeholders: { A: { default: "1" } }, items: [{ type: "service", name: "s", command: "x {{A}}" }] });
    const form = answering({});

    await runImportProjectFlow({
      store: createStore({ version: 2, workspaces: [{ id: "ws_old", name: "Taken", projectDirectory: "/elsewhere", items: [] }] }),
      keyInput: noKeys(),
      directory,
      review: reviewing("confirm"),
      form: form as never,
      generateId,
    });

    expect(form.mock.calls[0]![0].validate?.({ name: "taken", "value.A": "1" })).toEqual({ name: 'A workspace named "taken" already exists.' });
  });

  it("goes back from the form without saving", async () => {
    await writeFile({ version: 1, placeholders: { A: {} }, items: [{ type: "service", name: "s", command: "x {{A}}" }] });
    const store = createStore();
    const form = vi.fn(async (): Promise<FormResult> => ({ type: "back" }));

    await expect(runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("confirm"), form, generateId }))
      .resolves.toEqual({ type: "back", message: "Nothing imported." });
    expect(store.saves).toBe(0);
  });

  it("updates the workspace that is already linked to the folder instead of adding a second one", async () => {
    await writeFile(baseFile);
    const store = createStore();

    await runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("confirm"), generateId });
    await writeFile({ ...baseFile, items: [...baseFile.items, { type: "command", name: "seed", command: "npm run seed" }] });

    const review = reviewing("confirm");
    const result = await runImportProjectFlow({ store, keyInput: noKeys(), directory, review, generateId });

    expect(store.saved!.workspaces).toHaveLength(1);
    expect(reviewText(review)).toContain("+ new command seed");
    expect(result.type === "completed" && result.message).toBe('Updated "shop" from sable.json: 1 added.');
  });
});

describe("runUpdateProjectFlow", () => {
  async function imported() {
    await writeFile(baseFile);
    const store = createStore();

    await runImportProjectFlow({ store, keyInput: noKeys(), directory, review: reviewing("confirm"), generateId });

    return { store, workspace: store.saved!.workspaces[0]! };
  }

  it("does nothing for a workspace without a project file, or when the file is the same or gone", async () => {
    const { store, workspace } = await imported();
    const review = reviewing("confirm");

    await expect(runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review })).resolves.toEqual({ type: "unchanged" });
    await expect(runUpdateProjectFlow({ store, workspace: { ...workspace, project: undefined }, keyInput: noKeys(), review })).resolves.toEqual({ type: "unchanged" });

    await fs.rm(path.join(directory, "sable.json"));

    await expect(runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review })).resolves.toEqual({ type: "unchanged" });
    expect(review).not.toHaveBeenCalled();
  });

  it("shows what changed, and applies it only after the user agrees", async () => {
    const { store, workspace } = await imported();
    const saves = store.saves;

    await writeFile({ ...baseFile, items: baseFile.items.map((item) => item.name === "build" ? { ...item, command: "rm -rf ~" } : item) });

    const declined = reviewing("cancel");

    await expect(runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review: declined, generateId }))
      .resolves.toEqual({ type: "back", message: 'Kept "shop" as it was. Open it again to update.' });
    expect(store.saves).toBe(saves);
    expect(reviewText(declined)).toContain("~ changed command build");
    expect(reviewText(declined)).toContain("- run    npm run build");
    expect(reviewText(declined)).toContain("+ run    rm -rf ~");

    const result = await runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review: reviewing("confirm"), generateId });

    expect(result.type === "completed" && result.message).toBe('Updated "shop" from sable.json: 1 changed.');
    expect(store.saved!.workspaces[0]!.items.find((item) => item.name === "build")?.command).toBe("rm -rf ~");
  });

  it("keeps changes the user made on this machine", async () => {
    const { store, workspace } = await imported();
    const edited = { ...workspace, items: workspace.items.map((item) => item.name === "api" ? { ...item, command: "pnpm dev" } : item) };

    await store.save({ version: 2, workspaces: [edited] });
    await writeFile({ ...baseFile, items: baseFile.items.map((item) => item.name === "db" ? { ...item, command: "docker compose up -d db" } : item) });
    await runUpdateProjectFlow({ store, workspace: edited, keyInput: noKeys(), review: reviewing("confirm"), generateId });

    const items = store.saved!.workspaces[0]!.items;

    expect(items.find((item) => item.name === "api")?.command).toBe("pnpm dev");
    expect(items.find((item) => item.name === "db")?.command).toBe("docker compose up -d db");
  });

  it("asks only for placeholders that are new and have no default", async () => {
    const { store, workspace } = await imported();

    await writeFile({
      ...baseFile,
      placeholders: { REGION: {}, MODE: { default: "dev" } },
      items: [...baseFile.items, { type: "service", name: "cdn", command: "serve --region {{REGION}} --mode {{MODE}}" }],
    });

    const form = answering({ "value.REGION": "eu" });
    const result = await runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review: reviewing("confirm"), form, generateId });

    expect(form.mock.calls[0]![0].fields({}).map((field) => field.key)).toEqual(["value.REGION"]);
    expect(result.type).toBe("completed");
    expect(store.saved!.workspaces[0]!.items.find((item) => item.name === "cdn")?.command).toBe("serve --region eu --mode dev");
    expect(store.saved!.workspaces[0]!.project?.values).toEqual({ REGION: "eu" });
  });

  it("quietly records a harmless change to the file without a review", async () => {
    const { store, workspace } = await imported();
    const review = reviewing("confirm");

    await writeFile({ ...baseFile, placeholders: { UNUSED: { default: "x", description: "not used by any item" } } });

    const result = await runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review, generateId });

    expect(review).not.toHaveBeenCalled();
    expect(result.type === "completed" && result.message).toContain("nothing to change");
    await expect(runUpdateProjectFlow({ store, workspace: store.saved!.workspaces[0]!, keyInput: noKeys(), review })).resolves.toEqual({ type: "unchanged" });
  });

  it("explains a file that has become invalid and leaves the workspace alone", async () => {
    const { store, workspace } = await imported();
    const saves = store.saves;

    await fs.writeFile(path.join(directory, "sable.json"), "{ nope");

    const result = await runUpdateProjectFlow({ store, workspace, keyInput: noKeys(), review: reviewing("confirm") });

    expect(result.type === "back" && result.message).toContain("not valid JSON");
    expect(store.saves).toBe(saves);
  });
});

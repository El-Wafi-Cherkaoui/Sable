import { describe, expect, it, vi } from "vitest";
import type { AppConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { FormResult, RunFormOptions } from "../tui/form-view.js";
import type { MissingSecretsChoice } from "../tui/missing-secrets-dialog.js";
import type { RunWorkspaceController } from "./run-workspace.js";
import { runSecretsFlow } from "./secrets-flow.js";
import type { ServiceFlowResult } from "./service-flows.js";

const noKeys: KeyInput = { readKey: async () => { throw new Error("no keys"); }, close() {} };

function itemWith(secrets: string[] | undefined, env: Record<string, string> = {}): ServiceConfig {
  return { kind: "service", id: "svc_api", name: "api", command: "npm run dev", cwd: "/p", autoStart: true, env, after: [], ...(secrets === undefined ? {} : { secrets }) };
}

function setup(item: ServiceConfig) {
  const workspace: WorkspaceConfig = { id: "ws", name: "shop", projectDirectory: "/p", items: [item] };
  let config: AppConfig = { version: 2, workspaces: [workspace] };
  const store = {
    async load() { return config; },
    save: vi.fn(async (next: AppConfig) => { config = next; }),
  };
  const controller = { updateItem: vi.fn() } as unknown as RunWorkspaceController & { updateItem: ReturnType<typeof vi.fn> };

  return { workspace, store, controller, saved: () => config.workspaces[0]!.items[0]! };
}

const choosing = (choice: MissingSecretsChoice) => vi.fn(async (_options: { itemName: string; missing: string[] }) => choice);
const answering = (values: Record<string, string>) => vi.fn(async (_options: RunFormOptions): Promise<FormResult> => ({ type: "submit", values }));

describe("runSecretsFlow", () => {
  it("is ready at once, without asking, when nothing is missing or nothing was ever marked", async () => {
    for (const item of [itemWith(["TOKEN"], { TOKEN: "abc" }), itemWith([]), itemWith(undefined)]) {
      const { workspace, store, controller } = setup(item);
      const dialog = choosing("fill");

      await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog })).resolves.toEqual({ type: "ready" });
      expect(dialog).not.toHaveBeenCalled();
    }
  });

  it("names the item and the missing variables in the question", async () => {
    const { workspace, store, controller } = setup(itemWith(["STRIPE_KEY", "DATABASE_URL"], { DATABASE_URL: "" }));
    const dialog = choosing("cancel");

    await runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog });

    expect(dialog.mock.calls[0]![0]).toMatchObject({ itemName: "api", missing: ["STRIPE_KEY", "DATABASE_URL"] });
  });

  it("asks for each missing value with hidden input, saves them on this machine, and tells the controller", async () => {
    const { workspace, store, controller, saved } = setup(itemWith(["STRIPE_KEY", "TOKEN"], { PORT: "3000" }));
    const form = answering({ STRIPE_KEY: " sk_live_123 ", TOKEN: "abc" });

    const result = await runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("fill"), form });
    const asked = form.mock.calls[0]![0];

    expect(result).toEqual({ type: "ready" });
    expect(asked.fields({}).map((field) => [field.key, "secret" in field ? field.secret : undefined])).toEqual([["STRIPE_KEY", true], ["TOKEN", true]]);
    expect(asked.validate?.({ STRIPE_KEY: "", TOKEN: "abc" })).toEqual({ STRIPE_KEY: "Type a value, or press Esc to cancel." });
    expect(saved().env).toEqual({ PORT: "3000", STRIPE_KEY: "sk_live_123", TOKEN: "abc" });
    expect(saved().secrets).toEqual(["STRIPE_KEY", "TOKEN"]);
    expect(controller.updateItem).toHaveBeenCalledWith(expect.objectContaining({ env: { PORT: "3000", STRIPE_KEY: "sk_live_123", TOKEN: "abc" } }));
  });

  it("leaves everything alone when the user backs out of the question or the form", async () => {
    const { workspace, store, controller } = setup(itemWith(["TOKEN"]));

    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("cancel") }))
      .resolves.toEqual({ type: "cancelled", message: '"api" was not started: it needs TOKEN.' });
    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("fill"), form: vi.fn(async () => ({ type: "back" as const })) }))
      .resolves.toEqual({ type: "cancelled", message: '"api" was not started.' });
    expect(store.save).not.toHaveBeenCalled();
    expect(controller.updateItem).not.toHaveBeenCalled();
  });

  it("quits Sable when the user presses Ctrl+C on the question or the form", async () => {
    const { workspace, store, controller } = setup(itemWith(["TOKEN"]));

    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("exit") })).resolves.toEqual({ type: "exit" });
    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("fill"), form: vi.fn(async () => ({ type: "exit" as const })) })).resolves.toEqual({ type: "exit" });
  });

  it("opens the whole item to edit, and is ready if that fixed it", async () => {
    const { workspace, store, controller, saved } = setup(itemWith(["TOKEN"]));
    const editItem = vi.fn(async (): Promise<ServiceFlowResult> => {
      await store.save({ version: 2, workspaces: [{ ...workspace, items: [itemWith([], {})] }] });

      return { type: "completed", message: "Saved service \"api\".", itemId: "svc_api" };
    });

    const result = await runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("edit"), editItem });

    expect(editItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: "svc_api" }));
    expect(result).toEqual({ type: "ready" });
    expect(controller.updateItem).toHaveBeenCalledWith(saved());
  });

  it("does not start it when the edit leaves a secret missing, or is cancelled", async () => {
    const { workspace, store, controller } = setup(itemWith(["TOKEN"]));
    const untouched = vi.fn(async (): Promise<ServiceFlowResult> => ({ type: "back", message: "Edit cancelled." }));

    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("edit"), editItem: untouched }))
      .resolves.toEqual({ type: "cancelled", message: '"api" was not started: it still needs TOKEN.' });
    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("edit"), editItem: vi.fn(async (): Promise<ServiceFlowResult> => ({ type: "exit" })) }))
      .resolves.toEqual({ type: "exit" });
  });

  it("copes with the item having been removed meanwhile", async () => {
    const { workspace, store, controller } = setup(itemWith(["TOKEN"]));
    const form = vi.fn(async (): Promise<FormResult> => {
      await store.save({ version: 2, workspaces: [{ ...workspace, items: [] }] });

      return { type: "submit", values: { TOKEN: "abc" } };
    });

    await expect(runSecretsFlow({ store, workspace, itemId: "svc_api", controller, keyInput: noKeys, dialog: choosing("fill"), form }))
      .resolves.toEqual({ type: "cancelled", message: "That item no longer exists." });
  });
});

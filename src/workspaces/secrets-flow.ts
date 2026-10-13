import type { AppConfig, ItemConfig, WorkspaceConfig } from "../config/config-types.js";
import { findItem, missingSecretsOf, replaceItem } from "../config/workspace-items.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runForm, type FormField } from "../tui/form-view.js";
import { runMissingSecretsDialog } from "../tui/missing-secrets-dialog.js";
import type { PromptScreen } from "../tui/prompt-view.js";
import type { RunWorkspaceController } from "./run-workspace.js";
import { runEditItemFlow } from "./service-flows.js";

export type SecretsFlowResult =
  // Every secret is set: the caller can start the item.
  | { type: "ready" }
  | { type: "cancelled"; message: string }
  | { type: "exit" };

export type SecretsFlowOptions = {
  store: { load(): Promise<AppConfig>; save(config: AppConfig): Promise<void> };
  workspace: WorkspaceConfig;
  itemId: string;
  controller: RunWorkspaceController;
  keyInput: KeyInput;
  screen?: PromptScreen;
  background?: string;
  dialog?: typeof runMissingSecretsDialog;
  form?: typeof runForm;
  editItem?: typeof runEditItemFlow;
};

// An item cannot start without the secret variables it names. This tells the user which are missing and lets
// them type the values right here (hidden, and saved only on this machine), or open the whole item to change
// the approach, for example to point it at another command or another configuration.
export async function runSecretsFlow(options: SecretsFlowOptions): Promise<SecretsFlowResult> {
  const current = await loadItem(options);

  if (current === undefined || missingSecretsOf(current).length === 0) {
    return { type: "ready" };
  }

  const missing = missingSecretsOf(current);
  const choice = await (options.dialog ?? runMissingSecretsDialog)({
    itemName: current.name,
    missing,
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });

  if (choice === "exit") return { type: "exit" };
  if (choice === "cancel") return { type: "cancelled", message: `"${current.name}" was not started: it needs ${missing.join(", ")}.` };

  if (choice === "edit") {
    const edited = await (options.editItem ?? runEditItemFlow)({
      store: options.store,
      workspace: options.workspace,
      keyInput: options.keyInput,
      itemId: options.itemId,
      screen: options.screen,
    });

    if (edited.type === "exit") return { type: "exit" };

    const after = await loadItem(options);

    if (after !== undefined) {
      options.controller.updateItem(after);
    }

    return after !== undefined && missingSecretsOf(after).length === 0
      ? { type: "ready" }
      : { type: "cancelled", message: `"${current.name}" was not started: it still needs ${missingSecretsOf(after ?? current).join(", ")}.` };
  }

  const fields: FormField[] = missing.map((key) => ({ type: "text", key, label: key, secret: true, hint: "Kept on this machine only" }));
  const answered = await (options.form ?? runForm)({
    title: `Set the secrets for "${current.name}"`,
    subtitle: "typed values are hidden",
    fields: () => fields,
    values: Object.fromEntries(missing.map((key) => [key, ""])),
    validate: (values) => Object.fromEntries(missing.filter((key) => String(values[key] ?? "").trim() === "").map((key) => [key, "Type a value, or press Esc to cancel."])),
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (answered.type === "exit") return { type: "exit" };
  if (answered.type === "back") return { type: "cancelled", message: `"${current.name}" was not started.` };

  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
  const stored = workspace === undefined ? undefined : findItem(workspace, options.itemId);

  if (workspace === undefined || stored === undefined) {
    return { type: "cancelled", message: "That item no longer exists." };
  }

  const updated: ItemConfig = {
    ...stored,
    env: { ...stored.env, ...Object.fromEntries(missing.map((key) => [key, String(answered.values[key] ?? "").trim()])) },
  };

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) => candidate.id === workspace.id ? replaceItem(candidate, updated) : candidate),
  });
  options.controller.updateItem(updated);

  return { type: "ready" };
}

async function loadItem(options: SecretsFlowOptions): Promise<ItemConfig | undefined> {
  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);

  return workspace === undefined ? undefined : findItem(workspace, options.itemId);
}

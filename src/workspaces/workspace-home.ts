import path from "node:path";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import {
  runWorkspacePicker,
  type RunWorkspacePickerOptions,
  type WorkspacePickerResult,
} from "../tui/workspace-picker.js";
import type { ShutdownFailure } from "../controller/workspace-controller.js";
import {
  createRunWorkspaceController,
  reportShutdownFailures,
  runWorkspaceSession,
  shutdownSignals,
  type RunWorkspaceController,
  type RunWorkspaceSessionOptions,
  type ShutdownWarn,
} from "./run-workspace.js";
import {
  runCreateWorkspaceFlow,
  type CreateWorkspaceFlowOptions,
  type CreateWorkspaceFlowResult,
} from "./create-workspace-flow.js";
import {
  runDeleteWorkspaceFlow,
  type DeleteWorkspaceFlowOptions,
  type DeleteWorkspaceFlowResult,
} from "./delete-workspace-flow.js";
import {
  runRenameWorkspaceFlow,
  type RenameWorkspaceFlowOptions,
  type RenameWorkspaceFlowResult,
} from "./rename-workspace-flow.js";
import type { SettingsControl } from "../settings/settings-control.js";
import type { SoundControl } from "../sound/sound-control.js";
import { runUpdateDialog } from "../tui/update-dialog.js";
import { runSuggestServicesFlow, type SuggestServicesFlowOptions, type SuggestServicesFlowResult } from "./suggest-services-flow.js";
import { servicesOf } from "../config/workspace-items.js";
import { readProjectFile } from "../project/project-file.js";
import { runExportProjectFlow, runImportProjectFlow, runUpdateProjectFlow, type ProjectFlowOptions, type ProjectFlowResult } from "./project-flows.js";
import { runtimeServices } from "../runtime/runtime-state.js";

export type WorkspaceHomeConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

// How long the welcome screen stays up (any key skips it).
const welcomeScreenMs = 1_800;

export type RunWorkspaceHomeOptions = {
  store: WorkspaceHomeConfigStore;
  keyInput?: KeyInput;
  runPicker?: (options: RunWorkspacePickerOptions) => Promise<WorkspacePickerResult>;
  runSession?: (options: RunWorkspaceSessionOptions) => Promise<{ type: "back" } | { type: "exit" }>;
  runCreateWorkspace?: (options: CreateWorkspaceFlowOptions) => Promise<CreateWorkspaceFlowResult>;
  runDeleteWorkspace?: (options: DeleteWorkspaceFlowOptions) => Promise<DeleteWorkspaceFlowResult>;
  runRenameWorkspace?: (options: RenameWorkspaceFlowOptions) => Promise<RenameWorkspaceFlowResult>;
  runSuggestServices?: (options: SuggestServicesFlowOptions) => Promise<SuggestServicesFlowResult>;
  // The folder Sable was started in. A sable.json there is offered for import at launch, and the `i` key imports it.
  launchDirectory?: string;
  readProjectFile?: typeof readProjectFile;
  runImportProject?: (options: ProjectFlowOptions & { directory: string }) => Promise<ProjectFlowResult>;
  runUpdateProject?: (options: ProjectFlowOptions & { workspace: WorkspaceConfig }) => Promise<ProjectFlowResult>;
  runExportProject?: (options: ProjectFlowOptions & { workspace: WorkspaceConfig }) => Promise<ProjectFlowResult>;
  update?: WorkspaceHomeUpdate;
  screen?: RunWorkspacePickerOptions["screen"];
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  sound?: SoundControl;
  settings?: SettingsControl;
  // Show the welcome screen at launch (default); off goes straight to the workspace list.
  welcomeScreen?: boolean;
  signalSource?: WorkspaceHomeSignalSource;
  warn?: ShutdownWarn;
};

export type WorkspaceHomeUpdate = {
  latestVersion(): string | undefined;
  currentVersion: string;
  installCommand: string;
  dismiss(version: string): Promise<void>;
  dialog?: typeof runUpdateDialog;
};

export type WorkspaceHomeResult = { type: "quit" } | { type: "update"; version: string };

export type WorkspaceHomeSignalSource = {
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export async function runWorkspaceHome(
  options: RunWorkspaceHomeOptions,
): Promise<WorkspaceHomeResult> {
  const keyInput = options.keyInput ?? new TerminalKeyInput();
  const runPicker = options.runPicker ?? runWorkspacePicker;
  const runSession = options.runSession ?? runWorkspaceSession;
  const createWorkspace = options.runCreateWorkspace ?? runCreateWorkspaceFlow;
  const deleteWorkspace = options.runDeleteWorkspace ?? runDeleteWorkspaceFlow;
  const renameWorkspace = options.runRenameWorkspace ?? runRenameWorkspaceFlow;
  const suggestServices = options.runSuggestServices ?? runSuggestServicesFlow;
  const importProject = options.runImportProject ?? runImportProjectFlow;
  const updateProject = options.runUpdateProject ?? runUpdateProjectFlow;
  const exportProject = options.runExportProject ?? runExportProjectFlow;
  const probeProjectFile = options.readProjectFile ?? readProjectFile;
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
  let statusMessage: string | undefined;
  let selectedWorkspaceId: string | undefined;
  let shouldShowStartupMoment = true;
  // Set after creating a workspace, so it opens directly instead of returning to the picker.
  let workspaceToOpen: { id: string; message: string } | undefined;
  let activeSession: { workspaceId: string; controller: RunWorkspaceController } | undefined;
  // Processes that failed to stop are reported once Sable leaves the TUI.
  const shutdownFailures: ShutdownFailure[] = [];
  const abortShutdown = () => shutdownAbortController.abort();
  const createController = options.createController
    ?? ((workspace: WorkspaceConfig) => createRunWorkspaceController(workspace, { sound: options.sound }));

  for (const signal of shutdownSignals) {
    signalSource.once(signal, abortShutdown);
  }

  const projectFlowOptions = { store: options.store, keyInput, screen: options.screen };

  async function hasProjectFile(directory: string | undefined): Promise<boolean> {
    return directory !== undefined && (await probeProjectFile(directory)).type !== "missing";
  }

  // At launch: a sable.json in this folder with no workspace of its own is offered for import, and a
  // workspace already linked to it is checked for changes. A workspace made by hand for the folder is left alone.
  async function checkLaunchDirectory(directory: string): Promise<{ type: "exit" } | { type: "done"; message?: string; workspaceId?: string }> {
    const found = await probeProjectFile(directory);

    if (found.type === "missing") {
      return { type: "done" };
    }

    if (found.type === "invalid") {
      return { type: "done", message: found.message.split("\n").slice(0, 2).join(" ").replace(/\s+/g, " ") };
    }

    const config = await options.store.load();
    const here = config.workspaces.filter((workspace) => sameFolder(workspace.projectDirectory, directory));
    const linked = here.find((workspace) => workspace.project !== undefined);

    if (linked === undefined && here.length > 0) {
      return { type: "done" };
    }

    let flowResult: ProjectFlowResult;

    try {
      flowResult = linked === undefined
        ? await importProject({ ...projectFlowOptions, directory })
        : await updateProject({ ...projectFlowOptions, workspace: linked });
    } catch (error) {
      return { type: "done", message: configUpdateFailedMessage(error) };
    }

    if (flowResult.type === "exit") {
      return { type: "exit" };
    }

    return {
      type: "done",
      ...(flowResult.type === "unchanged" ? {} : { message: flowResult.message }),
      ...(flowResult.type === "completed" ? { workspaceId: flowResult.workspaceId } : {}),
    };
  }


  try {
    if (options.launchDirectory !== undefined) {
      const launch = await checkLaunchDirectory(options.launchDirectory);

      if (launch.type === "exit") {
        return { type: "quit" };
      }

      statusMessage = launch.message;
      selectedWorkspaceId = launch.workspaceId;
    }

    while (!shutdownAbortController.signal.aborted) {
      const config = await options.store.load();
      const opening = workspaceToOpen === undefined
        ? undefined
        : config.workspaces.find((workspace) => workspace.id === workspaceToOpen!.id);
      const openingMessage = workspaceToOpen?.message;

      workspaceToOpen = undefined;

      const pickerResult: WorkspacePickerResult = opening !== undefined ? { type: "run", workspace: opening } : await runPicker({
        workspaces: config.workspaces,
        keyInput,
        sound: options.sound,
        settings: options.settings,
        projectFileHere: (await hasProjectFile(options.launchDirectory)) || undefined,
        abortSignal: shutdownAbortController.signal,
        statusMessage,
        selectedWorkspaceId,
        activeWorkspaceId: activeSession?.workspaceId,
        activeRunningServiceCount: activeSession === undefined ? undefined : runtimeServices(activeSession.controller.getState())
          .filter((serviceState) => serviceState.process.status === "running").length,
        startupMomentMs: shouldShowStartupMoment && options.welcomeScreen !== false ? welcomeScreenMs : 0,
        afterStartup: options.update === undefined || !shouldShowStartupMoment ? undefined : () => showUpdatePopup(options.update!, keyInput, options.screen),
        screen: options.screen,
      });

      shouldShowStartupMoment = false;

      if (pickerResult.type === "exit") {
        return { type: "quit" };
      }

      if (pickerResult.type === "update") {
        const version = options.update?.latestVersion();

        if (version !== undefined) {
          return { type: "update", version };
        }

        continue;
      }

      if (pickerResult.type === "createWorkspace") {
        let flowResult: CreateWorkspaceFlowResult;

        try {
          flowResult = await createWorkspace({
            store: options.store,
            keyInput,
            screen: options.screen,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = undefined;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : undefined;

        if (flowResult.type === "completed") {
          let suggestion: SuggestServicesFlowResult;

          try {
            suggestion = await suggestServices({ store: options.store, workspaceId: flowResult.workspaceId, keyInput, screen: options.screen });
          } catch (error) {
            suggestion = { type: "skipped" };
            statusMessage = configUpdateFailedMessage(error);
          }

          if (suggestion.type === "exit") {
            return { type: "quit" };
          }

          workspaceToOpen = {
            id: flowResult.workspaceId,
            message: suggestion.type === "added" ? suggestion.message : `${flowResult.message} Press a to add a service.`,
          };
        }

        continue;
      }

      if (pickerResult.type === "importProject") {
        const directory = options.launchDirectory ?? process.cwd();
        let flowResult: ProjectFlowResult;

        try {
          flowResult = await importProject({ ...projectFlowOptions, directory });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.type === "unchanged" ? "sable.json is already up to date." : flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : undefined;

        continue;
      }

      if (pickerResult.type === "exportProject") {
        let flowResult: ProjectFlowResult;

        try {
          flowResult = await exportProject({ ...projectFlowOptions, workspace: pickerResult.workspace });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.type === "unchanged" ? undefined : flowResult.message;
        selectedWorkspaceId = pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "deleteWorkspace") {
        if (activeSession?.workspaceId === pickerResult.workspace.id) {
          statusMessage = `Stop workspace "${pickerResult.workspace.name}" before deleting it.`;
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        let flowResult: DeleteWorkspaceFlowResult;

        try {
          flowResult = await deleteWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            keyInput,
            screen: options.screen,
            background: pickerResult.background,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.selectedWorkspaceId : undefined;

        continue;
      }

      if (pickerResult.type === "renameWorkspace") {
        let flowResult: RenameWorkspaceFlowResult;

        try {
          flowResult = await renameWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            keyInput,
            screen: options.screen,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "reorderWorkspace") {
        try {
          const result = await reorderWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            index: pickerResult.index,
          });

          statusMessage = result.message;
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
        }

        selectedWorkspaceId = pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "stopActiveWorkspace") {
        if (activeSession === undefined) {
          statusMessage = "No workspace is running.";
        } else if (activeSession.workspaceId !== pickerResult.workspace.id) {
          statusMessage = "Select the running workspace to stop it.";
        } else {
          const failures = await activeSession.controller.shutdown();

          shutdownFailures.push(...failures);
          activeSession = undefined;
          statusMessage = `Stopped workspace "${pickerResult.workspace.name}".${formatLingeringProcesses(failures)}`;
        }

        selectedWorkspaceId = pickerResult.workspace.id;
        continue;
      }

      if (pickerResult.type === "restartActiveWorkspace") {
        if (activeSession === undefined) {
          statusMessage = "No workspace is running.";
        } else if (activeSession.workspaceId !== pickerResult.workspace.id) {
          statusMessage = "Select the running workspace to restart it.";
        } else {
          const restarted = await restartActiveSession({
            workspace: pickerResult.workspace,
            controller: activeSession.controller,
            createController,
          });

          shutdownFailures.push(...restarted.failures);
          activeSession = restarted.session;
          statusMessage = `Restarted workspace "${pickerResult.workspace.name}".${formatLingeringProcesses(restarted.failures)}`;
        }

        selectedWorkspaceId = pickerResult.workspace.id;
        continue;
      }

      let openedWorkspace = pickerResult.workspace;
      let sessionMessage = openingMessage;

      // A workspace set up from a sable.json is checked against the file every time it is opened,
      // unless it is already running (its settings are not swapped underneath it).
      if (openedWorkspace.project !== undefined && activeSession?.workspaceId !== openedWorkspace.id) {
        let flowResult: ProjectFlowResult;

        try {
          flowResult = await updateProject({ ...projectFlowOptions, workspace: openedWorkspace });
        } catch (error) {
          flowResult = { type: "back", message: configUpdateFailedMessage(error) };
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        if (flowResult.type === "completed") {
          openedWorkspace = (await options.store.load()).workspaces.find((workspace) => workspace.id === openedWorkspace.id) ?? openedWorkspace;
        }

        if (flowResult.type !== "unchanged") {
          sessionMessage = flowResult.message;
        }
      }

      let shouldStartAutoStartServices = false;

      if (activeSession !== undefined && activeSession.workspaceId !== openedWorkspace.id) {
        shutdownFailures.push(...await activeSession.controller.shutdown());
        activeSession = undefined;
      }

      if (activeSession === undefined) {
        activeSession = {
          workspaceId: openedWorkspace.id,
          controller: createController(openedWorkspace),
        };
        shouldStartAutoStartServices = true;
      }

      const sessionResult = await runSession({
        workspace: openedWorkspace,
        controller: activeSession.controller,
        keyInput,
        sound: options.sound,
        settings: options.settings,
        abortSignal: shutdownAbortController.signal,
        dashboardQuitLabel: "back",
        store: options.store,
        startAutoStartServices: shouldStartAutoStartServices,
        shutdownOnReturn: false,
        initialMessage: sessionMessage,
      });

      statusMessage = undefined;
      selectedWorkspaceId = pickerResult.workspace.id;

      if (sessionResult.type === "exit") {
        return { type: "quit" };
      }
    }

    return { type: "quit" };
  } finally {
    if (activeSession !== undefined) {
      shutdownFailures.push(...await activeSession.controller.shutdown());
    }

    for (const signal of shutdownSignals) {
      signalSource.off(signal, abortShutdown);
    }
    keyInput.close();
    reportShutdownFailures(shutdownFailures, options.warn);
  }
}

function sameFolder(left: string, right: string): boolean {
  const normalize = (value: string) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));

  return normalize(left) === normalize(right);
}

function formatLingeringProcesses(failures: ShutdownFailure[]): string {
  if (failures.length === 0) {
    return "";
  }

  return ` Still running: ${failures.map((failure) => failure.name).join(", ")}.`;
}

async function showUpdatePopup(
  update: WorkspaceHomeUpdate,
  keyInput: KeyInput,
  screen: RunWorkspaceHomeOptions["screen"],
): Promise<"continue" | "update" | "exit"> {
  const version = update.latestVersion();

  if (version === undefined) {
    return "continue";
  }

  const choice = await (update.dialog ?? runUpdateDialog)({
    latestVersion: version,
    currentVersion: update.currentVersion,
    installCommand: update.installCommand,
    keyInput,
    screen,
  });

  if (choice === "ok") {
    await update.dismiss(version);
    return "continue";
  }

  return choice;
}

function configUpdateFailedMessage(error: unknown): string {
  return `Could not update config: ${error instanceof Error ? error.message : String(error)}`;
}

type RestartActiveSessionOptions = {
  workspace: WorkspaceConfig;
  controller: RunWorkspaceController;
  createController: (workspace: WorkspaceConfig) => RunWorkspaceController;
};

async function restartActiveSession(
  options: RestartActiveSessionOptions,
): Promise<{
  session: { workspaceId: string; controller: RunWorkspaceController };
  failures: ShutdownFailure[];
}> {
  const state = options.controller.getState();
  const runningServiceIds = new Set(
    runtimeServices(state)
      .filter((serviceState) => serviceState.process.status === "running")
      .map((serviceState) => serviceState.item.id),
  );

  for (const service of servicesOf(options.workspace)) {
    if (service.autoStart) {
      runningServiceIds.add(service.id);
    }
  }

  // One-shot commands are not re-run: repeating something like a migration
  // is rarely what a restart should do.
  const failures = await options.controller.shutdown();
  const controller = options.createController(options.workspace);

  await controller.startPlan([...runningServiceIds]);

  return { session: { workspaceId: options.workspace.id, controller }, failures };
}


type ReorderWorkspaceOptions = {
  store: WorkspaceHomeConfigStore;
  workspace: WorkspaceConfig;
  index: number;
};

async function reorderWorkspace(options: ReorderWorkspaceOptions): Promise<{ message: string }> {
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex((workspace) => workspace.id === options.workspace.id);

  if (workspaceIndex < 0) {
    return { message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const targetIndex = Math.min(Math.max(options.index, 0), config.workspaces.length - 1);
  const nextWorkspaces = [...config.workspaces];
  const [workspace] = nextWorkspaces.splice(workspaceIndex, 1);

  nextWorkspaces.splice(targetIndex, 0, workspace!);

  await options.store.save({
    ...config,
    workspaces: nextWorkspaces,
  });

  return { message: `Moved workspace "${workspace!.name}".` };
}

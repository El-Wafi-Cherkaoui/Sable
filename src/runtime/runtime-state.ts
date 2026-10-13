import type { CommandConfig, ItemConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState } from "../process/process-manager.js";
import { commandsOf, servicesOf } from "../config/workspace-items.js";

// Set while a start-all plan holds an item back, or after it gave up on the item.
export type RuntimeQueueState =
  | { status: "waiting"; for: string[] }
  | { status: "skipped"; reason: string };

export type RuntimeItemState = {
  item: ItemConfig;
  process: ManagedProcessState;
  queue?: RuntimeQueueState;
};

export type RuntimeServiceState = RuntimeItemState & { item: ServiceConfig };

export type RuntimeCommandState = RuntimeItemState & { item: CommandConfig };

export type RuntimeWorkspaceState = {
  workspace: {
    id: string;
    name: string;
    projectDirectory?: string;
  };
  // Services first, then commands: the order the dashboard shows and the arrow keys walk.
  items: RuntimeItemState[];
  itemIndexById: Record<string, number>;
  selectedItemIndex: number | undefined;
};

const stoppedProcessState: ManagedProcessState = { status: "stopped" };

export function createRuntimeState(
  workspace: WorkspaceConfig,
): RuntimeWorkspaceState {
  const items = [...servicesOf(workspace), ...commandsOf(workspace)].map(toItemState);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      projectDirectory: workspace.projectDirectory,
    },
    items,
    itemIndexById: createItemIndexById(items),
    selectedItemIndex: items.length > 0 ? 0 : undefined,
  };
}

export function runtimeServices(state: RuntimeWorkspaceState): RuntimeServiceState[] {
  return state.items.filter((itemState): itemState is RuntimeServiceState => itemState.item.kind === "service");
}

export function runtimeCommands(state: RuntimeWorkspaceState): RuntimeCommandState[] {
  return state.items.filter((itemState): itemState is RuntimeCommandState => itemState.item.kind === "command");
}

export function getSelectedItem(state: RuntimeWorkspaceState): RuntimeItemState | undefined {
  return state.selectedItemIndex === undefined ? undefined : state.items[state.selectedItemIndex];
}

export function getSelectedService(state: RuntimeWorkspaceState): RuntimeServiceState | undefined {
  const selected = getSelectedItem(state);

  return selected?.item.kind === "service" ? (selected as RuntimeServiceState) : undefined;
}

export function getSelectedCommand(state: RuntimeWorkspaceState): RuntimeCommandState | undefined {
  const selected = getSelectedItem(state);

  return selected?.item.kind === "command" ? (selected as RuntimeCommandState) : undefined;
}

export function selectNextItem(state: RuntimeWorkspaceState): RuntimeWorkspaceState {
  return selectByOffset(state, 1);
}

export function selectPreviousItem(state: RuntimeWorkspaceState): RuntimeWorkspaceState {
  return selectByOffset(state, -1);
}

export function updateProcessState(
  state: RuntimeWorkspaceState,
  itemId: string,
  processState: ManagedProcessState,
): RuntimeWorkspaceState {
  const index = state.itemIndexById[itemId];

  if (index === undefined) {
    return state;
  }

  return {
    ...state,
    items: state.items.map((itemState, itemIndex) =>
      itemIndex === index ? { ...itemState, process: processState } : itemState,
    ),
  };
}

export function setQueueStateInRuntimeState(
  state: RuntimeWorkspaceState,
  itemId: string,
  queue: RuntimeQueueState | undefined,
): RuntimeWorkspaceState {
  const index = state.itemIndexById[itemId];

  if (index === undefined) {
    return state;
  }

  return {
    ...state,
    items: state.items.map((itemState, itemIndex) => {
      if (itemIndex !== index) {
        return itemState;
      }

      const next: RuntimeItemState = { ...itemState };

      if (queue === undefined) {
        delete next.queue;
      } else {
        next.queue = queue;
      }

      return next;
    }),
  };
}

export function updateItemConfigInRuntimeState(
  state: RuntimeWorkspaceState,
  item: ItemConfig,
): RuntimeWorkspaceState {
  const index = state.itemIndexById[item.id];

  if (index === undefined) {
    return state;
  }

  return {
    ...state,
    items: state.items.map((itemState, itemIndex) =>
      itemIndex === index ? { ...itemState, item } : itemState,
    ),
  };
}

// A new service goes after the last service and a new command at the end, and it becomes the selection.
export function addItemToRuntimeState(
  state: RuntimeWorkspaceState,
  item: ItemConfig,
): RuntimeWorkspaceState {
  if (state.itemIndexById[item.id] !== undefined) {
    return state;
  }

  const insertAt = item.kind === "service" ? runtimeServices(state).length : state.items.length;
  const items = [...state.items.slice(0, insertAt), toItemState(item), ...state.items.slice(insertAt)];

  return {
    ...state,
    items,
    itemIndexById: createItemIndexById(items),
    selectedItemIndex: insertAt,
  };
}

// After a removal the selection goes to a service if any are left, else to a command, staying near where it was.
export function removeItemFromRuntimeState(
  state: RuntimeWorkspaceState,
  itemId: string,
): RuntimeWorkspaceState {
  const index = state.itemIndexById[itemId];

  if (index === undefined) {
    return state;
  }

  const selectedService = getSelectedService(state);
  const selectedCommand = getSelectedCommand(state);
  const previousServicePosition = selectedService === undefined ? 0 : runtimeServices(state).indexOf(selectedService);
  const previousCommandPosition = selectedCommand === undefined ? 0 : runtimeCommands(state).indexOf(selectedCommand);
  // Items that waited for the removed one stop waiting for it, as in the saved config.
  const items = state.items
    .filter((_, itemIndex) => itemIndex !== index)
    .map((itemState) => itemState.item.after.includes(itemId)
      ? { ...itemState, item: { ...itemState.item, after: itemState.item.after.filter((id) => id !== itemId) } }
      : itemState);
  const serviceCount = items.filter((itemState) => itemState.item.kind === "service").length;
  const commandCount = items.length - serviceCount;

  return {
    ...state,
    items,
    itemIndexById: createItemIndexById(items),
    selectedItemIndex: serviceCount > 0
      ? Math.min(previousServicePosition, serviceCount - 1)
      : commandCount > 0
        ? Math.min(previousCommandPosition, commandCount - 1)
        : undefined,
  };
}

// Swaps a service with the one above or below it; the selection follows the moved service.
export function moveServiceInRuntimeState(
  state: RuntimeWorkspaceState,
  serviceId: string,
  direction: "up" | "down",
): RuntimeWorkspaceState {
  const index = state.itemIndexById[serviceId];

  if (index === undefined || state.items[index]?.item.kind !== "service") {
    return state;
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || state.items[targetIndex]?.item.kind !== "service") {
    return state;
  }

  const items = [...state.items];

  [items[index], items[targetIndex]] = [items[targetIndex]!, items[index]!];

  return {
    ...state,
    items,
    itemIndexById: createItemIndexById(items),
    selectedItemIndex: targetIndex,
  };
}

function toItemState(item: ItemConfig): RuntimeItemState {
  return { item, process: stoppedProcessState };
}

function createItemIndexById(items: RuntimeItemState[]): Record<string, number> {
  return Object.fromEntries(items.map((itemState, index) => [itemState.item.id, index]));
}

function selectByOffset(state: RuntimeWorkspaceState, offset: number): RuntimeWorkspaceState {
  if (state.items.length === 0) {
    return state;
  }

  const selectedIndex = Math.max(0, state.selectedItemIndex ?? 0);
  const nextIndex = (selectedIndex + offset + state.items.length) % state.items.length;

  return nextIndex === state.selectedItemIndex ? state : { ...state, selectedItemIndex: nextIndex };
}

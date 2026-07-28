import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState } from "../process/process-manager.js";

export type RuntimeServiceState = {
  service: ServiceConfig;
  process: ManagedProcessState;
};

export type RuntimeCommandState = {
  command: CommandConfig;
  process: ManagedProcessState;
};

export type RuntimeSelectedItem =
  | { type: "service"; index: number }
  | { type: "command"; index: number };

export type RuntimeWorkspaceState = {
  workspace: {
    id: string;
    name: string;
  };
  services: RuntimeServiceState[];
  commands: RuntimeCommandState[];
  serviceIndexById: Record<string, number>;
  commandIndexById: Record<string, number>;
  selectedServiceIndex: number | undefined;
  selectedCommandIndex: number | undefined;
  selectedItem: RuntimeSelectedItem | undefined;
};

const stoppedProcessState: ManagedProcessState = { status: "stopped" };

export function createRuntimeState(
  workspace: WorkspaceConfig,
): RuntimeWorkspaceState {
  const services = workspace.services.map((service) => ({
    service,
    process: stoppedProcessState,
  }));
  const commands = (workspace.commands ?? []).map((command) => ({
    command,
    process: stoppedProcessState,
  }));
  const selectedItem = createInitialSelection(services, commands);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    services,
    commands,
    serviceIndexById: createServiceIndexById(services),
    commandIndexById: createCommandIndexById(commands),
    selectedServiceIndex: selectedItem?.type === "service" ? selectedItem.index : undefined,
    selectedCommandIndex: selectedItem?.type === "command" ? selectedItem.index : undefined,
    selectedItem,
  };
}

export function getSelectedService(
  state: RuntimeWorkspaceState,
): RuntimeServiceState | undefined {
  if (state.selectedServiceIndex === undefined) {
    return undefined;
  }

  return state.services[state.selectedServiceIndex];
}

export function getSelectedCommand(
  state: RuntimeWorkspaceState,
): RuntimeCommandState | undefined {
  if (state.selectedCommandIndex === undefined) {
    return undefined;
  }

  return state.commands[state.selectedCommandIndex];
}

export function selectNextService(
  state: RuntimeWorkspaceState,
): RuntimeWorkspaceState {
  const selectedItem = selectItemByOffset(state, 1);

  if (selectedItem === state.selectedItem) {
    return state;
  }

  return withSelectedItem(state, selectedItem);
}

export function selectPreviousService(
  state: RuntimeWorkspaceState,
): RuntimeWorkspaceState {
  const selectedItem = selectItemByOffset(state, -1);

  if (selectedItem === state.selectedItem) {
    return state;
  }

  return withSelectedItem(state, selectedItem);
}

export function updateServiceProcessState(
  state: RuntimeWorkspaceState,
  serviceId: string,
  processState: ManagedProcessState,
): RuntimeWorkspaceState {
  const serviceIndex = state.serviceIndexById[serviceId];

  if (serviceIndex === undefined) {
    return state;
  }

  return {
    ...state,
    services: state.services.map((serviceState, index) =>
      index === serviceIndex
        ? { ...serviceState, process: processState }
        : serviceState,
    ),
  };
}

export function updateCommandProcessState(
  state: RuntimeWorkspaceState,
  commandId: string,
  processState: ManagedProcessState,
): RuntimeWorkspaceState {
  const commandIndex = state.commandIndexById[commandId];

  if (commandIndex === undefined) {
    return state;
  }

  return {
    ...state,
    commands: state.commands.map((commandState, index) =>
      index === commandIndex
        ? { ...commandState, process: processState }
        : commandState,
    ),
  };
}

export function updateCommandConfigInRuntimeState(
  state: RuntimeWorkspaceState,
  command: CommandConfig,
): RuntimeWorkspaceState {
  const commandIndex = state.commandIndexById[command.id];

  if (commandIndex === undefined) {
    return state;
  }

  return {
    ...state,
    commands: state.commands.map((commandState, index) =>
      index === commandIndex ? { ...commandState, command } : commandState,
    ),
  };
}

export function removeCommandFromRuntimeState(
  state: RuntimeWorkspaceState,
  commandId: string,
): RuntimeWorkspaceState {
  const commandIndex = state.commandIndexById[commandId];

  if (commandIndex === undefined) {
    return state;
  }

  const commands = state.commands.filter((_, index) => index !== commandIndex);
  const selectedItem = state.services.length > 0
    ? { type: "service" as const, index: Math.min(state.selectedServiceIndex ?? 0, state.services.length - 1) }
    : commands.length === 0
      ? undefined
      : { type: "command" as const, index: Math.min(state.selectedCommandIndex ?? 0, commands.length - 1) };

  return {
    ...state,
    commands,
    commandIndexById: createCommandIndexById(commands),
    selectedServiceIndex: selectedItem?.type === "service" ? selectedItem.index : undefined,
    selectedCommandIndex: selectedItem?.type === "command" ? selectedItem.index : undefined,
    selectedItem,
  };
}

export function addServiceToRuntimeState(
  state: RuntimeWorkspaceState,
  service: ServiceConfig,
): RuntimeWorkspaceState {
  if (state.serviceIndexById[service.id] !== undefined) {
    return state;
  }

  const services = [
    ...state.services,
    {
      service,
      process: stoppedProcessState,
    },
  ];

  const selectedItem: RuntimeSelectedItem | undefined = services.length === 0
    ? createInitialSelection(services, state.commands)
    : { type: "service", index: services.length - 1 };

  return {
    ...state,
    services,
    serviceIndexById: createServiceIndexById(services),
    selectedServiceIndex: selectedItem?.type === "service" ? selectedItem.index : undefined,
    selectedCommandIndex: selectedItem?.type === "command" ? selectedItem.index : undefined,
    selectedItem,
  };
}

export function addCommandToRuntimeState(
  state: RuntimeWorkspaceState,
  command: CommandConfig,
): RuntimeWorkspaceState {
  if (state.commandIndexById[command.id] !== undefined) {
    return state;
  }

  const commands = [
    ...state.commands,
    {
      command,
      process: stoppedProcessState,
    },
  ];

  return {
    ...state,
    commands,
    commandIndexById: createCommandIndexById(commands),
    selectedServiceIndex: undefined,
    selectedCommandIndex: commands.length - 1,
    selectedItem: { type: "command", index: commands.length - 1 },
  };
}

export function updateServiceConfigInRuntimeState(
  state: RuntimeWorkspaceState,
  service: ServiceConfig,
): RuntimeWorkspaceState {
  const serviceIndex = state.serviceIndexById[service.id];

  if (serviceIndex === undefined) {
    return state;
  }

  return {
    ...state,
    services: state.services.map((serviceState, index) =>
      index === serviceIndex ? { ...serviceState, service } : serviceState,
    ),
  };
}

export function removeServiceFromRuntimeState(
  state: RuntimeWorkspaceState,
  serviceId: string,
): RuntimeWorkspaceState {
  const serviceIndex = state.serviceIndexById[serviceId];

  if (serviceIndex === undefined) {
    return state;
  }

  const services = state.services.filter((_, index) => index !== serviceIndex);

  const selectedItem = services.length === 0
    ? createInitialSelection(services, state.commands)
    : { type: "service" as const, index: Math.min(state.selectedServiceIndex ?? 0, services.length - 1) };

  return {
    ...state,
    services,
    serviceIndexById: createServiceIndexById(services),
    selectedServiceIndex: selectedItem?.type === "service" ? selectedItem.index : undefined,
    selectedCommandIndex: selectedItem?.type === "command" ? selectedItem.index : undefined,
    selectedItem,
  };
}

export function moveServiceInRuntimeState(
  state: RuntimeWorkspaceState,
  serviceId: string,
  direction: "up" | "down",
): RuntimeWorkspaceState {
  const serviceIndex = state.serviceIndexById[serviceId];

  if (serviceIndex === undefined) {
    return state;
  }

  const targetIndex = direction === "up" ? serviceIndex - 1 : serviceIndex + 1;

  if (targetIndex < 0 || targetIndex >= state.services.length) {
    return state;
  }

  const services = [...state.services];
  const [service] = services.splice(serviceIndex, 1);

  if (service === undefined) {
    return state;
  }

  services.splice(targetIndex, 0, service);

  return {
    ...state,
    services,
    serviceIndexById: createServiceIndexById(services),
    selectedServiceIndex: targetIndex,
    selectedCommandIndex: undefined,
    selectedItem: { type: "service", index: targetIndex },
  };
}

function createServiceIndexById(
  services: RuntimeServiceState[],
): Record<string, number> {
  return Object.fromEntries(
    services.map((serviceState, index) => [serviceState.service.id, index]),
  );
}

function createCommandIndexById(
  commands: RuntimeCommandState[],
): Record<string, number> {
  return Object.fromEntries(
    commands.map((commandState, index) => [commandState.command.id, index]),
  );
}

function createInitialSelection(
  services: RuntimeServiceState[],
  commands: RuntimeCommandState[],
): RuntimeSelectedItem | undefined {
  if (services.length > 0) {
    return { type: "service", index: 0 };
  }

  if (commands.length > 0) {
    return { type: "command", index: 0 };
  }

  return undefined;
}

function selectItemByOffset(
  state: RuntimeWorkspaceState,
  offset: number,
): RuntimeSelectedItem | undefined {
  const items = listSelectableItems(state);

  if (items.length === 0) {
    return state.selectedItem;
  }

  const selectedIndex = Math.max(0, items.findIndex((item) =>
    state.selectedItem !== undefined && item.type === state.selectedItem.type && item.index === state.selectedItem.index,
  ));

  return items[(selectedIndex + offset + items.length) % items.length];
}

function listSelectableItems(state: RuntimeWorkspaceState): RuntimeSelectedItem[] {
  return [
    ...state.services.map((_, index) => ({ type: "service" as const, index })),
    ...state.commands.map((_, index) => ({ type: "command" as const, index })),
  ];
}

function withSelectedItem(
  state: RuntimeWorkspaceState,
  selectedItem: RuntimeSelectedItem | undefined,
): RuntimeWorkspaceState {
  return {
    ...state,
    selectedItem,
    selectedServiceIndex: selectedItem?.type === "service" ? selectedItem.index : undefined,
    selectedCommandIndex: selectedItem?.type === "command" ? selectedItem.index : undefined,
  };
}

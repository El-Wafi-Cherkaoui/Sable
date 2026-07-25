import type { ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState } from "../process/process-manager.js";

export type RuntimeServiceState = {
  service: ServiceConfig;
  process: ManagedProcessState;
};

export type RuntimeWorkspaceState = {
  workspace: {
    id: string;
    name: string;
  };
  services: RuntimeServiceState[];
  serviceIndexById: Record<string, number>;
  selectedServiceIndex: number | undefined;
};

const stoppedProcessState: ManagedProcessState = { status: "stopped" };

export function createRuntimeState(
  workspace: WorkspaceConfig,
): RuntimeWorkspaceState {
  const services = workspace.services.map((service) => ({
    service,
    process: stoppedProcessState,
  }));

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    services,
    serviceIndexById: createServiceIndexById(services),
    selectedServiceIndex: services.length > 0 ? 0 : undefined,
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

export function selectNextService(
  state: RuntimeWorkspaceState,
): RuntimeWorkspaceState {
  if (state.services.length === 0) {
    return state;
  }

  return {
    ...state,
    selectedServiceIndex:
      ((state.selectedServiceIndex ?? 0) + 1) % state.services.length,
  };
}

export function selectPreviousService(
  state: RuntimeWorkspaceState,
): RuntimeWorkspaceState {
  if (state.services.length === 0) {
    return state;
  }

  const selectedServiceIndex = state.selectedServiceIndex ?? 0;

  return {
    ...state,
    selectedServiceIndex:
      (selectedServiceIndex - 1 + state.services.length) % state.services.length,
  };
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

function createServiceIndexById(
  services: RuntimeServiceState[],
): Record<string, number> {
  return Object.fromEntries(
    services.map((serviceState, index) => [serviceState.service.id, index]),
  );
}

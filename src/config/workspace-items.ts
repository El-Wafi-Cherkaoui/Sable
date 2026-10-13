import type { CommandConfig, ItemConfig, ItemKind, ServiceConfig, WorkspaceConfig } from "./config-types.js";

export function servicesOf(workspace: WorkspaceConfig): ServiceConfig[] {
  return workspace.items.filter((item): item is ServiceConfig => item.kind === "service");
}

export function commandsOf(workspace: WorkspaceConfig): CommandConfig[] {
  return workspace.items.filter((item): item is CommandConfig => item.kind === "command");
}

export function itemsOfKind(workspace: WorkspaceConfig, kind: ItemKind): ItemConfig[] {
  return workspace.items.filter((item) => item.kind === kind);
}

export function findItem(workspace: WorkspaceConfig, itemId: string | undefined): ItemConfig | undefined {
  return workspace.items.find((item) => item.id === itemId);
}

export function findService(workspace: WorkspaceConfig | undefined, serviceId: string): ServiceConfig | undefined {
  return workspace === undefined ? undefined : servicesOf(workspace).find((service) => service.id === serviceId);
}

export function findCommand(workspace: WorkspaceConfig | undefined, commandId: string): CommandConfig | undefined {
  return workspace === undefined ? undefined : commandsOf(workspace).find((command) => command.id === commandId);
}

export function addItem(workspace: WorkspaceConfig, item: ItemConfig): WorkspaceConfig {
  return { ...workspace, items: [...workspace.items, item] };
}

export function replaceItem(workspace: WorkspaceConfig, item: ItemConfig): WorkspaceConfig {
  return { ...workspace, items: workspace.items.map((candidate) => candidate.id === item.id ? item : candidate) };
}

export function removeItem(workspace: WorkspaceConfig, itemId: string): WorkspaceConfig {
  return { ...workspace, items: workspace.items.filter((item) => item.id !== itemId) };
}

// Swaps a service with the neighbouring service, leaving commands where they are.
export function moveService(workspace: WorkspaceConfig, serviceId: string, direction: "up" | "down"): WorkspaceConfig {
  const services = servicesOf(workspace);
  const index = services.findIndex((service) => service.id === serviceId);
  const target = services[direction === "up" ? index - 1 : index + 1];
  const service = services[index];

  if (service === undefined || target === undefined) {
    return workspace;
  }

  return {
    ...workspace,
    items: workspace.items.map((item) => item.id === service.id ? target : item.id === target.id ? service : item),
  };
}

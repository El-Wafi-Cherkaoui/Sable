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

// Items that waited for the removed one stop waiting for it.
export function removeItem(workspace: WorkspaceConfig, itemId: string): WorkspaceConfig {
  return {
    ...workspace,
    items: workspace.items
      .filter((item) => item.id !== itemId)
      .map((item) => item.after.includes(itemId) ? { ...item, after: item.after.filter((id) => id !== itemId) } : item),
  };
}

export function dependentsOf(workspace: WorkspaceConfig, itemId: string): ItemConfig[] {
  return workspace.items.filter((item) => item.after.includes(itemId));
}

// Every item that waits for this one, directly or through others. Making this item wait for any of
// them would close a loop.
export function dependentsClosure(workspace: WorkspaceConfig, itemId: string): Set<string> {
  const found = new Set<string>();
  const queue = [itemId];

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const dependent of dependentsOf(workspace, id)) {
      if (!found.has(dependent.id)) {
        found.add(dependent.id);
        queue.push(dependent.id);
      }
    }
  }

  return found;
}

// The names of the items this one waits for, in the order they are listed.
export function afterNames(workspace: WorkspaceConfig, item: ItemConfig): string[] {
  return item.after.flatMap((id) => {
    const found = findItem(workspace, id);

    return found === undefined ? [] : [found.name];
  });
}

// A loop of items waiting for each other, as names ending where they began ("a → b → a"), or undefined.
export function findDependencyCycle(items: ReadonlyArray<Pick<ItemConfig, "id" | "name" | "after">>): string[] | undefined {
  const byId = new Map(items.map((item) => [item.id, item]));
  const finished = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): string[] | undefined => {
    const loopStart = path.indexOf(id);

    if (loopStart >= 0) {
      return [...path.slice(loopStart), id].map((member) => byId.get(member)?.name ?? member);
    }

    if (finished.has(id)) {
      return undefined;
    }

    path.push(id);

    for (const afterId of byId.get(id)?.after ?? []) {
      if (!byId.has(afterId)) {
        continue;
      }

      const cycle = visit(afterId);

      if (cycle !== undefined) {
        return cycle;
      }
    }

    path.pop();
    finished.add(id);

    return undefined;
  };

  for (const item of items) {
    const cycle = visit(item.id);

    if (cycle !== undefined) {
      return cycle;
    }
  }

  return undefined;
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

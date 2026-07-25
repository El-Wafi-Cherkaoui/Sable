import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";

export function renderStaticDashboard(state: RuntimeWorkspaceState): string {
  const lines = [state.workspace.name, ""];

  if (state.services.length === 0) {
    lines.push("No services configured.");
    return lines.join("\n");
  }

  const nameColumnWidth = Math.max(
    ...state.services.map((serviceState) => serviceState.service.name.length),
  );

  for (const [index, serviceState] of state.services.entries()) {
    const marker = index === state.selectedServiceIndex ? ">" : " ";
    lines.push(
      `${marker} ${serviceState.service.name.padEnd(nameColumnWidth)}  ${serviceState.process.status}`,
    );
  }

  return lines.join("\n");
}

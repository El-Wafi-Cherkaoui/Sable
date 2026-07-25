import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
};

export function renderStaticDashboard(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions = {},
): string {
  const dashboardFooter = `j/k move  S start  s stop  r restart  Enter logs  ? help  : command  q ${
    options.quitLabel ?? "quit"
  }`;
  const lines = [state.workspace.name, ""];

  if (state.services.length === 0) {
    lines.push("No services configured.");
    lines.push("", dashboardFooter);
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

  lines.push("", dashboardFooter);

  return lines.join("\n");
}

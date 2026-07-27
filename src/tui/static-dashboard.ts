import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ManagedProcessState } from "../process/process-manager.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
  statusMessage?: string;
};

export function renderStaticDashboard(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions = {},
): string {
  const dashboardFooter = `j/k select  K/J move  a add  e edit  d delete  S start  s stop  r restart  Enter logs  ? help  : command  q ${
    options.quitLabel ?? "quit"
  }`;
  const lines = [state.workspace.name, ""];

  if (options.statusMessage !== undefined) {
    lines.push(options.statusMessage, "");
  }

  if (state.services.length === 0) {
    lines.push("No services yet. Press a to add one.");
    lines.push("", dashboardFooter);
    return lines.join("\n");
  }

  const nameColumnWidth = Math.max(
    ...state.services.map((serviceState) => serviceState.service.name.length),
  );

  for (const [index, serviceState] of state.services.entries()) {
    const marker = index === state.selectedServiceIndex ? ">" : " ";
    lines.push(
      `${marker} ${serviceState.service.name.padEnd(nameColumnWidth)}  ${formatProcessState(serviceState.process)}`,
    );
  }

  lines.push("", dashboardFooter);

  return lines.join("\n");
}

function formatProcessState(process: ManagedProcessState): string {
  switch (process.status) {
    case "failed":
      return `failed: ${formatDetail(process.error.message)}`;
    case "exited":
      if (process.signal !== null) {
        return `exited signal ${process.signal}`;
      }

      return `exited code ${process.exitCode ?? "null"}`;
    case "running":
      return "running";
    case "stopped":
      return "stopped";
  }
}

function formatDetail(message: string): string {
  const normalizedMessage = message.trim().replace(/\s+/g, " ");

  if (normalizedMessage.length <= 60) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, 57)}...`;
}

import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ManagedProcessState } from "../process/process-manager.js";
import { createTuiStyle, type TuiStyle } from "./style.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
  statusMessage?: string;
  color?: boolean;
  style?: TuiStyle;
};

export function renderStaticDashboard(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions = {},
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const dashboardFooter = style.muted(`j/k select  ? help  q ${
    options.quitLabel ?? "quit"
  }`);
  const lines = [style.muted("Workspace"), style.title(state.workspace.name), ""];

  if (options.statusMessage !== undefined) {
    lines.push(`${style.statusLabel("Status:")} ${options.statusMessage}`, "");
  }

  if (state.services.length === 0) {
    lines.push("No services yet.");
    lines.push("");
    lines.push("Press a to add a service to this workspace.");
    lines.push("", dashboardFooter);
    return lines.join("\n");
  }

  const nameColumnWidth = Math.max(
    "Service".length,
    ...state.services.map((serviceState) => serviceState.service.name.length),
  );

  lines.push(style.muted(`  ${"Service".padEnd(nameColumnWidth)}  Status`));

  for (const [index, serviceState] of state.services.entries()) {
    const line = `  ${serviceState.service.name.padEnd(nameColumnWidth)}  ${formatProcessState(
      serviceState.process,
      style,
    )}`;

    lines.push(index === state.selectedServiceIndex ? style.selected(line) : line);
  }

  lines.push("", dashboardFooter);

  return lines.join("\n");
}

function formatProcessState(process: ManagedProcessState, style: TuiStyle): string {
  switch (process.status) {
    case "failed":
      return style.failed(`failed: ${formatDetail(process.error.message)}`);
    case "exited":
      if (process.signal !== null) {
        return style.exited(`exited signal ${process.signal}`);
      }

      return style.exited(`exited code ${process.exitCode ?? "null"}`);
    case "running":
      return style.running("running");
    case "stopped":
      return style.muted("stopped");
  }
}

function formatDetail(message: string): string {
  const normalizedMessage = message.trim().replace(/\s+/g, " ");

  if (normalizedMessage.length <= 60) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, 57)}...`;
}

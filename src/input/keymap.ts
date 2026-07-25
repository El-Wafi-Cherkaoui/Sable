export type Keypress = {
  sequence?: string;
  name?: string;
};

export type DashboardAction =
  | "selectNext"
  | "selectPrevious"
  | "openLogs"
  | "start"
  | "stop"
  | "restart"
  | "quit"
  | "none";

export type LogsAction =
  | "scrollDown"
  | "scrollUp"
  | "scrollTop"
  | "scrollBottom"
  | "back"
  | "quit"
  | "none";

export function mapDashboardKey(keypress: Keypress): DashboardAction {
  if (keypress.name === "down" || keypress.sequence === "j") {
    return "selectNext";
  }

  if (keypress.name === "up" || keypress.sequence === "k") {
    return "selectPrevious";
  }

  if (keypress.name === "escape" || keypress.sequence === "q") {
    return "quit";
  }

  if (keypress.name === "return" || keypress.sequence === "\r") {
    return "openLogs";
  }

  if (keypress.sequence === "S") {
    return "start";
  }

  if (keypress.sequence === "s") {
    return "stop";
  }

  if (keypress.sequence === "r") {
    return "restart";
  }

  return "none";
}

export function mapLogsKey(keypress: Keypress): LogsAction {
  if (keypress.name === "down" || keypress.sequence === "j") {
    return "scrollDown";
  }

  if (keypress.name === "up" || keypress.sequence === "k") {
    return "scrollUp";
  }

  if (keypress.sequence === "g") {
    return "scrollTop";
  }

  if (keypress.sequence === "G") {
    return "scrollBottom";
  }

  if (keypress.name === "escape") {
    return "back";
  }

  if (keypress.sequence === "q") {
    return "quit";
  }

  return "none";
}

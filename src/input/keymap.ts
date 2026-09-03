export type Keypress = {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
};

export type DashboardAction =
  | "selectNext"
  | "selectPrevious"
  | "openLogs"
  | "openHelp"
  | "openCommand"
  | "start"
  | "stop"
  | "restart"
  | "addService"
  | "editService"
  | "deleteService"
  | "moveServiceUp"
  | "moveServiceDown"
  | "quit"
  | "none";

export type LogsAction =
  | "scrollDown"
  | "scrollUp"
  | "scrollTop"
  | "scrollBottom"
  | "scrollLeft"
  | "scrollRight"
  | "resetHorizontalScroll"
  | "openHelp"
  | "openCommand"
  | "back"
  | "quit"
  | "none";

export type HelpAction = "back" | "openCommand" | "quit" | "none";

export type WorkspacePickerAction =
  | "selectNext"
  | "selectPrevious"
  | "run"
  | "createWorkspace"
  | "deleteWorkspace"
  | "renameWorkspace"
  | "stopActiveWorkspace"
  | "restartActiveWorkspace"
  | "moveWorkspaceUp"
  | "moveWorkspaceDown"
  | "view"
  | "openHelp"
  | "quit"
  | "none";

export function mapWorkspacePickerKey(keypress: Keypress): WorkspacePickerAction {
  if (keypress.name === "down" || keypress.sequence === "j") {
    return "selectNext";
  }

  if (keypress.name === "up" || keypress.sequence === "k") {
    return "selectPrevious";
  }

  if (keypress.name === "return" || keypress.sequence === "\r") {
    return "run";
  }

  if (keypress.sequence === "v") {
    return "view";
  }

  if (keypress.sequence === "e") {
    return "renameWorkspace";
  }

  if (keypress.sequence === "s") {
    return "stopActiveWorkspace";
  }

  if (keypress.sequence === "r") {
    return "restartActiveWorkspace";
  }

  if (keypress.sequence === "K") {
    return "moveWorkspaceUp";
  }

  if (keypress.sequence === "J") {
    return "moveWorkspaceDown";
  }

  if (keypress.sequence === "c") {
    return "createWorkspace";
  }

  if (keypress.sequence === "d") {
    return "deleteWorkspace";
  }

  if (keypress.sequence === "?") {
    return "openHelp";
  }

  if (keypress.sequence === "q") {
    return "quit";
  }

  return "none";
}

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

  if (keypress.sequence === "?") {
    return "openHelp";
  }

  if (keypress.sequence === ":") {
    return "openCommand";
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

  if (keypress.sequence === "a") {
    return "addService";
  }

  if (keypress.sequence === "e") {
    return "editService";
  }

  if (keypress.sequence === "K") {
    return "moveServiceUp";
  }

  if (keypress.sequence === "J") {
    return "moveServiceDown";
  }

  if (keypress.sequence === "d") {
    return "deleteService";
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

  if (keypress.name === "left" || keypress.sequence === "h") {
    return "scrollLeft";
  }

  if (keypress.name === "right" || keypress.sequence === "l") {
    return "scrollRight";
  }

  if (keypress.sequence === "0") {
    return "resetHorizontalScroll";
  }

  if (keypress.name === "escape") {
    return "back";
  }

  if (keypress.sequence === "?") {
    return "openHelp";
  }

  if (keypress.sequence === ":") {
    return "openCommand";
  }

  if (keypress.sequence === "q") {
    return "quit";
  }

  return "none";
}

export function mapHelpKey(keypress: Keypress): HelpAction {
  if (keypress.name === "escape") {
    return "back";
  }

  if (keypress.sequence === ":") {
    return "openCommand";
  }

  if (keypress.sequence === "q") {
    return "quit";
  }

  return "none";
}

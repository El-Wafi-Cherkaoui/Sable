export type Keypress = {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
};

// Keys marked "0.3 alias" are pre-0.3.0 bindings kept working but no longer
// shown in footers or help. Remove them in 0.4.0.

export type DashboardAction =
  | "selectNext"
  | "selectPrevious"
  | "openLogs"
  | "openHelp"
  | "toggle"
  | "start"
  | "restart"
  | "addService"
  | "editService"
  | "deleteService"
  | "startMove"
  | "moveServiceUp"
  | "moveServiceDown"
  | "back"
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
  | "back"
  | "none";

export type HelpAction = "back" | "none";

export type MoveAction = "moveUp" | "moveDown" | "done" | "cancel" | "none";

export type WorkspacePickerAction =
  | "selectNext"
  | "selectPrevious"
  | "run"
  | "createWorkspace"
  | "deleteWorkspace"
  | "renameWorkspace"
  | "stopActiveWorkspace"
  | "restartActiveWorkspace"
  | "startMove"
  | "moveWorkspaceUp"
  | "moveWorkspaceDown"
  | "view"
  | "openHelp"
  | "quit"
  | "none";

export function mapWorkspacePickerKey(keypress: Keypress): WorkspacePickerAction {
  if (isDown(keypress)) {
    return "selectNext";
  }

  if (isUp(keypress)) {
    return "selectPrevious";
  }

  if (isEnter(keypress)) {
    return "run";
  }

  switch (keypress.sequence) {
    case "a":
    case "c": // 0.3 alias
      return "createWorkspace";
    case "e":
      return "renameWorkspace";
    case "d":
      return "deleteWorkspace";
    case "m":
      return "startMove";
    case "K": // 0.3 alias
      return "moveWorkspaceUp";
    case "J": // 0.3 alias
      return "moveWorkspaceDown";
    case "s":
      return "stopActiveWorkspace";
    case "r":
      return "restartActiveWorkspace";
    case "v":
      return "view";
    case "?":
      return "openHelp";
    case "q":
      return "quit";
    default:
      return "none";
  }
}

export function mapDashboardKey(keypress: Keypress): DashboardAction {
  if (isDown(keypress)) {
    return "selectNext";
  }

  if (isUp(keypress)) {
    return "selectPrevious";
  }

  if (isEnter(keypress)) {
    return "openLogs";
  }

  if (keypress.name === "escape") {
    return "back";
  }

  switch (keypress.sequence) {
    case "s":
      return "toggle";
    case "S": // 0.3 alias
      return "start";
    case "r":
      return "restart";
    case "a":
      return "addService";
    case "e":
      return "editService";
    case "d":
      return "deleteService";
    case "m":
      return "startMove";
    case "K": // 0.3 alias
      return "moveServiceUp";
    case "J": // 0.3 alias
      return "moveServiceDown";
    case "?":
      return "openHelp";
    case "q":
      return "back";
    default:
      return "none";
  }
}

export function mapLogsKey(keypress: Keypress): LogsAction {
  if (isDown(keypress)) {
    return "scrollDown";
  }

  if (isUp(keypress)) {
    return "scrollUp";
  }

  if (keypress.name === "left" || keypress.sequence === "h") { // h: 0.3 alias
    return "scrollLeft";
  }

  if (keypress.name === "right" || keypress.sequence === "l") { // l: 0.3 alias
    return "scrollRight";
  }

  if (keypress.name === "home" || keypress.sequence === "g") {
    return "scrollTop";
  }

  if (keypress.name === "end" || keypress.sequence === "G") {
    return "scrollBottom";
  }

  if (keypress.name === "escape" || keypress.sequence === "q") {
    return "back";
  }

  switch (keypress.sequence) {
    case "0":
      return "resetHorizontalScroll";
    case "?":
      return "openHelp";
    default:
      return "none";
  }
}

export function mapHelpKey(keypress: Keypress): HelpAction {
  if (keypress.name === "escape" || keypress.sequence === "q" || keypress.sequence === "?") {
    return "back";
  }

  return "none";
}

export function mapMoveKey(keypress: Keypress): MoveAction {
  if (isUp(keypress)) {
    return "moveUp";
  }

  if (isDown(keypress)) {
    return "moveDown";
  }

  if (isEnter(keypress) || keypress.sequence === "m") {
    return "done";
  }

  if (keypress.name === "escape" || keypress.sequence === "q") {
    return "cancel";
  }

  return "none";
}

function isDown(keypress: Keypress): boolean {
  return keypress.name === "down" || keypress.sequence === "j"; // j: 0.3 alias
}

function isUp(keypress: Keypress): boolean {
  return keypress.name === "up" || keypress.sequence === "k"; // k: 0.3 alias
}

function isEnter(keypress: Keypress): boolean {
  return keypress.name === "return" || keypress.sequence === "\r";
}

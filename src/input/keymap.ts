export type Keypress = {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
};

// The terminal key input sends this when the window changes size; screens redraw.
export function isResize(keypress: Keypress): boolean {
  return keypress.name === "resize";
}

export type DashboardAction =
  | "selectNext"
  | "selectPrevious"
  | "openLogs"
  | "openHelp"
  | "openSettings"
  | "toggle"
  | "restart"
  | "startAll"
  | "addService"
  | "editService"
  | "deleteService"
  | "startMove"
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
  | "search"
  | "nextMatch"
  | "previousMatch"
  | "nextError"
  | "toggleWrap"
  | "openHelp"
  | "back"
  | "none";

export type HelpAction = "back" | "none";

export type SettingsAction = "selectNext" | "selectPrevious" | "toggle" | "close" | "none";

export type MoveAction = "moveUp" | "moveDown" | "done" | "cancel" | "none";

export type WorkspacePickerAction =
  | "selectNext"
  | "selectPrevious"
  | "run"
  | "createWorkspace"
  | "importProject"
  | "deleteWorkspace"
  | "renameWorkspace"
  | "stopActiveWorkspace"
  | "restartActiveWorkspace"
  | "startMove"
  | "view"
  | "openHelp"
  | "openSettings"
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
      return "createWorkspace";
    case "i":
      return "importProject";
    case "e":
      return "renameWorkspace";
    case "d":
      return "deleteWorkspace";
    case "m":
      return "startMove";
    case "s":
      return "stopActiveWorkspace";
    case "r":
      return "restartActiveWorkspace";
    case "v":
      return "view";
    case "?":
      return "openHelp";
    case ",":
      return "openSettings";
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
    case "r":
      return "restart";
    case "S":
      return "startAll";
    case "a":
      return "addService";
    case "e":
      return "editService";
    case "d":
      return "deleteService";
    case "m":
      return "startMove";
    case "?":
      return "openHelp";
    case ",":
      return "openSettings";
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

  if (keypress.name === "left") {
    return "scrollLeft";
  }

  if (keypress.name === "right") {
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
    case "/":
      return "search";
    case "n":
      return "nextMatch";
    case "N":
      return "previousMatch";
    case "e":
      return "nextError";
    case "w":
      return "toggleWrap";
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

export function mapSettingsKey(keypress: Keypress): SettingsAction {
  if (keypress.name === "escape" || keypress.sequence === "q" || keypress.sequence === ",") {
    return "close";
  }

  if (keypress.name === "down") {
    return "selectNext";
  }

  if (keypress.name === "up") {
    return "selectPrevious";
  }

  if (keypress.sequence === " " || keypress.name === "space" || isEnter(keypress) || keypress.name === "left" || keypress.name === "right") {
    return "toggle";
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
  return keypress.name === "down";
}

function isUp(keypress: Keypress): boolean {
  return keypress.name === "up";
}

function isEnter(keypress: Keypress): boolean {
  return keypress.name === "return" || keypress.sequence === "\r";
}

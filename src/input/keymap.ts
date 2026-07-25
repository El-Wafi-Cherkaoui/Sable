export type Keypress = {
  sequence?: string;
  name?: string;
};

export type DashboardAction = "selectNext" | "selectPrevious" | "quit" | "none";

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

  return "none";
}

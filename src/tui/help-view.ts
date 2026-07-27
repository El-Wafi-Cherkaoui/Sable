export type HelpContext = "dashboard" | "logs";

export function renderHelpView(context: HelpContext): string {
  const lines = ["Help", ""];

  if (context === "dashboard") {
    lines.push(
      "Dashboard",
      "j / Down    select next service",
      "k / Up      select previous service",
      "a           add service",
      "e           edit selected non-running service",
      "d           delete selected non-running service",
      "S           start selected service",
      "s           stop selected service",
      "r           restart selected service",
      "Enter       show selected service logs",
      "?           show help",
      ":           command mode",
      "q           quit",
    );
  } else {
    lines.push(
      "Logs",
      "j / Down    scroll down",
      "k / Up      scroll up",
      "g           jump to top",
      "G           jump to bottom",
      "Esc         return to dashboard",
      "?           show help",
      ":           command mode",
      "q           quit",
    );
  }

  lines.push("", "Esc back  : command  q quit");

  return lines.join("\n");
}

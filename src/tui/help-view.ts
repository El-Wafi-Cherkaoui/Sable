export type HelpContext = "dashboard" | "logs";

export function renderHelpView(context: HelpContext): string {
  const lines = ["Help", ""];

  if (context === "dashboard") {
    lines.push(
      "Dashboard",
      "j / Down    select next item",
      "k / Up      select previous item",
      "a           add service or command",
      "e           edit selected non-running item",
      "d           delete selected non-running item",
      "K           move selected service up",
      "J           move selected service down",
      "S           start selected service",
      "s           stop selected item",
      "r           restart service or run command",
      "Enter       show selected logs/output",
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

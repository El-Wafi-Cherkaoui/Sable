export type HelpContext = "dashboard" | "logs";

export function renderHelpView(context: HelpContext): string {
  const lines = ["Help", ""];

  if (context === "dashboard") {
    lines.push(
      "Moving around",
      "↑ / ↓       select service or command",
      "Enter       show logs or output",
      "",
      "Run",
      "s           start or stop selected item",
      "r           restart service, or run command",
      "",
      "Edit (stop the item first)",
      "a           add a service or command",
      "e           edit selected item",
      "d           delete selected item",
      "m           move selected service (↑ ↓, then Enter)",
      "",
      "Esc, q      back",
      "Ctrl+C      quit Sable and stop everything",
    );
  } else {
    lines.push(
      "Logs",
      "↑ / ↓       scroll",
      "← / →       scroll long lines sideways",
      "0           reset sideways scroll",
      "g / Home    jump to top",
      "G / End     jump to bottom and follow",
      "",
      "Esc, q      back to dashboard",
      "Ctrl+C      quit Sable and stop everything",
    );
  }

  lines.push("", "Esc, q, ?   close help");

  return lines.join("\n");
}

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
      "Edit",
      "a           add a service or command",
      "e           edit selected item (changes apply on restart)",
      "d           delete selected item (stop it first)",
      "m           move selected service (↑ ↓, then Enter)",
      "",
      "Esc, q      back",
      "Ctrl+C      quit Sable and stop everything",
    );
  } else {
    lines.push(
      "Reading",
      "↑ / ↓       scroll",
      "g / Home    jump to top",
      "G / End     jump to bottom and follow new output",
      "w           wrap long lines, or scroll them sideways",
      "← / →       scroll long lines sideways (when not wrapping)",
      "0           reset sideways scroll",
      "",
      "Finding",
      "/           search, then Enter",
      "n / N       next / previous match",
      "e           jump to the next error (stderr) line",
      "",
      "Esc, q      clear the search, or go back to the dashboard",
      "Ctrl+C      quit Sable and stop everything",
    );
  }

  lines.push("", "Esc, q, ?   close help");

  return lines.join("\n");
}

import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import { createTuiStyle } from "./style.js";

export type HelpContext = "dashboard" | "logs";

export type HelpSection = {
  heading?: string;
  rows: string[];
};

export type HelpViewOptions = {
  // The screen help was opened from; it stays visible, dimmed, around the box.
  background?: string;
  columns?: number;
  rows?: number;
  color?: boolean;
};

const dashboardHelp: HelpSection[] = [
  {
    heading: "Moving around",
    rows: ["↑ / ↓       select service or command", "Enter       show logs or output"],
  },
  {
    heading: "Run",
    rows: [
      "s           start or stop selected item",
      "r           restart service, or run command",
      "S           start every service, in order of 'After'",
    ],
  },
  {
    heading: "Edit",
    rows: [
      "a           add a service or command",
      "e           edit selected item (changes apply on restart)",
      "d           delete selected item (stop it first)",
      "m           move selected service (↑ ↓, then Enter)",
    ],
  },
  {
    rows: [",           settings (sound, welcome screen)", "Esc, q      back", "Ctrl+C      quit Sable and stop everything"],
  },
];

const logsHelp: HelpSection[] = [
  {
    heading: "Reading",
    rows: [
      "↑ / ↓       scroll",
      "g / Home    jump to top",
      "G / End     jump to bottom and follow new output",
      "w           wrap long lines, or scroll them sideways",
      "← / →       scroll long lines sideways (when not wrapping)",
      "0           reset sideways scroll",
    ],
  },
  {
    heading: "Finding",
    rows: ["/           search, then Enter", "n / N       next / previous match", "e           jump to the next error (stderr) line"],
  },
  {
    rows: ["Esc, q      clear the search, or go back to the dashboard", "Ctrl+C      quit Sable and stop everything"],
  },
];

export function renderHelpView(context: HelpContext, options: HelpViewOptions = {}): string {
  return renderHelpBox(context === "dashboard" ? "Help · workspace" : "Help · logs", context === "dashboard" ? dashboardHelp : logsHelp, options);
}

// Help is a popup over the current screen, in the same box as every other Sable popup.
export function renderHelpBox(title: string, sections: HelpSection[], options: HelpViewOptions = {}): string {
  const style = createTuiStyle(options.color ?? false);
  const lines = sections.flatMap((section, index) => [
    ...(index > 0 ? [""] : []),
    ...(section.heading === undefined ? [] : [style.title(section.heading)]),
    ...section.rows,
  ]);

  return renderDialogScreen({
    box: renderDialogBox({ title, lines: fitToRows(lines, options.rows), style, maxWidth: dialogMaxWidth(options.columns) }),
    hints: formatKeyHints([["Esc", "close"]], style, dialogMaxWidth(options.columns)),
    style,
    columns: options.columns,
    rows: options.rows,
    background: options.background,
  });
}

// Box chrome around the text: two border rows and a blank row of padding above and below,
// plus the hints under the box.
const dialogChromeRows = 5;

// On a short terminal, drop the blank lines between sections first, then cut what still
// doesn't fit, so the box is never taller than the screen.
function fitToRows(lines: string[], rows: number | undefined): string[] {
  const available = rows === undefined ? Number.POSITIVE_INFINITY : Math.max(1, rows - 1 - dialogChromeRows);

  if (lines.length <= available) {
    return lines;
  }

  const compact = lines.filter((line) => line !== "");

  return compact.length <= available ? compact : [...compact.slice(0, Math.max(0, available - 1)), "..."];
}

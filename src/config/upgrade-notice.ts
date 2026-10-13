import type { UpgradeNotice } from "./config-store.js";

// What to tell the user once, when Sable found a workspaces file in the old format. Shown in a popup in
// the TUI and as plain lines by the other commands.
export function upgradeNoticeParagraphs(notice: UpgradeNotice, shownPath: string = notice.backupFile): string[] {
  return [
    "Sable 0.4 keeps services and commands in one list, so your workspaces file has a new format. Nothing is lost: your workspaces are converted the next time Sable saves them.",
    "",
    notice.backedUp
      ? `A copy of your old file was kept here: ${shownPath}`
      : "Sable could not keep a copy of your old file (the folder may be read-only). Copy workspaces.json yourself if you may want to go back.",
    "",
    "Older versions of Sable can't read the new format. To go back to one, put the copy back as workspaces.json.",
  ];
}

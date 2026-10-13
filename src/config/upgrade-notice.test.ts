import { describe, expect, it } from "vitest";
import { upgradeNoticeParagraphs } from "./upgrade-notice.js";

describe("upgradeNoticeParagraphs", () => {
  it("explains the new format, where the old file went, and how to go back", () => {
    const text = upgradeNoticeParagraphs({ backupFile: "/home/me/.config/sable-nodejs/workspaces.json.bak-0.3", backedUp: true, converted: true }).join("\n");

    expect(text).toContain("converted just now and nothing was lost");
    expect(text).toContain("A copy of your old file was kept here: /home/me/.config/sable-nodejs/workspaces.json.bak-0.3");
    expect(text).toContain("put the copy back as workspaces.json");
  });

  it("shows the shortened path it is given", () => {
    expect(upgradeNoticeParagraphs({ backupFile: "/home/me/.config/x/workspaces.json.bak-0.3", backedUp: true, converted: true }, "~/.config/x/workspaces.json.bak-0.3").join(" "))
      .toContain("kept here: ~/.config/x/workspaces.json.bak-0.3");
  });

  it("warns instead when no copy could be made", () => {
    const text = upgradeNoticeParagraphs({ backupFile: "/x/workspaces.json.bak-0.3", backedUp: false, converted: false }).join("\n");

    expect(text).toContain("could not keep a copy");
    expect(text).not.toContain("kept here");
  });

  it("says the conversion is still to come when the file could not be rewritten", () => {
    const text = upgradeNoticeParagraphs({ backupFile: "/x/workspaces.json.bak-0.3", backedUp: true, converted: false }).join("\n");

    expect(text).toContain("converted the next time Sable can save it");
    expect(text).not.toContain("converted just now");
  });
});

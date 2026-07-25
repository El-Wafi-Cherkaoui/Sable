import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import {
  findWorkspaceByName,
  requireWorkspaceByName,
  WorkspaceLookupError,
} from "./find-workspace.js";

describe("workspace lookup", () => {
  it("finds workspaces by trimmed case-insensitive name", () => {
    expect(findWorkspaceByName(config, " Ecommerce ")?.id).toBe("ws_ecommerce");
  });

  it("returns undefined when a workspace is not found", () => {
    expect(findWorkspaceByName(config, "missing")).toBeUndefined();
  });

  it("throws a clear error when requiring a missing workspace", () => {
    expect(() => requireWorkspaceByName(config, " missing ")).toThrow(
      new WorkspaceLookupError("missing"),
    );
  });
});

const config: AppConfig = {
  version: 1,
  workspaces: [
    {
      id: "ws_ecommerce",
      name: "ecommerce",
      services: [],
    },
  ],
};

import { describe, expect, it } from "vitest";
import { safeValidateAppConfig } from "./config-schema.js";

const validService = {
  id: "service-1",
  name: "backend",
  command: "npm run dev",
  cwd: "/projects/app/backend",
  autoStart: true,
  env: {},
};

describe("config validation", () => {
  it("accepts a valid empty config", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a valid workspace and service config", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          services: [
            {
              ...validService,
              env: {
                NODE_ENV: "development",
              },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid config version", () => {
    const result = safeValidateAppConfig({
      version: 2,
      workspaces: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects workspace names with spaces", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "my ecommerce",
          services: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid environment variable values", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          services: [
            {
              ...validService,
              env: {
                PORT: 3000,
              },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate workspace names", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          services: [],
        },
        {
          id: "workspace-2",
          name: "ecommerce",
          services: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate service names within one workspace", () => {
    const result = safeValidateAppConfig({
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          services: [
            validService,
            {
              ...validService,
              id: "service-2",
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

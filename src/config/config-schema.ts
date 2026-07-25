import { z } from "zod";

const workspaceNamePattern = /^[A-Za-z0-9_-]+$/;

export const serviceConfigSchema = z.object({
  id: z.string().trim().min(1, "Service id is required."),
  name: z.string().trim().min(1, "Service name is required."),
  command: z.string().trim().min(1, "Service command is required."),
  cwd: z.string().trim().min(1, "Service working directory is required."),
  autoStart: z.boolean(),
  env: z.record(z.string(), z.string()),
});

export const workspaceConfigSchema = z
  .object({
    id: z.string().trim().min(1, "Workspace id is required."),
    name: z
      .string()
      .trim()
      .min(1, "Workspace name is required.")
      .regex(
        workspaceNamePattern,
        "Workspace names may only contain letters, numbers, dashes, and underscores.",
      ),
    services: z.array(serviceConfigSchema),
  })
  .superRefine((workspace, context) => {
    const seenServiceNames = new Set<string>();

    for (const [index, service] of workspace.services.entries()) {
      if (seenServiceNames.has(service.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate service name "${service.name}" in workspace "${workspace.name}".`,
          path: ["services", index, "name"],
        });
      }

      seenServiceNames.add(service.name);
    }
  });

export const appConfigSchema = z
  .object({
    version: z.literal(1),
    workspaces: z.array(workspaceConfigSchema),
  })
  .superRefine((config, context) => {
    const seenWorkspaceNames = new Set<string>();

    for (const [index, workspace] of config.workspaces.entries()) {
      if (seenWorkspaceNames.has(workspace.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate workspace name "${workspace.name}".`,
          path: ["workspaces", index, "name"],
        });
      }

      seenWorkspaceNames.add(workspace.name);
    }
  });

export function validateAppConfig(input: unknown) {
  return appConfigSchema.parse(input);
}

export function safeValidateAppConfig(input: unknown) {
  return appConfigSchema.safeParse(input);
}

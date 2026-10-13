import { z } from "zod";
import { findDependencyCycle } from "./workspace-items.js";

const workspaceNamePattern = /^[A-Za-z0-9_-]+$/;

const itemFields = {
  id: z.string().trim().min(1, "Item id is required."),
  name: z.string().trim().min(1, "Name is required."),
  command: z.string().trim().min(1, "Command is required."),
  cwd: z.string().trim().min(1, "Working directory is required."),
  env: z.record(z.string(), z.string()),
  // Ids of the items that must be up (a service) or done (a command) before this one starts.
  after: z.array(z.string().trim().min(1, "An id in \"after\" can't be empty.")).default([]),
  // The name of the matching item in the project's sable.json, for items that came from it.
  fromProject: z.string().trim().min(1).optional(),
};

export const serviceConfigSchema = z.object({
  kind: z.literal("service"),
  ...itemFields,
  autoStart: z.boolean(),
});

export const commandConfigSchema = z.object({
  kind: z.literal("command"),
  ...itemFields,
});

export const itemConfigSchema = z.discriminatedUnion("kind", [serviceConfigSchema, commandConfigSchema]);

// What the project's sable.json said for one item, after placeholders were filled in. Kept so a
// later sync can tell the file's changes apart from changes made on this machine.
export const projectBaseItemSchema = z.object({
  kind: z.enum(["service", "command"]),
  command: z.string(),
  cwd: z.string(),
  env: z.record(z.string(), z.string()),
  autoStart: z.boolean().optional(),
  after: z.array(z.string()),
});

export const workspaceProjectSchema = z.object({
  // Hash of the sable.json content the user approved.
  hash: z.string().trim().min(1),
  // This machine's answers for the file's placeholders.
  values: z.record(z.string(), z.string()).default({}),
  base: z.record(z.string(), projectBaseItemSchema).default({}),
  // Items of the file the user removed here; a sync does not bring them back.
  removed: z.array(z.string()).default([]),
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
    projectDirectory: z.string().trim().min(1, "Workspace project directory is required."),
    items: z.array(itemConfigSchema),
    project: workspaceProjectSchema.optional(),
  })
  .superRefine((workspace, context) => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (const [index, item] of workspace.items.entries()) {
      if (seenIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate id "${item.id}" in workspace "${workspace.name}".`,
          path: ["items", index, "id"],
        });
      }

      seenIds.add(item.id);

      // A service and a command may share a name, so names are unique per kind.
      const nameKey = `${item.kind}:${item.name}`;

      if (seenNames.has(nameKey)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate ${item.kind} name "${item.name}" in workspace "${workspace.name}".`,
          path: ["items", index, "name"],
        });
      }

      seenNames.add(nameKey);
    }

    for (const [index, item] of workspace.items.entries()) {
      for (const [afterIndex, afterId] of item.after.entries()) {
        if (!seenIds.has(afterId)) {
          context.addIssue({
            code: "custom",
            message: `"${item.name}" waits for an item with id "${afterId}", which isn't in workspace "${workspace.name}".`,
            path: ["items", index, "after", afterIndex],
          });
        }
      }
    }

    const cycle = findDependencyCycle(workspace.items);

    if (cycle !== undefined) {
      context.addIssue({
        code: "custom",
        message: `Items wait for each other in a loop: ${cycle.join(" → ")}.`,
        path: ["items"],
      });
    }
  });

export const appConfigSchema = z
  .object({
    version: z.literal(2),
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

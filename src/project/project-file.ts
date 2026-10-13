import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { findDependencyCycle } from "../config/workspace-items.js";

export const projectFileName = "sable.json";

const placeholderName = /^[A-Z][A-Z0-9_]*$/;
const placeholderUse = /\{\{([^{}]*)\}\}/g;
const envKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
const workspaceName = /^[A-Za-z0-9_-]+$/;

const projectItemSchema = z
  .object({
    type: z.enum(["service", "command"]),
    name: z.string().trim().min(1, "Every item needs a name."),
    command: z.string().trim().min(1, "Every item needs a command."),
    cwd: z.string().trim().min(1).default("."),
    autoStart: z.boolean().optional(),
    after: z.array(z.string().trim().min(1)).default([]),
    env: z.record(z.string(), z.string()).default({}),
    // Variables each person sets for themselves: the file names them but never holds a value.
    secrets: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const placeholderSchema = z
  .object({
    description: z.string().optional(),
    default: z.string().optional(),
  })
  .strict();

const projectFileSchema = z
  .object({
    version: z.literal(1),
    name: z
      .string()
      .trim()
      .regex(workspaceName, "The workspace name may only contain letters, numbers, dashes, and underscores.")
      .optional(),
    placeholders: z.record(z.string(), placeholderSchema).default({}),
    items: z.array(projectItemSchema),
  })
  .strict()
  .superRefine((file, context) => {
    const names = new Set<string>();

    for (const name of Object.keys(file.placeholders)) {
      if (!placeholderName.test(name)) {
        context.addIssue({
          code: "custom",
          message: `"${name}" is not a valid placeholder name. Use capital letters, digits and underscores, like API_PORT.`,
          path: ["placeholders", name],
        });
      }
    }

    for (const [index, item] of file.items.entries()) {
      const at = (...rest: Array<string | number>) => ["items", index, ...rest];

      if (names.has(item.name)) {
        context.addIssue({ code: "custom", message: `Two items are named "${item.name}".`, path: at("name") });
      }

      names.add(item.name);

      if (item.type === "command" && item.autoStart !== undefined) {
        context.addIssue({ code: "custom", message: "Only services can auto-start.", path: at("autoStart") });
      }

      if (path.posix.isAbsolute(item.cwd) || path.win32.isAbsolute(item.cwd)) {
        context.addIssue({
          code: "custom",
          message: "Use a folder relative to the project, like \"api\" or \".\". A full path only works on one machine.",
          path: at("cwd"),
        });
      } else if (path.posix.normalize(item.cwd.replaceAll("\\", "/")).startsWith("..")) {
        context.addIssue({ code: "custom", message: "A folder can't be outside the project.", path: at("cwd") });
      }

      for (const key of Object.keys(item.env)) {
        if (!envKey.test(key)) {
          context.addIssue({ code: "custom", message: `"${key}" is not a valid environment variable name.`, path: at("env", key) });
        }
      }

      const seenSecrets = new Set<string>();

      for (const [secretIndex, key] of item.secrets.entries()) {
        const where = at("secrets", secretIndex);

        if (!envKey.test(key)) {
          context.addIssue({ code: "custom", message: `"${key}" is not a valid environment variable name.`, path: where });
        } else if (seenSecrets.has(key)) {
          context.addIssue({ code: "custom", message: `"${key}" is listed twice.`, path: where });
        } else if (item.env[key] !== undefined) {
          context.addIssue({ code: "custom", message: `"${key}" is a secret, so it can't have a value in "env". Remove the value from the file.`, path: where });
        }

        seenSecrets.add(key);
      }

      const used = [
        { text: item.command, where: at("command") },
        ...Object.entries(item.env).map(([key, value]) => ({ text: value, where: at("env", key) })),
      ];

      for (const { text, where } of used) {
        for (const match of text.matchAll(placeholderUse)) {
          if (file.placeholders[match[1]!] === undefined) {
            context.addIssue({
              code: "custom",
              message: `{{${match[1]}}} is not declared. Add it under "placeholders".`,
              path: where,
            });
          }
        }
      }

      if (item.cwd.includes("{{")) {
        context.addIssue({ code: "custom", message: "A folder can't contain a placeholder.", path: at("cwd") });
      }
    }

    for (const [index, item] of file.items.entries()) {
      for (const [afterIndex, afterName] of item.after.entries()) {
        const where = ["items", index, "after", afterIndex];

        if (afterName === item.name) {
          context.addIssue({ code: "custom", message: "An item can't wait for itself.", path: where });
        } else if (!names.has(afterName)) {
          context.addIssue({ code: "custom", message: `There is no item named "${afterName}".`, path: where });
        }
      }
    }

    const cycle = findDependencyCycle(file.items.map((item) => ({ id: item.name, name: item.name, after: item.after })));

    if (cycle !== undefined) {
      context.addIssue({ code: "custom", message: `Items wait for each other in a loop: ${cycle.join(" → ")}.`, path: ["items"] });
    }
  });

export type ProjectFile = z.infer<typeof projectFileSchema>;
export type ProjectItem = ProjectFile["items"][number];

export type ProjectFileReadResult =
  | { type: "missing" }
  | { type: "invalid"; message: string }
  | { type: "ok"; file: ProjectFile; hash: string };

export function projectFilePath(directory: string): string {
  return path.join(directory, projectFileName);
}

export async function readProjectFile(directory: string): Promise<ProjectFileReadResult> {
  let raw: string;

  try {
    raw = await fs.readFile(projectFilePath(directory), "utf8");
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { type: "missing" };
    }

    return { type: "invalid", message: `Could not read ${projectFileName}: ${error instanceof Error ? error.message : String(error)}` };
  }

  return parseProjectFile(raw);
}

export function parseProjectFile(raw: string): ProjectFileReadResult {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { type: "invalid", message: `${projectFileName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }

  const parsed = projectFileSchema.safeParse(json);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const where = issue.path.map(String).join(".");

      return where === "" ? `  - ${issue.message}` : `  - ${where}: ${issue.message}`;
    });

    return { type: "invalid", message: [`${projectFileName} has problems:`, ...lines].join("\n") };
  }

  return { type: "ok", file: parsed.data, hash: hashOf(json) };
}

// The same content gives the same hash whatever the spacing or key order in the file.
export function hashOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

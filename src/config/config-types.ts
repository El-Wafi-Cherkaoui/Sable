import type { z } from "zod";
import type {
  appConfigSchema,
  commandConfigSchema,
  itemConfigSchema,
  serviceConfigSchema,
  workspaceConfigSchema,
} from "./config-schema.js";

export type AppConfig = z.infer<typeof appConfigSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type ItemConfig = z.infer<typeof itemConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
export type CommandConfig = z.infer<typeof commandConfigSchema>;
export type ItemKind = ItemConfig["kind"];

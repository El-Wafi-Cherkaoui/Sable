import type { z } from "zod";
import type {
  appConfigSchema,
  serviceConfigSchema,
  workspaceConfigSchema,
} from "./config-schema.js";

export type AppConfig = z.infer<typeof appConfigSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

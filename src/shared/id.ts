import { randomBytes } from "node:crypto";

export type IdPrefix = "ws" | "svc";

export function generateShortId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(6).toString("base64url")}`;
}

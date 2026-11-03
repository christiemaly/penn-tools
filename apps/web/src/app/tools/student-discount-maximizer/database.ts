// The tool's database client, and how to tell "not set up yet" from a real
// failure. The studentdiscountmaximizer role and schema exist only once the
// Platform team lists the tool in TOOLS in packages/platform/scripts/setup-tools.mjs
// and db:deploy has run.

import "server-only";
import { toolSql } from "@penntools/platform/db";

export const DB_ROLE = "studentdiscountmaximizer";

export const NOT_SET_UP_MESSAGE =
  "Student Discount Central's database isn't set up yet. It needs the Platform team to register the tool's database.";

export function db() {
  return toolSql(DB_ROLE);
}

/**
 * Whether `error` means the tool's database hasn't been created: its role
 * can't sign in, or its tables don't exist.
 */
export function isNotSetUp(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  // 28P01/28000: the role is missing or can't sign in; 42P01: no such table.
  return code === "28P01" || code === "28000" || code === "42P01";
}

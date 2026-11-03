// The tool's database client, and how to tell "not set up yet" from a real
// failure. The studentdiscountmaximizer role and schema exist only once the
// Platform team lists the tool in TOOLS in packages/platform/scripts/setup-tools.mjs
// and db:deploy has run.

import "server-only";
import { toolSql } from "@penntools/platform/db";

export const DB_ROLE = "studentdiscountmaximizer";

export const NOT_SET_UP_MESSAGE =
  "Student Discount Central's database isn't set up yet. It needs the Platform team to register the tool's database.";

export const OUT_OF_DATE_MESSAGE =
  "Student Discount Central's database is out of date: the code expects a newer schema.sql than the database has. " +
  "It updates on the next deploy; locally, re-apply schema.sql.";

export function db() {
  return toolSql(DB_ROLE);
}

/**
 * The message to show when `error` means the tool's database isn't ready (its
 * role can't sign in, or its tables or columns don't exist yet), or null for
 * any other failure.
 */
export function setupProblem(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  // 28P01/28000: the role is missing or can't sign in; 42P01: no such table.
  if (code === "28P01" || code === "28000" || code === "42P01") return NOT_SET_UP_MESSAGE;
  // 42703: no such column, when schema.sql gained one the database hasn't applied yet.
  if (code === "42703") return OUT_OF_DATE_MESSAGE;
  return null;
}

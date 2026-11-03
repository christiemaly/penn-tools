// Student discounts and students' votes on them, in the tool's own
// studentdiscountmaximizer schema. Callers pass the database client
// (toolSql("studentdiscountmaximizer")) and, where it matters, the signed-in
// user's id.
//
// A deal expires when a student marks it expired, or on its own once enough
// students say it doesn't work (see vote). Restoring a deal clears its
// votes, so it starts fresh.

import type { Sql } from "postgres";

export const KINDS = ["code", "online", "local"] as const;
export type DiscountKind = (typeof KINDS)[number];

export const KIND_LABELS: Record<DiscountKind, string> = {
  code: "Promo code",
  online: "Online deal",
  local: "Local spot",
};

export const CATEGORIES = ["food", "entertainment", "tech", "shopping", "travel", "culture", "fitness", "other"] as const;
export type DiscountCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DiscountCategory, string> = {
  food: "Food & drink",
  entertainment: "Entertainment",
  tech: "Tech & software",
  shopping: "Shopping",
  travel: "Travel",
  culture: "Museums & culture",
  fitness: "Fitness",
  other: "Other",
};

/** Where a local spot is, in the order the page groups them: campus first. */
export const NEIGHBORHOODS = [
  "university-city",
  "center-city",
  "rittenhouse",
  "old-city",
  "fairmount",
  "south-philly",
  "fishtown",
  "other",
] as const;
export type Neighborhood = (typeof NEIGHBORHOODS)[number];

export const NEIGHBORHOOD_LABELS: Record<Neighborhood, string> = {
  "university-city": "University City",
  "center-city": "Center City",
  rittenhouse: "Rittenhouse",
  "old-city": "Old City",
  fairmount: "Fairmount / Art Museum",
  "south-philly": "South Philly",
  fishtown: "Fishtown / Northern Liberties",
  other: "Other Philly",
};

export type DiscountStatus = "active" | "expired";
export type DiscountSort = "top" | "new";
/** Penn-specific deals are only for Penn students (PennCard perks, Penn-only prices); general ones are for any student. */
export type DiscountAudience = "penn" | "general";

/** Most deals a student can add in a day, to keep spam down. */
export const DAILY_SUBMISSION_LIMIT = 20;
/** "Doesn't work" votes needed before votes alone can expire a deal. */
export const EXPIRE_MIN_NOT_WORKING = 3;

export const LIMITS = {
  business: 100,
  title: 150,
  discount: 100,
  code: 60,
  location: 200,
  url: 500,
  howToClaim: 1000,
  search: 100,
} as const;

export interface Discount {
  id: string;
  kind: DiscountKind;
  business: string;
  title: string;
  /** What you get, e.g. "50% off" or "Free admission". */
  discount: string;
  code: string | null;
  location: string | null;
  /** Local spots only. */
  neighborhood: Neighborhood | null;
  /** A Google Maps link to the spot, for local spots with a location. */
  mapsUrl: string | null;
  url: string | null;
  howToClaim: string;
  category: DiscountCategory;
  /** Only for Penn students, rather than any student. */
  pennSpecific: boolean;
  source: "starter" | "student";
  status: DiscountStatus;
  /** Why it expired: a student marked it, or votes did. Null while active. */
  expiredReason: "marked" | "votes" | null;
  /** ISO timestamp of the last status change. */
  statusChangedAt: string;
  createdAt: string;
  works: number;
  notWorking: number;
  /** The signed-in student's vote: true "works", false "doesn't work", null none. */
  myVote: boolean | null;
}

/** A deal a student adds. Empty optional fields are null. */
export interface NewDiscount {
  kind: DiscountKind;
  business: string;
  title: string;
  discount: string;
  code: string | null;
  location: string | null;
  neighborhood: Neighborhood | null;
  url: string | null;
  howToClaim: string;
  category: DiscountCategory;
  pennSpecific: boolean;
}

export interface ListOptions {
  /** The signed-in student, to include their votes; null when signed out. */
  userId: string | null;
  status: DiscountStatus;
  kind?: DiscountKind | null;
  category?: DiscountCategory | null;
  audience?: DiscountAudience | null;
  /** Only local spots in this neighborhood. */
  neighborhood?: Neighborhood | null;
  search?: string | null;
  sort?: DiscountSort;
  limit?: number;
}

/** A problem to show the student: bad input, a missing deal, or the daily limit. */
export class DiscountError extends Error {
  override name = "DiscountError";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An http(s) address with a host and no spaces. */
const WEB_LINK_RE = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i;

// ── Checking input ────────────────────────────────────────────────────────────

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value !== null && value !== undefined && typeof value !== "string") throw new DiscountError(`${label} must be text.`);
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    if (required) throw new DiscountError(`Enter ${label.toLowerCase()}.`);
    return null;
  }
  if (trimmed.length > max) throw new DiscountError(`Keep ${label.toLowerCase()} to at most ${max} characters.`);
  return trimmed;
}

function link(value: unknown, required: boolean): string | null {
  const url = text(value, "Link", LIMITS.url, required);
  if (url === null) return null;
  // Only web links: the page renders this as an href, so a javascript: link must never get through.
  if (!WEB_LINK_RE.test(url)) {
    throw new DiscountError("Enter the link as a full web address, starting with https://.");
  }
  return url;
}

/** A new deal from the browser's input, checked; throws DiscountError if something's wrong. */
export function checkNewDiscount(input: unknown): NewDiscount {
  if (typeof input !== "object" || input === null) throw new DiscountError("Fill in the deal's details.");
  const raw = input as Record<string, unknown>;
  const kind = raw["kind"];
  if (!KINDS.includes(kind as DiscountKind)) throw new DiscountError("Choose what kind of deal it is.");
  const category = raw["category"];
  if (!CATEGORIES.includes(category as DiscountCategory)) throw new DiscountError("Choose a category.");
  // Only local spots have a neighborhood; it's ignored for the others.
  const neighborhood = kind === "local" ? raw["neighborhood"] : null;
  if (kind === "local" && !NEIGHBORHOODS.includes(neighborhood as Neighborhood)) {
    throw new DiscountError("Choose the spot's neighborhood.");
  }

  return {
    kind: kind as DiscountKind,
    business: text(raw["business"], "Business", LIMITS.business, true)!,
    title: text(raw["title"], "Title", LIMITS.title, true)!,
    discount: text(raw["discount"], "Discount", LIMITS.discount, true)!,
    code: text(raw["code"], "Code", LIMITS.code, kind === "code"),
    location: text(raw["location"], "Location", LIMITS.location, kind === "local"),
    neighborhood: neighborhood as Neighborhood | null,
    // Codes and online deals are used on a website; local spots may not have one.
    url: link(raw["url"], kind !== "local"),
    howToClaim: text(raw["howToClaim"], "How to claim", LIMITS.howToClaim, false) ?? "",
    category: category as DiscountCategory,
    pennSpecific: raw["pennSpecific"] === true,
  };
}

// ── Reading ───────────────────────────────────────────────────────────────────

interface DiscountRow {
  id: string;
  kind: DiscountKind;
  business: string;
  title: string;
  discount: string;
  code: string | null;
  location: string | null;
  neighborhood: Neighborhood | null;
  url: string | null;
  how_to_claim: string;
  category: DiscountCategory;
  penn_specific: boolean;
  source: "starter" | "student";
  status: DiscountStatus;
  expired_reason: "marked" | "votes" | null;
  status_changed_at: Date;
  created_at: Date;
  works: string;
  not_working: string;
  my_vote: boolean | null;
}

function toDiscount(row: DiscountRow): Discount {
  return {
    id: row.id,
    kind: row.kind,
    business: row.business,
    title: row.title,
    discount: row.discount,
    code: row.code,
    location: row.location,
    neighborhood: row.neighborhood,
    mapsUrl: row.kind === "local" && row.location ? mapsUrl(row.business, row.location) : null,
    url: row.url,
    howToClaim: row.how_to_claim,
    category: row.category,
    pennSpecific: row.penn_specific,
    source: row.source,
    status: row.status,
    expiredReason: row.expired_reason,
    statusChangedAt: row.status_changed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    works: Number(row.works),
    notWorking: Number(row.not_working),
    myVote: row.my_vote,
  };
}

/**
 * A Google Maps search for the spot, which opens the place (or the Maps app on
 * a phone). A plain link: no API key, nothing embedded.
 */
export function mapsUrl(business: string, location: string): string {
  const place = /philadelphia/i.test(location) ? location : `${location}, Philadelphia, PA`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business}, ${place}`)}`;
}

/** Escapes LIKE wildcards so a search for "50%" finds the text "50%". */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Deals matching the filters, each with its vote counts and the student's own vote. */
export async function listDiscounts(sql: Sql, options: ListOptions): Promise<Discount[]> {
  const { userId, status, kind, category, audience, neighborhood, sort = "top", limit = 200 } = options;
  const search = options.search?.trim().slice(0, LIMITS.search);
  const pattern = search ? likePattern(search) : null;

  const order =
    status === "expired"
      ? sql`d.status_changed_at DESC`
      : sort === "new"
        ? sql`d.created_at DESC`
        : sql`COUNT(v.user_id) FILTER (WHERE v.works) - COUNT(v.user_id) FILTER (WHERE NOT v.works) DESC, d.created_at DESC`;

  const rows = await sql<DiscountRow[]>`
    SELECT d.id, d.kind, d.business, d.title, d.discount, d.code, d.location, d.neighborhood, d.url,
           d.how_to_claim, d.category, d.penn_specific, d.source, d.status, d.expired_reason,
           d.status_changed_at, d.created_at,
           COUNT(v.user_id) FILTER (WHERE v.works) AS works,
           COUNT(v.user_id) FILTER (WHERE NOT v.works) AS not_working,
           BOOL_OR(v.works) FILTER (WHERE v.user_id = ${userId ?? ""}) AS my_vote
    FROM discounts d
    LEFT JOIN votes v ON v.discount_id = d.id
    WHERE d.status = ${status}
      ${kind ? sql`AND d.kind = ${kind}` : sql``}
      ${category ? sql`AND d.category = ${category}` : sql``}
      ${audience ? sql`AND d.penn_specific = ${audience === "penn"}` : sql``}
      ${neighborhood ? sql`AND d.kind = 'local' AND d.neighborhood = ${neighborhood}` : sql``}
      ${
        pattern
          ? sql`AND (d.business ILIKE ${pattern} OR d.title ILIKE ${pattern}
                  OR d.discount ILIKE ${pattern} OR d.location ILIKE ${pattern})`
          : sql``
      }
    GROUP BY d.id
    ORDER BY ${order}
    LIMIT ${limit}
  `;
  return rows.map(toDiscount);
}

/** One deal with its votes, or null if there's no such deal. */
export async function getDiscount(sql: Sql, id: string, userId: string | null): Promise<Discount | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await sql<DiscountRow[]>`
    SELECT d.id, d.kind, d.business, d.title, d.discount, d.code, d.location, d.neighborhood, d.url,
           d.how_to_claim, d.category, d.penn_specific, d.source, d.status, d.expired_reason,
           d.status_changed_at, d.created_at,
           COUNT(v.user_id) FILTER (WHERE v.works) AS works,
           COUNT(v.user_id) FILTER (WHERE NOT v.works) AS not_working,
           BOOL_OR(v.works) FILTER (WHERE v.user_id = ${userId ?? ""}) AS my_vote
    FROM discounts d
    LEFT JOIN votes v ON v.discount_id = d.id
    WHERE d.id = ${id}
    GROUP BY d.id
  `;
  return row ? toDiscount(row) : null;
}

// ── Writing ───────────────────────────────────────────────────────────────────

/** Adds a student's deal (checked with checkNewDiscount) and returns it. */
export async function addDiscount(sql: Sql, userId: string, input: unknown): Promise<Discount> {
  const deal = checkNewDiscount(input);
  const [recent] = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM discounts
    WHERE created_by = ${userId} AND created_at > NOW() - INTERVAL '1 day'
  `;
  if (Number(recent!.count) >= DAILY_SUBMISSION_LIMIT) {
    throw new DiscountError(`You can add up to ${DAILY_SUBMISSION_LIMIT} deals a day. Try again tomorrow.`);
  }

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO discounts (kind, business, title, discount, code, location, neighborhood, url, how_to_claim,
                           category, penn_specific, source, created_by)
    VALUES (${deal.kind}, ${deal.business}, ${deal.title}, ${deal.discount}, ${deal.code}, ${deal.location},
            ${deal.neighborhood}, ${deal.url}, ${deal.howToClaim}, ${deal.category}, ${deal.pennSpecific}, 'student', ${userId})
    RETURNING id
  `;
  return (await getDiscount(sql, row!.id, userId))!;
}

/**
 * Records the student's vote on an active deal (true "works", false "doesn't
 * work", null to take it back) and expires the deal if votes now say it's dead.
 */
export async function vote(sql: Sql, userId: string, discountId: string, works: boolean | null): Promise<Discount> {
  if (!UUID_RE.test(discountId)) throw new DiscountError("That deal doesn't exist.");
  if (works !== null && typeof works !== "boolean") throw new DiscountError("That isn't a vote.");

  // Each statement is atomic, and the expiry check counts every vote committed
  // by the time it runs, so of two last votes at once, the later one expires the deal.
  const changed =
    works === null
      ? await sql`
          DELETE FROM votes v USING discounts d
          WHERE v.discount_id = d.id AND d.id = ${discountId} AND d.status = 'active' AND v.user_id = ${userId}
        `
      : await sql`
          INSERT INTO votes (discount_id, user_id, works)
          SELECT id, ${userId}, ${works} FROM discounts WHERE id = ${discountId} AND status = 'active'
          ON CONFLICT (discount_id, user_id) DO UPDATE SET works = EXCLUDED.works, updated_at = NOW()
        `;
  if (changed.count === 0) {
    const deal = await getDiscount(sql, discountId, userId);
    if (!deal) throw new DiscountError("That deal doesn't exist.");
    if (deal.status === "expired") throw new DiscountError("This deal has expired. Restore it to vote on it.");
    return deal; // taking back a vote that wasn't there
  }

  // Votes expire a deal once "doesn't work" reaches EXPIRE_MIN_NOT_WORKING and
  // outnumbers "works" at least two to one.
  await sql`
    UPDATE discounts
    SET status = 'expired', expired_reason = 'votes', status_changed_at = NOW(), status_changed_by = NULL
    WHERE id = ${discountId} AND status = 'active'
      AND (SELECT COUNT(*) FILTER (WHERE NOT works) >= ${EXPIRE_MIN_NOT_WORKING}
              AND COUNT(*) FILTER (WHERE NOT works) >= 2 * COUNT(*) FILTER (WHERE works)
           FROM votes WHERE discount_id = ${discountId})
  `;
  return (await getDiscount(sql, discountId, userId))!;
}

/** Moves an active deal to Expired, on a student's say-so. */
export async function markExpired(sql: Sql, userId: string, discountId: string): Promise<Discount> {
  if (!UUID_RE.test(discountId)) throw new DiscountError("That deal doesn't exist.");
  const updated = await sql`
    UPDATE discounts
    SET status = 'expired', expired_reason = 'marked', status_changed_at = NOW(), status_changed_by = ${userId}
    WHERE id = ${discountId} AND status = 'active'
  `;
  if (updated.count === 0) await assertExists(sql, discountId);
  return (await getDiscount(sql, discountId, userId))!;
}

/** Brings an expired deal back, with its votes cleared so it starts fresh. */
export async function restore(sql: Sql, userId: string, discountId: string): Promise<Discount> {
  if (!UUID_RE.test(discountId)) throw new DiscountError("That deal doesn't exist.");
  // One statement, so no vote can land between the restore and the clearing.
  const restored = await sql`
    WITH restored AS (
      UPDATE discounts
      SET status = 'active', expired_reason = NULL, status_changed_at = NOW(), status_changed_by = ${userId}
      WHERE id = ${discountId} AND status = 'expired'
      RETURNING id
    )
    DELETE FROM votes WHERE discount_id IN (SELECT id FROM restored)
  `;
  if (restored.count === 0) await assertExists(sql, discountId);
  return (await getDiscount(sql, discountId, userId))!;
}

async function assertExists(sql: Sql, discountId: string): Promise<void> {
  const [row] = await sql`SELECT 1 FROM discounts WHERE id = ${discountId}`;
  if (!row) throw new DiscountError("That deal doesn't exist.");
}

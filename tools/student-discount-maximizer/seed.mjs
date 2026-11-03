// ─────────────────────────────────────────────────────────────────────────────
// Student Discount Central seed: the starter list of well-known deals.
//
// Run by `db:deploy` after schema.sql, on every deploy (see
// packages/platform/scripts/setup-tools.mjs), with a client connected as the
// studentdiscountmaximizer role. Deals already in the database (by slug) are
// left alone, so students' votes and expiries survive later deploys; to add a
// starter deal, add it to data/starter-discounts.json with a new slug.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const DATA_PATH = new URL("./data/starter-discounts.json", import.meta.url);

/** @param {{ sql: import("postgres").Sql }} deps */
export default async function seed({ sql }) {
  const deals = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")).map((deal) => ({
    slug: deal.slug,
    kind: deal.kind,
    business: deal.business,
    title: deal.title,
    discount: deal.discount,
    code: deal.code ?? null,
    location: deal.location ?? null,
    url: deal.url ?? null,
    how_to_claim: deal.howToClaim ?? "",
    category: deal.category,
    source: "starter",
  }));
  if (deals.length === 0) return;

  const added = await sql`INSERT INTO discounts ${sql(deals)} ON CONFLICT (slug) DO NOTHING`;
  if (added.count > 0) console.log(`  added ${added.count} starter deals`);
}

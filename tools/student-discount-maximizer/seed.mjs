// ─────────────────────────────────────────────────────────────────────────────
// Student Discount Central seed: the starter list of well-known deals.
//
// Run by `db:deploy` after schema.sql, on every deploy (see
// packages/platform/scripts/setup-tools.mjs), with a client connected as the
// studentdiscountmaximizer role. Each deal in data/starter-discounts.json is
// matched by its slug: new ones are added, and existing ones get the file's
// details, keeping their votes and status, so students' votes and expiries
// survive later deploys. To add a starter deal, give it a new slug.
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
    neighborhood: deal.neighborhood ?? null,
    url: deal.url ?? null,
    how_to_claim: deal.howToClaim ?? "",
    category: deal.category,
    penn_specific: deal.pennSpecific === true,
    source: "starter",
  }));
  if (deals.length === 0) return;

  // Updates only rows whose details changed, so a deploy without changes writes nothing.
  const changed = await sql`
    INSERT INTO discounts ${sql(deals)}
    ON CONFLICT (slug) DO UPDATE SET
      kind = EXCLUDED.kind, business = EXCLUDED.business, title = EXCLUDED.title,
      discount = EXCLUDED.discount, code = EXCLUDED.code, location = EXCLUDED.location,
      neighborhood = EXCLUDED.neighborhood, url = EXCLUDED.url, how_to_claim = EXCLUDED.how_to_claim,
      category = EXCLUDED.category, penn_specific = EXCLUDED.penn_specific
    WHERE (discounts.kind, discounts.business, discounts.title, discounts.discount, discounts.code,
           discounts.location, discounts.neighborhood, discounts.url, discounts.how_to_claim,
           discounts.category, discounts.penn_specific)
      IS DISTINCT FROM
          (EXCLUDED.kind, EXCLUDED.business, EXCLUDED.title, EXCLUDED.discount, EXCLUDED.code,
           EXCLUDED.location, EXCLUDED.neighborhood, EXCLUDED.url, EXCLUDED.how_to_claim,
           EXCLUDED.category, EXCLUDED.penn_specific)
  `;
  if (changed.count > 0) console.log(`  added or updated ${changed.count} starter deals`);
}

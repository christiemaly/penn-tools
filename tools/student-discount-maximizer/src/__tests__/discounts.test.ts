// Deals, votes and expiry against a real Postgres: each run creates a
// throwaway schema from schema.sql, seeds it with seed.mjs and drops it
// afterwards. Skipped when no database is configured (DATABASE_URL, or
// apps/web/.env.local).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { Sql } from "postgres";
import {
  DAILY_SUBMISSION_LIMIT,
  DiscountError,
  addDiscount,
  checkNewDiscount,
  listDiscounts,
  markExpired,
  restore,
  vote,
} from "../discounts.js";

const envFile = fileURLToPath(new URL("../../../../apps/web/.env.local", import.meta.url));
if (!process.env["DATABASE_URL"] && existsSync(envFile)) process.loadEnvFile(envFile);
const databaseUrl = process.env["DATABASE_URL"];

const schemaSql = readFileSync(fileURLToPath(new URL("../../schema.sql", import.meta.url)), "utf8");
const seedUrl = new URL("../../seed.mjs", import.meta.url);
const starterDeals: unknown[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/starter-discounts.json", import.meta.url)), "utf8"),
);
const schema = `discounts_test_${Date.now()}`;

let admin: Sql;
let sql: Sql;

const DEAL = {
  kind: "code",
  business: "Test Bagels",
  title: "Bagel deal",
  discount: "37% off",
  code: "PENN37",
  location: null,
  url: "https://bagels.example.com/order",
  howToClaim: "Enter the code at checkout.",
  category: "food",
};

describe("checkNewDiscount", () => {
  it("accepts a complete deal and trims it", () => {
    expect(checkNewDiscount({ ...DEAL, business: "  Test Bagels  ", location: "" })).toMatchObject({
      business: "Test Bagels",
      location: null,
    });
  });

  it("requires a code for promo codes, a location for local spots and a web link otherwise", () => {
    expect(() => checkNewDiscount({ ...DEAL, code: "" })).toThrow("Enter code.");
    expect(() => checkNewDiscount({ ...DEAL, kind: "local", location: " " })).toThrow("Enter location.");
    expect(checkNewDiscount({ ...DEAL, kind: "local", location: "3601 Walnut St", url: "" }).url).toBeNull();
    expect(() => checkNewDiscount({ ...DEAL, url: "" })).toThrow("Enter link.");
  });

  it("rejects links that aren't web addresses", () => {
    for (const url of ["javascript:alert(1)", "bagels.example.com", "https://", "ftp://example.com/x"]) {
      expect(() => checkNewDiscount({ ...DEAL, url })).toThrow(DiscountError);
    }
  });

  it("rejects unknown kinds and categories, and overlong text", () => {
    expect(() => checkNewDiscount({ ...DEAL, kind: "coupon" })).toThrow("Choose what kind");
    expect(() => checkNewDiscount({ ...DEAL, category: "pets" })).toThrow("Choose a category");
    expect(() => checkNewDiscount({ ...DEAL, title: "x".repeat(151) })).toThrow("at most 150");
    expect(() => checkNewDiscount(null)).toThrow(DiscountError);
  });

  it("accepts every starter deal", () => {
    for (const deal of starterDeals) expect(() => checkNewDiscount(deal)).not.toThrow();
  });
});

describe.skipIf(!databaseUrl)("Student Discount Central storage (Postgres)", () => {
  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = postgres(databaseUrl!, { max: 1, onnotice: () => {}, connection: { search_path: schema } });
    await sql.unsafe(schemaSql);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it("schema.sql can be applied again to an existing schema", async () => {
    await expect(sql.unsafe(schemaSql)).resolves.toBeDefined();
  });

  it("seeds the starter list once, keeping changes on later runs", async () => {
    const { default: seed } = await import(seedUrl.href);
    await seed({ sql });
    const starters = await listDiscounts(sql, { userId: null, status: "active" });
    expect(starters).toHaveLength(starterDeals.length);
    expect(starters.every((d) => d.source === "starter")).toBe(true);

    await markExpired(sql, "alice", starters[0]!.id);
    await seed({ sql });
    expect(await listDiscounts(sql, { userId: null, status: "active" })).toHaveLength(starterDeals.length - 1);
    await restore(sql, "alice", starters[0]!.id);
  });

  it("adds a student's deal and filters by kind, category and search", async () => {
    const added = await addDiscount(sql, "bob", DEAL);
    expect(added).toMatchObject({ source: "student", status: "active", works: 0, notWorking: 0, myVote: null });

    const ids = async (options: Parameters<typeof listDiscounts>[1]) => (await listDiscounts(sql, options)).map((d) => d.id);
    expect(await ids({ userId: null, status: "active", kind: "code" })).toEqual([added.id]);
    expect(await ids({ userId: null, status: "active", category: "food" })).toEqual([added.id]);
    expect(await ids({ userId: null, status: "active", search: "bagel" })).toEqual([added.id]);
    expect(await ids({ userId: null, status: "active", search: "37%" })).toEqual([added.id]);
    expect(await ids({ userId: null, status: "active", search: "100%" })).toEqual([]);
    expect(await ids({ userId: null, status: "expired" })).not.toContain(added.id);
  });

  it("keeps one vote per student, which they can change or take back", async () => {
    const deal = await addDiscount(sql, "carol", { ...DEAL, title: "Votes" });
    expect(await vote(sql, "carol", deal.id, true)).toMatchObject({ works: 1, notWorking: 0, myVote: true });
    expect(await vote(sql, "carol", deal.id, true)).toMatchObject({ works: 1, notWorking: 0 });
    expect(await vote(sql, "carol", deal.id, false)).toMatchObject({ works: 0, notWorking: 1, myVote: false });
    expect(await vote(sql, "carol", deal.id, null)).toMatchObject({ works: 0, notWorking: 0, myVote: null });
    expect(await vote(sql, "carol", deal.id, null)).toMatchObject({ works: 0, notWorking: 0 });

    await vote(sql, "dave", deal.id, true);
    const [seenByDave] = (await listDiscounts(sql, { userId: "dave", status: "active", search: "Votes" }));
    const [seenSignedOut] = (await listDiscounts(sql, { userId: null, status: "active", search: "Votes" }));
    expect(seenByDave?.myVote).toBe(true);
    expect(seenSignedOut?.myVote).toBeNull();
  });

  it("ranks deals by works minus doesn't-work votes", async () => {
    const low = await addDiscount(sql, "erin", { ...DEAL, business: "Zqx Low" });
    const high = await addDiscount(sql, "erin", { ...DEAL, business: "Zqx High" });
    await vote(sql, "u1", high.id, true);
    await vote(sql, "u2", high.id, true);
    await vote(sql, "u1", low.id, false);
    const ranked = (await listDiscounts(sql, { userId: null, status: "active", search: "Zqx" })).map((d) => d.business);
    expect(ranked).toEqual(["Zqx High", "Zqx Low"]);
  });

  it("expires a deal once doesn't-work votes reach 3 and outnumber works two to one", async () => {
    const deal = await addDiscount(sql, "frank", { ...DEAL, title: "Threshold" });
    await vote(sql, "w1", deal.id, true);
    await vote(sql, "w2", deal.id, true);
    for (const user of ["n1", "n2", "n3"]) {
      expect((await vote(sql, user, deal.id, false)).status).toBe("active"); // 3 vs 2: not two to one yet
    }
    const expired = await vote(sql, "n4", deal.id, false); // 4 vs 2
    expect(expired).toMatchObject({ status: "expired", expiredReason: "votes" });

    await expect(vote(sql, "n5", deal.id, false)).rejects.toThrow("has expired");
    expect((await listDiscounts(sql, { userId: null, status: "expired" })).map((d) => d.id)).toContain(deal.id);
  });

  it("restoring a deal clears its votes, so it starts fresh", async () => {
    const deal = await addDiscount(sql, "gina", { ...DEAL, title: "Restore" });
    for (const user of ["a", "b", "c"]) await vote(sql, user, deal.id, false);

    const restored = await restore(sql, "gina", deal.id);
    expect(restored).toMatchObject({ status: "active", expiredReason: null, works: 0, notWorking: 0 });
    expect((await vote(sql, "a", deal.id, false)).status).toBe("active");
  });

  it("lets a student mark a deal expired, and anyone restore it", async () => {
    const deal = await addDiscount(sql, "hank", { ...DEAL, title: "Manual" });
    expect(await markExpired(sql, "hank", deal.id)).toMatchObject({ status: "expired", expiredReason: "marked" });
    expect((await markExpired(sql, "ivy", deal.id)).status).toBe("expired"); // already expired: no change
    expect((await restore(sql, "ivy", deal.id)).status).toBe("active");
  });

  it("reports deals that don't exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(vote(sql, "jo", missing, true)).rejects.toThrow("doesn't exist");
    await expect(vote(sql, "jo", "not-a-uuid", true)).rejects.toThrow("doesn't exist");
    await expect(markExpired(sql, "jo", missing)).rejects.toThrow("doesn't exist");
    await expect(restore(sql, "jo", missing)).rejects.toThrow("doesn't exist");
  });

  it(`limits each student to ${DAILY_SUBMISSION_LIMIT} new deals a day`, async () => {
    for (let i = 0; i < DAILY_SUBMISSION_LIMIT; i++) await addDiscount(sql, "spammer", { ...DEAL, title: `Deal ${i}` });
    await expect(addDiscount(sql, "spammer", DEAL)).rejects.toThrow("up to 20 deals a day");
    await expect(addDiscount(sql, "someone-else", DEAL)).resolves.toBeDefined();
  });
});

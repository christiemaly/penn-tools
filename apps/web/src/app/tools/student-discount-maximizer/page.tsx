// Student Discount Central: student deals that students vote on and expire.
// Anyone can browse; signing in lets students vote, add deals and mark them
// expired, and a saved AI key lets them fill in a new deal from pasted text.

import type { Metadata } from "next";
import { PROVIDER_LABELS } from "@penntools/core/ai";
import type { AIProvider } from "@penntools/core/ai";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KINDS,
  KIND_LABELS,
  LIMITS,
  MAX_PASTED_TEXT_LENGTH,
  NEIGHBORHOODS,
  NEIGHBORHOOD_LABELS,
  listDiscounts,
} from "@penntools/tool-student-discount-maximizer";
import { getAI } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { db, setupProblem } from "./database";
import { DiscountBoard } from "./DiscountBoard";
import styles from "./DiscountBoard.module.css";

export const metadata: Metadata = {
  title: "Student Discount Central",
};

export default async function StudentDiscountCentralPage() {
  const user = await getCurrentUser();
  const sql = db();
  if (!sql) throw new Error("The database is not configured (check DATABASE_URL).");

  let initialDeals;
  try {
    initialDeals = await listDiscounts(sql, { userId: user?.id ?? null, status: "active" });
  } catch (error) {
    const problem = setupProblem(error);
    if (!problem) throw error;
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Student Discount Central</h1>
        <p className={styles.error}>{problem}</p>
      </div>
    );
  }

  const providers: AIProvider[] = user ? await (await getAI())!.providers() : [];

  return (
    <DiscountBoard
      initialDeals={initialDeals}
      signedIn={user !== null}
      providers={providers}
      providerLabels={PROVIDER_LABELS}
      kinds={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
      categories={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
      neighborhoods={NEIGHBORHOODS.map((n) => ({ value: n, label: NEIGHBORHOOD_LABELS[n] }))}
      limits={{ ...LIMITS, pastedText: MAX_PASTED_TEXT_LENGTH }}
    />
  );
}

// Fills in the Add a deal form from text a student pasted, such as a deal's
// web page or an email, with the AI API on the student's own key. The student
// checks the result before saving it: nothing here is saved.

import { z } from "@penntools/core/ai";
import type { AI, AIProvider } from "@penntools/core/ai";
import { CATEGORIES, KINDS, NEIGHBORHOODS } from "./discounts.js";

export const MAX_PASTED_TEXT_LENGTH = 8000;

// Fields the text may not mention are .nullable(), so the model leaves them empty
// rather than guessing.
export const DealDraft = z.object({
  kind: z.enum(KINDS).nullable().describe("code: a promo code to enter; online: a student price online, often after verifying student status; local: an in-person place"),
  business: z.string().nullable(),
  title: z.string().nullable().describe("A short headline, e.g. 'Student Premium plan'"),
  discount: z.string().nullable().describe("What the student gets, e.g. '50% off' or 'Free admission'"),
  code: z.string().nullable().describe("The promo code exactly as written, or null if there is none"),
  location: z.string().nullable().describe("Street address or area for in-person deals, or null"),
  neighborhood: z
    .enum(NEIGHBORHOODS)
    .nullable()
    .describe("The Philadelphia neighborhood of an in-person deal, only if the text or address makes it clear; else null"),
  url: z.string().nullable().describe("The full https:// link to claim the deal, only if it appears in the text"),
  howToClaim: z.string().nullable().describe("Short steps to claim it, from the text"),
  category: z.enum(CATEGORIES).nullable(),
  pennSpecific: z
    .boolean()
    .nullable()
    .describe("true if only Penn students can get it (e.g. with a PennCard), false if any student can, null if unclear"),
});
export type DealDraft = z.infer<typeof DealDraft>;

const SYSTEM_PROMPT = [
  "You read text about a student discount and fill in a form describing it for Penn students.",
  "Use only what the text says. Leave a field null rather than guess, and never invent codes or links.",
  "Keep every field short.",
].join(" ");

/** Why the pasted text can't be sent, or null if it's fine. */
export function checkPastedText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "Paste the deal's text first.";
  if (value.length > MAX_PASTED_TEXT_LENGTH) return `Paste at most ${MAX_PASTED_TEXT_LENGTH} characters.`;
  return null;
}

/** The deal described in `pastedText`, as a draft for the form. */
export async function fillFromText(ai: AI, provider: AIProvider, pastedText: string): Promise<DealDraft> {
  const { object } = await ai.generateObject({
    provider,
    tier: "fast",
    reasoning: "low",
    schema: DealDraft,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: pastedText }],
  });
  return object;
}

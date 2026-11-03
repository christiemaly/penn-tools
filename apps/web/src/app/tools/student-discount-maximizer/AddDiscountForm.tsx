"use client";

// The Add a deal form. Students can fill it in themselves, or paste a deal's
// text and let AI fill it in on their own key, then check it and save.

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { AIProvider } from "@penntools/core/ai";
import type { DealDraft, Discount, DiscountCategory, DiscountKind } from "@penntools/tool-student-discount-maximizer";
import { addDeal, fillForm, type ActionResult } from "./actions";
import type { Option } from "./DiscountBoard";
import styles from "./DiscountBoard.module.css";

export interface FormLimits {
  business: number;
  title: number;
  discount: number;
  code: number;
  location: number;
  url: number;
  howToClaim: number;
  search: number;
  pastedText: number;
}

interface FormState {
  kind: DiscountKind;
  business: string;
  title: string;
  discount: string;
  code: string;
  location: string;
  url: string;
  howToClaim: string;
  category: DiscountCategory;
}

const EMPTY: FormState = {
  kind: "code",
  business: "",
  title: "",
  discount: "",
  code: "",
  location: "",
  url: "",
  howToClaim: "",
  category: "other",
};

// Errors about the student's AI key send them to Settings.
const KEY_PROBLEMS = new Set(["missing_key", "invalid_key", "no_credit"]);

async function call<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: { message: "Something went wrong. Try again." } };
  }
}

export function AddDiscountForm({
  providers,
  providerLabels,
  kinds,
  categories,
  limits,
  onAdded,
}: {
  providers: AIProvider[];
  providerLabels: Record<AIProvider, string>;
  kinds: Option<DiscountKind>[];
  categories: Option<DiscountCategory>[];
  limits: FormLimits;
  onAdded: (deal: Discount) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Fills in what the AI found, keeping what the student already typed where it found nothing. */
  function applyDraft(draft: DealDraft) {
    setForm((f) => ({
      kind: draft.kind ?? f.kind,
      business: draft.business ?? f.business,
      title: draft.title ?? f.title,
      discount: draft.discount ?? f.discount,
      code: draft.code ?? f.code,
      location: draft.location ?? f.location,
      url: draft.url ?? f.url,
      howToClaim: draft.howToClaim ?? f.howToClaim,
      category: draft.category ?? f.category,
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await call(() => addDeal(form));
    setSaving(false);
    if (result.ok) {
      setForm(EMPTY);
      setError(null);
      onAdded(result.data);
    } else {
      setError(result.error.message);
    }
  }

  return (
    <section className={styles.formCard}>
      <h2 className={styles.cardTitle}>Add a deal</h2>

      <FillWithAI providers={providers} providerLabels={providerLabels} maxLength={limits.pastedText} onDraft={applyDraft} />

      <form className={styles.form} onSubmit={(e) => void save(e)}>
        <div className={styles.formRow}>
          <label className={styles.field}>
            Kind
            <select className={styles.select} value={form.kind} onChange={(e) => set("kind", e.target.value as DiscountKind)}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Category
            <select
              className={styles.select}
              value={form.category}
              onChange={(e) => set("category", e.target.value as DiscountCategory)}
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          Business
          <input className={styles.input} required maxLength={limits.business} placeholder="e.g. Spotify" value={form.business} onChange={(e) => set("business", e.target.value)} />
        </label>
        <label className={styles.field}>
          Title
          <input className={styles.input} required maxLength={limits.title} placeholder="e.g. Premium Student" value={form.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className={styles.field}>
          What you get
          <input className={styles.input} required maxLength={limits.discount} placeholder="e.g. 50% off" value={form.discount} onChange={(e) => set("discount", e.target.value)} />
        </label>
        {form.kind === "code" && (
          <label className={styles.field}>
            Code
            <input className={styles.input} required maxLength={limits.code} value={form.code} onChange={(e) => set("code", e.target.value)} />
          </label>
        )}
        {form.kind === "local" && (
          <label className={styles.field}>
            Address or area
            <input className={styles.input} required maxLength={limits.location} placeholder="e.g. 3601 Walnut St" value={form.location} onChange={(e) => set("location", e.target.value)} />
          </label>
        )}
        <label className={styles.field}>
          Link{form.kind === "local" && " (optional)"}
          <input
            className={styles.input}
            type="url"
            required={form.kind !== "local"}
            maxLength={limits.url}
            placeholder="https://"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          How to claim it (optional)
          <textarea className={styles.textarea} rows={2} maxLength={limits.howToClaim} value={form.howToClaim} onChange={(e) => set("howToClaim", e.target.value)} />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add deal"}
        </button>
      </form>
    </section>
  );
}

function FillWithAI({
  providers,
  providerLabels,
  maxLength,
  onDraft,
}: {
  providers: AIProvider[];
  providerLabels: Record<AIProvider, string>;
  maxLength: number;
  onDraft: (draft: DealDraft) => void;
}) {
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<AIProvider | undefined>(providers[0]);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<{ message: string; keyProblem: boolean } | null>(null);

  if (!provider) {
    return (
      <p className={styles.hint}>
        Tip: add an OpenAI or Anthropic key in{" "}
        <Link href="/settings" className={styles.link}>
          Settings
        </Link>{" "}
        to fill this form in from a deal&apos;s web page text.
      </p>
    );
  }

  async function fill() {
    setFilling(true);
    const result = await call(() => fillForm(provider!, text));
    setFilling(false);
    if (result.ok) {
      onDraft(result.data);
      setError(null);
    } else {
      setError({ message: result.error.message, keyProblem: KEY_PROBLEMS.has(result.error.kind ?? "") });
    }
  }

  return (
    <div className={styles.aiBox}>
      <label className={styles.field}>
        Paste the deal&apos;s text to fill in the form with AI (optional)
        <textarea
          className={styles.textarea}
          rows={3}
          maxLength={maxLength}
          placeholder="Copy the text from the deal's web page or email and paste it here"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className={styles.row}>
        {providers.length > 1 && (
          <select
            className={styles.select}
            aria-label="AI provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as AIProvider)}
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerLabels[p]}
              </option>
            ))}
          </select>
        )}
        <button className={styles.button} type="button" disabled={filling || !text.trim()} onClick={() => void fill()}>
          {filling ? "Filling in…" : "Fill in with AI"}
        </button>
      </div>
      {error && (
        <p className={styles.error}>
          {error.message}
          {error.keyProblem && (
            <>
              {" "}
              Check your key in{" "}
              <Link href="/settings" className={styles.link}>
                Settings
              </Link>
              .
            </>
          )}
        </p>
      )}
      <p className={styles.meta}>Check what it fills in before you save: AI can get details wrong.</p>
    </div>
  );
}

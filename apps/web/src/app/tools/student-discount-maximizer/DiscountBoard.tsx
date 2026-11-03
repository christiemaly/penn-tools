"use client";

// The deal board: filters, deal cards with votes, the Expired section and the
// Add a deal form. Every change goes through a server action in actions.ts.

import { useEffect, useRef, useState } from "react";
import type { AIProvider } from "@penntools/core/ai";
import type { Discount, DiscountCategory, DiscountKind } from "@penntools/tool-student-discount-maximizer";
import { castVote, expireDeal, loadDiscounts, restoreDeal, type ActionResult, type Filters } from "./actions";
import { AddDiscountForm, type FormLimits } from "./AddDiscountForm";
import styles from "./DiscountBoard.module.css";

export interface Option<T extends string> {
  value: T;
  label: string;
}

const SIGN_IN_HINT = "Sign in with the button at the top right to vote, add deals or mark them expired.";

/** Runs a server action; if the call itself fails (e.g. offline), that's an error too. */
async function call<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: { message: "Something went wrong. Try again." } };
  }
}

export function DiscountBoard({
  initialDeals,
  signedIn,
  providers,
  providerLabels,
  kinds,
  categories,
  limits,
}: {
  initialDeals: Discount[];
  signedIn: boolean;
  /** Providers the student has saved AI keys for; empty when signed out or none. */
  providers: AIProvider[];
  providerLabels: Record<AIProvider, string>;
  kinds: Option<DiscountKind>[];
  categories: Option<DiscountCategory>[];
  limits: FormLimits;
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [kind, setKind] = useState<DiscountKind | null>(null);
  const [category, setCategory] = useState<DiscountCategory | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Filters["sort"]>("top");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expired, setExpired] = useState<Discount[] | null>(null);
  const [showExpired, setShowExpired] = useState(false);

  const kindLabels = Object.fromEntries(kinds.map((k) => [k.value, k.label])) as Record<DiscountKind, string>;
  const categoryLabels = Object.fromEntries(categories.map((c) => [c.value, c.label])) as Record<DiscountCategory, string>;

  // Reload when the filters change, waiting for typing to pause; only the
  // latest request's answer is shown.
  const latest = useRef(0);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await call(() => loadDiscounts({ status: "active", kind, category, search, sort }));
      if (request !== latest.current) return;
      setLoading(false);
      if (result.ok) {
        setDeals(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, category, search, sort]);

  async function loadExpired() {
    const result = await call(() =>
      loadDiscounts({ status: "expired", kind: null, category: null, search: "", sort: "new" }),
    );
    if (result.ok) setExpired(result.data);
    else setError(result.error.message);
  }

  function toggleExpired() {
    if (!showExpired) void loadExpired();
    setShowExpired(!showExpired);
  }

  /** Applies a changed deal: it moves between the active list and Expired as its status says. */
  function applyChange(deal: Discount) {
    setDeals((current) =>
      deal.status === "active"
        ? current.some((d) => d.id === deal.id)
          ? current.map((d) => (d.id === deal.id ? deal : d))
          : [deal, ...current]
        : current.filter((d) => d.id !== deal.id),
    );
    setExpired((current) => {
      if (current === null) return null;
      const rest = current.filter((d) => d.id !== deal.id);
      return deal.status === "expired" ? [deal, ...rest] : rest;
    });
  }

  async function act(action: () => Promise<ActionResult<Discount>>) {
    const result = await call(action);
    if (result.ok) {
      applyChange(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Student Discount Central</h1>
          <p className={styles.intro}>
            Student deals for Penn students: promo codes, online student pricing and Philly spots. Vote on whether a
            deal still works; deals most students say are dead move to Expired.
          </p>
        </div>
        {signedIn && (
          <button className={styles.button} onClick={() => setAdding(!adding)}>
            {adding ? "Close" : "Add a deal"}
          </button>
        )}
      </div>

      {!signedIn && <p className={styles.hint}>{SIGN_IN_HINT}</p>}

      {adding && (
        <AddDiscountForm
          providers={providers}
          providerLabels={providerLabels}
          kinds={kinds}
          categories={categories}
          limits={limits}
          onAdded={(deal) => {
            applyChange(deal);
            setAdding(false);
          }}
        />
      )}

      <div className={styles.filters}>
        <div className={styles.tabs} role="tablist" aria-label="Kind of deal">
          {[{ value: null, label: "All" }, ...kinds].map((k) => (
            <button
              key={k.label}
              role="tab"
              aria-selected={kind === k.value}
              className={kind === k.value ? styles.tabActive : styles.tab}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <input
            className={styles.input}
            type="search"
            aria-label="Search deals"
            placeholder="Search by business, deal or place"
            value={search}
            maxLength={limits.search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={styles.select}
            aria-label="Category"
            value={category ?? ""}
            onChange={(e) => setCategory((e.target.value || null) as DiscountCategory | null)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Filters["sort"])}
          >
            <option value="top">Most trusted</option>
            <option value="new">Newest</option>
          </select>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list} aria-busy={loading}>
        {deals.length === 0 && !loading && <p className={styles.empty}>No deals match. Try other filters.</p>}
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            kindLabel={kindLabels[deal.kind]}
            categoryLabel={categoryLabels[deal.category]}
            signedIn={signedIn}
            onVote={(works) => act(() => castVote(deal.id, works))}
            onExpire={() => {
              if (confirm(`Move "${deal.business}: ${deal.title}" to Expired?`)) void act(() => expireDeal(deal.id));
            }}
          />
        ))}
      </div>

      <section className={styles.expiredSection}>
        <button className={styles.linkButton} onClick={toggleExpired} aria-expanded={showExpired}>
          {showExpired ? "Hide expired deals" : "Show expired deals"}
        </button>
        {showExpired && (
          <div className={styles.list}>
            {expired === null && <p className={styles.empty}>Loading…</p>}
            {expired?.length === 0 && <p className={styles.empty}>No expired deals.</p>}
            {expired?.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                kindLabel={kindLabels[deal.kind]}
                categoryLabel={categoryLabels[deal.category]}
                signedIn={signedIn}
                onRestore={() => act(() => restoreDeal(deal.id))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DealCard({
  deal,
  kindLabel,
  categoryLabel,
  signedIn,
  onVote,
  onExpire,
  onRestore,
}: {
  deal: Discount;
  kindLabel: string;
  categoryLabel: string;
  signedIn: boolean;
  onVote?: (works: boolean | null) => Promise<void>;
  onExpire?: () => void;
  onRestore?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const expired = deal.status === "expired";

  async function busyWhile(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!deal.code) return;
    try {
      await navigator.clipboard.writeText(deal.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the code is on screen to copy by hand.
    }
  }

  // Voting the same way again takes the vote back.
  const voteFor = (works: boolean) => onVote && busyWhile(() => onVote(deal.myVote === works ? null : works));

  return (
    <article className={expired ? styles.cardExpired : styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.business}>{deal.business}</span>
        <span className={styles.badges}>
          <span className={styles.badge}>{kindLabel}</span>
          <span className={styles.badge}>{categoryLabel}</span>
          {deal.source === "starter" && !expired && (
            <span className={styles.badgeStarter} title="From our starter list: vote to confirm it still works">
              Starter list
            </span>
          )}
        </span>
      </div>
      <h2 className={styles.cardTitle}>{deal.title}</h2>
      <p className={styles.discount}>{deal.discount}</p>

      {deal.code && (
        <div className={styles.codeRow}>
          <code className={styles.code}>{deal.code}</code>
          <button className={styles.smallButton} onClick={() => void copyCode()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {deal.location && <p className={styles.detail}>📍 {deal.location}</p>}
      {deal.howToClaim && <p className={styles.detail}>{deal.howToClaim}</p>}
      {deal.url && (
        <a className={styles.link} href={deal.url} target="_blank" rel="noopener noreferrer nofollow">
          Get the deal ↗
        </a>
      )}

      <div className={styles.cardActions}>
        {expired ? (
          <>
            <span className={styles.meta}>
              Expired {deal.expiredReason === "votes" ? "by votes" : "by a student"} on{" "}
              {new Date(deal.statusChangedAt).toLocaleDateString()}
            </span>
            {onRestore && (
              <button
                className={styles.smallButton}
                disabled={!signedIn || busy}
                title={signedIn ? "Still works? Bring it back." : SIGN_IN_HINT}
                onClick={() => void busyWhile(onRestore)}
              >
                Restore
              </button>
            )}
          </>
        ) : (
          <>
            <button
              className={deal.myVote === true ? styles.voteActive : styles.vote}
              disabled={!signedIn || busy}
              title={signedIn ? "It works" : SIGN_IN_HINT}
              aria-pressed={deal.myVote === true}
              onClick={() => void voteFor(true)}
            >
              👍 Works · {deal.works}
            </button>
            <button
              className={deal.myVote === false ? styles.voteActiveBad : styles.vote}
              disabled={!signedIn || busy}
              title={signedIn ? "It didn't work for me" : SIGN_IN_HINT}
              aria-pressed={deal.myVote === false}
              onClick={() => void voteFor(false)}
            >
              👎 Doesn&apos;t work · {deal.notWorking}
            </button>
            {onExpire && (
              <button
                className={styles.linkButton}
                disabled={!signedIn || busy}
                title={signedIn ? "This deal has ended" : SIGN_IN_HINT}
                onClick={onExpire}
              >
                Mark expired
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

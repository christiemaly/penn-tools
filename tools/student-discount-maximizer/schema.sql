-- Student Discount Central database schema, applied on every `db:deploy` as the
-- studentdiscountmaximizer role (see packages/platform/scripts/setup-tools.mjs).
-- Every statement must be safe to re-run against a database that already has it.

-- One student deal. Starter deals (seed.mjs) have a slug so re-seeding skips
-- them; students' deals have created_by, the platform user's id (a tool's
-- schema can't reference platform tables, so there is no foreign key).
CREATE TABLE IF NOT EXISTS discounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        UNIQUE,
  kind              TEXT        NOT NULL CHECK (kind IN ('code', 'online', 'local')),
  business          TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  discount          TEXT        NOT NULL,
  code              TEXT,
  location          TEXT,
  url               TEXT,
  how_to_claim      TEXT        NOT NULL DEFAULT '',
  category          TEXT        NOT NULL CHECK (category IN ('food', 'entertainment', 'tech', 'shopping', 'travel', 'culture', 'fitness', 'other')),
  source            TEXT        NOT NULL CHECK (source IN ('starter', 'student')),
  created_by        TEXT,
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  -- When and by whom the status last changed: status_changed_by is null when
  -- votes expired the deal. Restoring a deal also clears its votes.
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_by TEXT,
  expired_reason    TEXT        CHECK (expired_reason IN ('marked', 'votes')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discounts_status_idx ON discounts (status, created_at DESC);
-- The daily submission limit counts a student's recent deals.
CREATE INDEX IF NOT EXISTS discounts_creator_idx ON discounts (created_by, created_at);

-- One vote per student per deal: works = true for "works", false for "doesn't work".
CREATE TABLE IF NOT EXISTS votes (
  discount_id UUID        NOT NULL REFERENCES discounts (id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  works       BOOLEAN     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discount_id, user_id)
);

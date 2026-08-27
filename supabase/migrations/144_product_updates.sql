-- ============================================================
-- Migration 144: Product updates (in-app changelog)
--
-- A record of what shipped, written for players, and the notification that
-- tells them about it. `league_id` on `notifications` is already nullable
-- and RLS there only checks `user_id`, so a global row (league_id NULL)
-- already reads correctly per-user through the existing bell — the only
-- other change this needs is a way to tell a product-update row apart from
-- an ordinary one, hence `kind` below.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_updates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  body          TEXT NOT NULL,
  is_major      BOOLEAN NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Product updates: readable by any authenticated user"
  ON public.product_updates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Lets a major-update notification be told apart from an ordinary one so the
-- bell/modal can filter for it. Existing rows stay NULL; nothing reads this
-- column yet, so no backfill.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind TEXT;

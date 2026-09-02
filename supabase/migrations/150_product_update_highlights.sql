-- ============================================================
-- Migration 150: highlights on a product update
--
-- The announcement modal rendered only title + summary, so the one surface
-- most managers actually read carried the least detail — a release with four
-- distinct things in it arrived as a single sentence, and whichever of them
-- did not fit that sentence went unmentioned until someone opened /updates.
--
-- Nullable and unconstrained on purpose: an entry with no highlights renders
-- exactly as it does today, so this is additive for every existing row and
-- for any quiet update that does not need them.
-- ============================================================

ALTER TABLE public.product_updates
  ADD COLUMN IF NOT EXISTS highlights TEXT[];

COMMENT ON COLUMN public.product_updates.highlights IS
  'Up to ~4 one-line takeaways shown in the announcement modal. NULL or empty renders title + summary only.';

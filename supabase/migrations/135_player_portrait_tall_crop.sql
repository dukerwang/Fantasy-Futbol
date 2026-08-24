-- ============================================================
-- Migration 135: Per-player crop measurements for the tall (220x280) portrait source
-- ============================================================
--
-- PROBLEM
-- -------
-- Migration 134 measured the 500x500 square PL cut-out and taught the shared
-- ".g-portrait-*" system (Portrait.tsx) to correct for players whose photo PL
-- has framed differently. PremiumPlayerCard.tsx (the roster Inspector /
-- PlayerDetailsModal flip-card) doesn't use that system at all -- it shows a
-- DIFFERENT PL cut-out, the 220x280 "tall" one (photo.ts), sized to its own
-- ~196x250 box. That source photo comes from the same photoshoot and carries
-- the same framing inconsistency, unmeasured and uncorrected, which is why a
-- player's small avatar (now corrected) and their player card (not) can look
-- like two different crops of two different photos.
--
-- FIX
-- ---
-- Same approach as migration 134, applied to the tall source specifically --
-- see src/lib/players/portraitCrop.ts's REF_TALL_HEAD_WIDTH_FRAC /
-- REF_TALL_HEAD_TOP_FRAC and scripts/backfill_portrait_crops.ts, which now
-- measures both sources per player in one pass.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS portrait_tall_head_top_pct REAL,
  ADD COLUMN IF NOT EXISTS portrait_tall_head_width_pct REAL;

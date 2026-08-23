-- ============================================================
-- Migration 134: Per-player portrait crop measurements
-- ============================================================
--
-- PROBLEM
-- -------
-- The Gaffa 2.0 portrait (globals.css, ".g-portrait-*") crops every player's
-- 500x500 PL cut-out with one fixed zoom/inset per size, calibrated against a
-- handful of reference players. That assumes every player's cut-out frames
-- the head the same way. It doesn't: Premier League has started reshooting
-- some squads (not just new signings -- e.g. Cole Palmer, an established
-- Chelsea player) with the head noticeably bigger and positioned almost flush
-- to the top of the frame, instead of the ~13%-down headroom the shared crop
-- assumes. Applying the one global crop to those photos crowds/misframes the
-- head -- exactly the "images look smaller / heads mispositioned" report.
--
-- FIX
-- ---
-- Store the two raw measurements a one-off pixel-analysis pass takes off each
-- player's own 500x500 cut-out (scripts/backfill_portrait_crops.ts): where the
-- head starts (top) and how wide it is, both as a fraction of the frame. The
-- app computes a per-player zoom/inset from these against the same reference
-- constants already in globals.css (src/lib/players/portraitCrop.ts), instead
-- of storing pre-baked pixel values that would need updating if the shared
-- reference constants ever change. NULL until the backfill analyzes a player's
-- photo; Portrait.tsx falls back to the shared global crop until then.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS portrait_head_top_pct REAL,
  ADD COLUMN IF NOT EXISTS portrait_head_width_pct REAL;

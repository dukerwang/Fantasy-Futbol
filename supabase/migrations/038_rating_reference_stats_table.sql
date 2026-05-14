-- Migration 038: Capture the `rating_reference_stats` table schema in migrations.
--
-- The table has existed in production since before migrations were exhaustively
-- tracked in this repo. This migration is idempotent (CREATE TABLE IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS) so it can run against the existing live
-- DB or a fresh deploy without touching existing rows.
--
-- Data is NOT seeded here: reference stats are derived from current-season FPL
-- data via `scripts/recompute_reference_stats.mjs`. Run that script once after
-- a fresh deploy (and at the start of each new season once enough gameweeks
-- have played).
--
-- Schema:
--   position_group : granular position string (GK, CB, LB, RB, LWB, RWB,
--                    DM, CM, AM, LW, RW, ST). Column name predates the
--                    12-position split; despite the name, values are granular.
--   component      : rating component (match_impact, influence, creativity,
--                    threat, defensive, goal_involvement, finishing,
--                    save_score)
--   median, stddev : sigmoid normalization parameters for the engine
--   sample_size    : N of player-fixtures used to compute this row
--   season         : '2025-26' style season tag

CREATE TABLE IF NOT EXISTS public.rating_reference_stats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_group  TEXT NOT NULL,
    component       TEXT NOT NULL,
    median          NUMERIC NOT NULL,
    stddev          NUMERIC NOT NULL,
    sample_size     INTEGER NOT NULL DEFAULT 0,
    season          TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (position_group, component, season)
);

CREATE INDEX IF NOT EXISTS rating_reference_stats_season_idx
    ON public.rating_reference_stats (season);

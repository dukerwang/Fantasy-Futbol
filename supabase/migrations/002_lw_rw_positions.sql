-- ============================================================
-- Migration 002: Add FPL columns to players table.
-- (LW/RW/LB/RB positions are already in the 001 enum.)
-- Run in Supabase SQL editor after 001.
-- ============================================================

-- Add FPL-specific columns to players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS fpl_id   INT  UNIQUE,
  ADD COLUMN IF NOT EXISTS web_name TEXT;

CREATE INDEX IF NOT EXISTS idx_players_fpl_id ON public.players(fpl_id);

-- Fix default season on leagues table
ALTER TABLE public.leagues
  ALTER COLUMN season SET DEFAULT '2025-26';

-- Fix default season on player_stats table
ALTER TABLE public.player_stats
  ALTER COLUMN season SET DEFAULT '2025-26';

-- Phase 2: Taxi Squad
-- Adds 'taxi' roster status and per-league taxi squad configuration.

-- 1. Extend roster_status enum with the new taxi value
ALTER TYPE roster_status ADD VALUE IF NOT EXISTS 'taxi';

-- 2. Add taxi squad config columns to leagues
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS taxi_size      INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS taxi_age_limit INT NOT NULL DEFAULT 21;

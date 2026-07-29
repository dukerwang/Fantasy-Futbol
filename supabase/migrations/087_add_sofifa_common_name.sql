-- Migration: 087_add_sofifa_common_name.sql
-- Description: Add sofifa_common_name column to players table for storing SoFIFA common display names

ALTER TABLE players ADD COLUMN IF NOT EXISTS sofifa_common_name TEXT;

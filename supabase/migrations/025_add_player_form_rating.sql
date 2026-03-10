-- Add form_rating column to players table
-- This stores the pre-computed average match rating over the last 3 appearances.
ALTER TABLE players ADD COLUMN IF NOT EXISTS form_rating FLOAT8;

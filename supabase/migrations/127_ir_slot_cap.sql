-- Cap the number of players a team may hold on IR at once.
-- IR still doesn't count against roster_size; this bounds the parking lot itself,
-- mirroring the taxi_size cap pattern (migration 035).
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS ir_size INT NOT NULL DEFAULT 2;

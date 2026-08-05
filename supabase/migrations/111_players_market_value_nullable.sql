-- market_value was NOT NULL DEFAULT 0, but syncPlayers.ts intentionally inserts
-- NULL for brand-new players (real values come later from the Transfermarkt
-- sync), and the rest of the app already treats market_value IS NULL as
-- "unpriced" (bid gates, listing gates, UI showing "--"/"n/a"). The NOT NULL
-- constraint made every brand-new-player insert throw, silently aborting the
-- whole chunk (and, since the sync route bails on first error, skipping
-- departure resolution and the high-value auction sweep too).
ALTER TABLE players ALTER COLUMN market_value DROP NOT NULL;

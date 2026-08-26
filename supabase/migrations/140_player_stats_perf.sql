-- The performance block, persisted at scoring time.
--
-- WHY. The block is currently rebuilt on every read (cardData.attachPositionScores,
-- buildLineupPerformance), which means a completed match is explained by TODAY'S
-- engine while its points came from the engine that scored it. Those have already
-- diverged: the rare-feat bonus changed on 2026-08-25 and completed history was
-- deliberately not backfilled, so a 2025-26 hat-trick would show the new feat mark
-- beside points computed under the old rule.
--
-- Persisting the bands at scoring time makes the explanation a SNAPSHOT that
-- always agrees with the number stored beside it. Old rows keep old bands, which
-- is correct rather than stale.
--
-- SAFE FOR LIVE LEAGUES: additive and nullable. It writes no score, changes no
-- score, and every reader falls back to re-scoring when it is null, which is
-- exactly today's behaviour. Existing rows stay null until re-synced.
--
-- SHAPE: the output of buildPerformanceGroups — an array of
--   { key, label, band, width, verdict, evidence, rank? }
-- BANDS ONLY, never component scores. This column is readable by the client via
-- the card and matchup payloads, so putting a raw score in it would undo the
-- disclosure rule the whole feature is built around (src/lib/scoring/perfBand.ts).
-- It is stored at the player's PRIMARY position, the position player_stats is
-- scored at; a matchup that fielded him elsewhere re-scores for that slot.
ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS perf jsonb;

COMMENT ON COLUMN player_stats.perf IS
  'Banded performance groups at the primary position, built at scoring time by buildPerformanceGroups. Bands only, never component scores. Null means "re-score on read".';

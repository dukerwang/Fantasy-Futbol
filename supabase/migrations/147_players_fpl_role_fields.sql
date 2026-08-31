-- FPL bootstrap fields the player sync was fetching and discarding.
--
-- syncPlayers.ts read ten fields off each `elements` entry and dropped the rest,
-- so set-piece duty, availability probability, and season minutes were being
-- re-derived by Google Search inside the outlook engine — paid, slower, and
-- less reliable than the free authoritative source already in the response.
--
-- These back the computed facets (minutes_role, set_pieces) and the hub's
-- real-world form panel. All nullable: FPL omits several of them for a player
-- with no involvement, and null is a meaningful "no duty / unknown".
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS fpl_penalties_order   SMALLINT,
  ADD COLUMN IF NOT EXISTS fpl_direct_fk_order   SMALLINT,
  ADD COLUMN IF NOT EXISTS fpl_corners_order     SMALLINT,
  ADD COLUMN IF NOT EXISTS fpl_chance_next_round SMALLINT,
  ADD COLUMN IF NOT EXISTS fpl_starts            INTEGER,
  ADD COLUMN IF NOT EXISTS fpl_minutes           INTEGER,
  ADD COLUMN IF NOT EXISTS fpl_xg                NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS fpl_xa                NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS fpl_selected_by_pct   NUMERIC(5,2);

COMMENT ON COLUMN public.players.fpl_penalties_order IS
  'FPL set-piece hierarchy: 1 = first-choice penalty taker. NULL = no listed duty.';
COMMENT ON COLUMN public.players.fpl_chance_next_round IS
  'FPL percentage chance of playing the next round. NULL when FPL reports no doubt.';
COMMENT ON COLUMN public.players.fpl_starts IS
  'Season starts per FPL. Paired with fpl_minutes to compute minutes_role.';

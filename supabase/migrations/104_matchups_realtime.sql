-- Migration 104: Put `matchups` on the Realtime publication.
--
-- Unlike `waiver_claims` (078_auction_state_projection.sql), `matchups` needs
-- no projection table: its RLS policy ("Matchups: read if league member",
-- 001_initial_schema.sql:403) already opens every column to the whole league,
-- and nothing on the row is private. LiveMatchupCard.tsx's 60s poll and the
-- matchup detail page (previously no live refresh at all) subscribe directly.
--
-- Guarded the same way 078 does: ALTER PUBLICATION ... ADD TABLE errors if
-- the table is already a member, so this stays safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime not found — skipping. Enable Realtime in the Supabase dashboard, then re-run this block.';
    RETURN;
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matchups;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- DEFAULT (primary key) is enough: every event the UI cares about is an
-- UPDATE (score_a/score_b/status changing), and matchups are never deleted.
ALTER TABLE public.matchups REPLICA IDENTITY DEFAULT;

-- Post-apply check:
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

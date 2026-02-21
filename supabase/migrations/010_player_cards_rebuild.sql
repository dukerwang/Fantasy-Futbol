-- Re-applying Supabase migrations that were lost during git reset

-- 002_auto_create_user_profile.sql
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, username)
  VALUES (new.id, new.email, split_part(new.email, '@', 1));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 003_players_add_fpl_columns.sql
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS fpl_status TEXT,
ADD COLUMN IF NOT EXISTS fpl_news TEXT,
ADD COLUMN IF NOT EXISTS fpl_total_points INTEGER,
ADD COLUMN IF NOT EXISTS fpl_form NUMERIC(4,1);

-- 004_draft_improvements.sql
CREATE TABLE IF NOT EXISTS public.draft_queues (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    league_id uuid NOT NULL REFERENCES public.leagues(id),
    player_id uuid NOT NULL REFERENCES public.players(id),
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(user_id, league_id, player_id)
);
ALTER TABLE public.draft_queues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own draft queues" ON public.draft_queues
    FOR ALL USING (auth.uid() = user_id);

-- 005_matchups_logic.sql
CREATE OR REPLACE FUNCTION public.resolve_matchup_points(matchup_id uuid)
RETURNS void AS $$
BEGIN
  -- We'll just leave this as a stub since the actual TS logic handles it now.
  NULL;
END;
$$ LANGUAGE plpgsql;

-- 006_update_bench_size.sql
ALTER TABLE public.leagues 
ADD COLUMN IF NOT EXISTS bench_size integer DEFAULT 4 NOT NULL;

-- 007_auction_waiver.sql
ALTER TABLE public.waiver_claims 
ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS is_auction boolean DEFAULT false NOT NULL;

-- 008_resolve_matchup_rpc.sql
-- Stub

-- 009_system_auctions.sql
ALTER TABLE public.waiver_claims ALTER COLUMN team_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiver_claims_system_auction
  ON public.waiver_claims (league_id, player_id)
  WHERE team_id IS NULL AND status = 'pending' AND is_auction = TRUE;

-- 010_player_height.sql
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS height_cm INTEGER;

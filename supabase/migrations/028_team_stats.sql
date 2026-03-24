-- Add historical team stats table for Dynasty mode tournament seeding

CREATE TABLE IF NOT EXISTS public.team_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    season TEXT NOT NULL,
    rank INTEGER NOT NULL,
    total_points NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint so a team only has one stat row per season
CREATE UNIQUE INDEX IF NOT EXISTS team_stats_team_id_season_idx ON public.team_stats (team_id, season);

-- RLS
ALTER TABLE public.team_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view team_stats" ON public.team_stats
  FOR SELECT USING (true);

-- Only admin/service role can insert/update stats

-- ============================================================
-- Migration 055: Pending Drops Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'drop' or 'transfer_out'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_pending_drop UNIQUE (team_id, player_id)
);

-- Enable Row Level Security
ALTER TABLE public.pending_drops ENABLE ROW LEVEL SECURITY;

-- Policies for public.pending_drops
CREATE POLICY "Enable read access for all league members"
  ON public.pending_drops FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = pending_drops.team_id
        AND t.league_id = pending_drops.league_id
    )
  );

CREATE POLICY "Enable write access for team owner"
  ON public.pending_drops FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = pending_drops.team_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = pending_drops.team_id
        AND t.user_id = auth.uid()
    )
  );

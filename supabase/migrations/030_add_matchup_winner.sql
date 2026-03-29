-- Add winner_team_id to matchups table
ALTER TABLE public.matchups ADD COLUMN winner_team_id UUID REFERENCES public.teams(id);

-- Update RLS policies to ensure it's readable
-- (Existing policies usually cover all columns, but good to be sure)
COMMENT ON COLUMN public.matchups.winner_team_id IS 'The ID of the team that won this matchup. NULL if draw or not yet finished.';

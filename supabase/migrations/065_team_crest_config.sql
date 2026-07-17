-- Add crest_config column to teams table to store the vector design settings
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS crest_config JSONB DEFAULT NULL;

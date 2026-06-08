-- ============================================================
-- Migration 056: PL Fixtures Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pl_fixtures (
  id INT PRIMARY KEY,
  gameweek INT NOT NULL,
  team_h INT NOT NULL,
  team_a INT NOT NULL,
  kickoff_time TIMESTAMPTZ NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.pl_fixtures ENABLE ROW LEVEL SECURITY;

-- Policy to allow read access to all users
CREATE POLICY "Enable read access for all authenticated users"
  ON public.pl_fixtures FOR SELECT
  TO authenticated
  USING (true);

-- Policy to allow all access to service role / admin
CREATE POLICY "Enable write access for service role only"
  ON public.pl_fixtures FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

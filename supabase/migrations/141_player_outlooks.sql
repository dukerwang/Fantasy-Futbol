-- Futbolpedia outlook cache (text-only v1 — no UI consumer yet)
CREATE TABLE IF NOT EXISTS public.player_outlooks (
  player_id UUID PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  outlook TEXT NOT NULL,
  sidecar JSONB NOT NULL DEFAULT '{}',
  context_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_outlooks_generated_at
  ON public.player_outlooks (generated_at DESC);

ALTER TABLE public.player_outlooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read player outlooks"
  ON public.player_outlooks
  FOR SELECT
  TO authenticated
  USING (true);

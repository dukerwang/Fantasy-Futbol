-- ============================================================
-- Migration 113: Chat Read State (unread indicator for nav chat icon)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chat_read_state (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  league_id     UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  peer_id       UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = league lobby, else the DM peer
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (user_id, league_id, peer_id)
);

ALTER TABLE public.chat_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat read state: manage own" ON public.chat_read_state FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_chat_read_state_lookup
  ON public.chat_read_state(user_id, league_id);

-- Backfill: mark every existing member caught-up as of now, for the lobby and
-- every other member's DM thread, so years of chat history don't retroactively
-- appear as unread the moment this feature ships.
INSERT INTO public.chat_read_state (user_id, league_id, peer_id, last_read_at)
SELECT lm.user_id, lm.league_id, NULL, NOW()
FROM public.league_members lm
ON CONFLICT (user_id, league_id, peer_id) DO NOTHING;

INSERT INTO public.chat_read_state (user_id, league_id, peer_id, last_read_at)
SELECT lm.user_id, lm.league_id, other.user_id, NOW()
FROM public.league_members lm
JOIN public.league_members other
  ON other.league_id = lm.league_id AND other.user_id != lm.user_id
ON CONFLICT (user_id, league_id, peer_id) DO NOTHING;

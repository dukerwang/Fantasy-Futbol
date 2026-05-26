-- ============================================================
-- Migration 041: Notifications and Real-Time Chat Infrastructure
-- ============================================================

-- ── 1. Notifications Table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  url         TEXT,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Notifications: select own" ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Notifications: update own" ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_league
  ON public.notifications(user_id, league_id);

-- ── 2. Chat Messages Table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL for public league lobby
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Chat: select if league member" ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = chat_messages.league_id AND lm.user_id = auth.uid()
    )
  );

CREATE POLICY "Chat: insert if league member" ON public.chat_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_league
  ON public.chat_messages(league_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON public.chat_messages(league_id, sender_id, recipient_id);

-- ── 3. Register Chat Messages with Supabase Realtime ───────────

-- Add chat_messages table to the supabase_realtime publication
-- Use DO block to handle cases where publication doesn't exist or table is already added
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

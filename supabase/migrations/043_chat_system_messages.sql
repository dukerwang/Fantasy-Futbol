-- Migration 043: System message support for chat
-- Adds is_system flag so automated announcements render distinctly (no user avatar)
-- Also makes sender_id nullable to support true system-originated messages

-- 1. Add is_system column (default false, non-nullable)
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 2. Make sender_id nullable so system messages don't need a user FK
ALTER TABLE public.chat_messages
  ALTER COLUMN sender_id DROP NOT NULL;

-- 3. Drop the existing FK constraint on sender_id (so nulls are allowed)
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;

-- 4. Re-add FK with NULL allowed
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 5. Update RLS: system inserts go through admin client (bypasses RLS), 
--    but user inserts still require sender_id = auth.uid()
DROP POLICY IF EXISTS "Chat: insert if league member" ON public.chat_messages;
CREATE POLICY "Chat: insert if league member" ON public.chat_messages FOR INSERT
  WITH CHECK (
    (sender_id IS NULL OR auth.uid() = sender_id) AND
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

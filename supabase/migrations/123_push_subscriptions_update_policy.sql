-- The subscribe route upserts on endpoint conflict (a browser re-subscribing
-- gets the same endpoint back), which needs an UPDATE policy alongside the
-- INSERT one from migration 122.
CREATE POLICY "Push subscriptions: update own" ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

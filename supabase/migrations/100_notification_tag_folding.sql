-- Migration 100: Notification Tag Folding
--
-- Adds a `tag` column to `notifications` to support in-place folding of
-- high-frequency event updates (such as outbid notices, bidding war raises,
-- and auction countdowns) for the same entity, preventing mailbox clutter.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS tag TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_user_tag
ON public.notifications(user_id, league_id, tag);

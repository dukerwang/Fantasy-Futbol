-- Per-user push/email preferences for notification kinds.
-- NULL means "use the code defaults" (src/lib/notifications/prefs.ts).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB;

COMMENT ON COLUMN public.users.notification_prefs IS
  'Optional per-kind { push, email } map. Null uses app defaults. In-game mail is not gated.';

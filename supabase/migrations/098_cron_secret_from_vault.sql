-- ============================================================
-- Migration 098: Read the cron secret from Vault, not a literal
-- ============================================================
-- github.com/dukerwang/Gaffa is a PUBLIC repository, and migrations 019, 034
-- and 044 committed the CRON_SECRET in plaintext inside the pg_cron trigger
-- functions. That value gates EVERY /api/cron/*, /api/sync/* and /api/admin/*
-- route — including admin/offseason/reset, admin/e2e-setup and the sync routes
-- that overwrite the player table. Anyone who read the repo could resolve
-- auctions, reset a season, or wipe player data with a single curl.
--
-- This migration removes the literal from the database. It CANNOT remove it
-- from git history, where it is permanent and public. **Rotating the secret is
-- therefore mandatory, not optional** — see the runbook at the bottom.
--
-- After this runs, the secret lives in Supabase Vault (encrypted at rest,
-- outside the repo) and is read at call time.

-- ── 1. Accessor ─────────────────────────────────────────────
-- SECURITY DEFINER so the pg_cron owner can read the vault view; locked down
-- so no client role can call it and exfiltrate the secret.
CREATE OR REPLACE FUNCTION public.cron_secret()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_secret() FROM PUBLIC, anon, authenticated;

-- ── 2. Rewrite the two trigger functions ────────────────────
-- Both now fail LOUDLY when the secret is absent. The alternative — posting a
-- null header — would 401 silently and stall every auction in the league with
-- nothing in the logs to say why.

CREATE OR REPLACE FUNCTION public.trigger_process_auctions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := public.cron_secret();
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'cron_secret not found in vault.secrets — see migration 098';
  END IF;

  PERFORM net.http_post(
    url     := 'https://gaffa.live/api/cron/process-auctions',
    headers := jsonb_build_object('x-cron-secret', v_secret)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_start_scheduled_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := public.cron_secret();
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'cron_secret not found in vault.secrets — see migration 098';
  END IF;

  PERFORM net.http_post(
    url     := 'https://gaffa.live/api/cron/start-scheduled-drafts',
    headers := jsonb_build_object('x-cron-secret', v_secret)
  );
END;
$$;

-- ============================================================
-- ROTATION RUNBOOK — run these in order, back to back
-- ============================================================
-- The old secret is public forever via git history. It must be replaced, not
-- merely moved into Vault.
--
-- STEP 1 — generate a new secret locally (do not reuse the old one):
--     openssl rand -hex 32
--
-- STEP 2 — store it in Vault. Run this in the Supabase SQL editor with your
--          value pasted in. Do NOT commit the result.
--
--     SELECT vault.create_secret(
--       '<PASTE_NEW_SECRET_HERE>',
--       'cron_secret',
--       'x-cron-secret header for /api/cron, /api/sync, /api/admin'
--     );
--
--   (Rotating again later? Use vault.update_secret(id, new_secret) instead.)
--
-- STEP 3 — run everything above this comment block.
--
-- STEP 4 — set CRON_SECRET to the same value in Vercel (Project Settings →
--          Environment Variables, Production) and redeploy.
--
-- Between STEP 3 and STEP 4 the crons will 401. That is harmless: both jobs are
-- idempotent and retry on their own schedule (every 10 min / every 1 min), so
-- they resync as soon as the deploy lands. Nothing is lost.
--
-- STEP 5 — confirm, a few minutes after the deploy:
--     SELECT status_code, count(*)
--     FROM net._http_response
--     WHERE created > now() - interval '15 minutes'
--     GROUP BY status_code;
--   Expect 200s. Any 401 means STEP 2 and STEP 4 disagree.

-- Migration 042: Add draft_scheduled_at TIMESTAMPTZ column to public.leagues table
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS draft_scheduled_at TIMESTAMPTZ;

-- Migration 013: Add LM and RM to granular_position enum.
-- Run in Supabase SQL editor after 012.

ALTER TYPE granular_position ADD VALUE IF NOT EXISTS 'LM';
ALTER TYPE granular_position ADD VALUE IF NOT EXISTS 'RM';

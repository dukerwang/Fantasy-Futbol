-- ============================================================
-- Migration 047: Update Cup Prize Defaults
--
-- Redistributes FAAB prizes between the Champions Cup and Consolation Cup.
-- Goal: Consolation Cup winner now earns the same as the Champions Cup winner,
-- making the second-chance bracket a meaningful prize for mid/lower-half managers.
--
-- New values:
--   Champions Cup Winner:      70 → 60  (-10)
--   Champions Cup Runner-Up:   25 → 20  (-5)
--   Consolation Cup Winner:    40 → 60  (+20)
--   Consolation Cup Runner-Up: 15 → 25  (+10)
--
-- The net change is +15. This is intentional — Consolation Cup has more
-- participants and the additional currency is redistributed to weaker teams.
--
-- Only updates leagues still using all four original cup defaults.
-- Commissioner-customized leagues (any cup value differs) are left untouched.
-- ============================================================

-- 1. Update the column default (affects new leagues going forward)
ALTER TABLE public.leagues
  ALTER COLUMN prize_config SET DEFAULT '{
    "season_1st": 90,
    "season_2nd": 80,
    "season_3rd": 73,
    "season_4th": 68,
    "season_5th": 64,
    "season_6th": 62,
    "season_7th": 59,
    "season_8th": 57,
    "season_9th": 54,
    "season_10th": 52,
    "champions_cup_winner": 60,
    "champions_cup_runner_up": 20,
    "consolation_cup_winner": 60,
    "consolation_cup_runner_up": 25,
    "league_cup_winner": 40,
    "league_cup_runner_up": 10
  }';

-- 2. Patch existing league rows that still use all four original cup defaults.
-- The || operator merges JSONB keys; all other keys (season standings prizes,
-- league cup prizes) are preserved exactly as-is.
-- If a commissioner changed even one cup value, the entire row is skipped.
UPDATE public.leagues
SET prize_config = prize_config
  || '{"champions_cup_winner": 60,
       "champions_cup_runner_up": 20,
       "consolation_cup_winner": 60,
       "consolation_cup_runner_up": 25}'::jsonb
WHERE
  (prize_config->>'champions_cup_winner')::int     = 70
  AND (prize_config->>'champions_cup_runner_up')::int  = 25
  AND (prize_config->>'consolation_cup_winner')::int   = 40
  AND (prize_config->>'consolation_cup_runner_up')::int = 15;

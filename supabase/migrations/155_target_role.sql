-- ============================================================
-- Migration 155: what LEVEL of player a role profile wants
--
-- A position on its own is a thin statement. "An LB" could mean a €60m
-- starter or a body for the bench, and the clubs who could answer it have no
-- way to tell which — so most profiles would go unanswered by the people best
-- placed to answer them.
--
-- Required on a profile, absent on a named target: if you have named the man,
-- the level is not the question. Folded into the kind-shape CHECK so the two
-- rules stay one rule.
-- ============================================================

ALTER TABLE public.player_targets
  ADD COLUMN IF NOT EXISTS role TEXT
  CHECK (role IS NULL OR role IN ('star', 'starter', 'bench', 'prospect'));

-- Existing profiles (none in production yet — the feature has not shipped)
-- would violate the tightened shape below, so settle them first. Harmless if
-- it matches nothing.
UPDATE public.player_targets
SET role = 'starter'
WHERE target_kind = 'profile' AND role IS NULL;

ALTER TABLE public.player_targets
  DROP CONSTRAINT IF EXISTS player_targets_kind_shape;

ALTER TABLE public.player_targets
  ADD CONSTRAINT player_targets_kind_shape CHECK (
    (target_kind = 'player'
      AND player_id IS NOT NULL AND position IS NULL     AND role IS NULL) OR
    (target_kind = 'profile'
      AND position  IS NOT NULL AND player_id IS NULL    AND role IS NOT NULL)
  );

COMMENT ON COLUMN public.player_targets.role IS
  'Squad role sought on a profile: star | starter | bench | prospect. '
  'Descriptive only — matching never filters on it, because judging whether a '
  'player fits a role is the manager''s job, not the query''s.';

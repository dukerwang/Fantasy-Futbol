-- Create the resolve_matchup RPC function
-- Called by the sync/matchups API route to persist scores and update matchup status.
-- Parameters:
--   p_matchup_id  : UUID of the matchup to update
--   p_score_a     : Calculated fantasy points for team A
--   p_score_b     : Calculated fantasy points for team B
--   p_team_a_id   : UUID of team A (for wins/losses tracking)
--   p_team_b_id   : UUID of team B
--   p_finished    : Whether the gameweek is fully finished (true = mark completed, false = keep live)
CREATE OR REPLACE FUNCTION public.resolve_matchup(
    p_matchup_id   uuid,
    p_score_a      numeric,
    p_score_b      numeric,
    p_team_a_id    uuid,
    p_team_b_id    uuid,
    p_finished     boolean
)
RETURNS boolean AS $$
DECLARE
    v_new_status text;
BEGIN
    -- Determine status
    IF p_finished THEN
        v_new_status := 'completed';
    ELSE
        v_new_status := 'live';
    END IF;

    -- Update matchup scores and status
    UPDATE public.matchups
    SET
        score_a = p_score_a,
        score_b = p_score_b,
        status  = v_new_status,
        updated_at = now()
    WHERE id = p_matchup_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

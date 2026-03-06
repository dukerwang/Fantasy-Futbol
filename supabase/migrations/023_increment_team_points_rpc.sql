-- Creates a safe increment function for team total_points
CREATE OR REPLACE FUNCTION increment_team_points(team_id UUID, pts NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE teams
    SET total_points = COALESCE(total_points, 0) + pts
    WHERE id = team_id;
END;
$$;

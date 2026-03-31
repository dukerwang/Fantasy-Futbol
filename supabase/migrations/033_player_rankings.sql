-- Phase 26: Player Weekly/Overall Rankings
-- Dynamically calculate the overall rank by total points, and unnest player positions to map out precise granular positional ranks.

CREATE OR REPLACE VIEW player_rankings AS
WITH valid_players AS (
    SELECT id, primary_position, secondary_positions, total_points
    FROM players
    WHERE is_active = true
),
overall_ranks AS (
    SELECT 
        id as player_id,
        RANK() OVER (ORDER BY COALESCE(total_points, 0) DESC) as overall_rank
    FROM valid_players
),
unnested_positions AS (
    SELECT 
        id as player_id,
        total_points,
        -- Combine primary position and secondary positions into one array and flatten it
        UNNEST(ARRAY[primary_position] || COALESCE(secondary_positions, '{}'::granular_position[])) as granular_pos
    FROM valid_players
),
position_ranks AS (
    SELECT 
        player_id,
        granular_pos,
        RANK() OVER (PARTITION BY granular_pos ORDER BY COALESCE(total_points, 0) DESC) as pos_rank
    FROM unnested_positions
),
agg_position_ranks AS (
    SELECT 
        player_id,
        -- Build a JSON array [{position: 'LW', rank: 1}, {position: 'RW', rank: 3}]
        jsonb_agg(jsonb_build_object('position', granular_pos, 'rank', pos_rank)) as position_ranks
    FROM position_ranks
    GROUP BY player_id
)
SELECT 
    o.player_id,
    o.overall_rank,
    p.position_ranks
FROM overall_ranks o
JOIN agg_position_ranks p ON o.player_id = p.player_id;

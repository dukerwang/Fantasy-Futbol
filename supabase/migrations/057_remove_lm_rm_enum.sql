-- Migration 057: Remove LM and RM from granular_position enum
-- Drop the player_rankings view that depends on granular_position
DROP VIEW IF EXISTS player_rankings;

-- Ensure no players have LM or RM in primary_position or secondary_positions
UPDATE players SET primary_position = 'LW' WHERE primary_position::text = 'LM';
UPDATE players SET primary_position = 'RW' WHERE primary_position::text = 'RM';

UPDATE players
SET secondary_positions = ARRAY(
  SELECT DISTINCT CASE 
    WHEN p::text = 'LM' THEN 'LW'::granular_position
    WHEN p::text = 'RM' THEN 'RW'::granular_position
    ELSE p 
  END
  FROM unnest(secondary_positions) AS p
)
WHERE 'LM' = ANY(secondary_positions::text[]) OR 'RM' = ANY(secondary_positions::text[]);

-- Rename the current enum type
ALTER TYPE granular_position RENAME TO granular_position_old;

-- Create the new clean enum type (excluding LM and RM)
CREATE TYPE granular_position AS ENUM (
  'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'
);

-- Drop default on secondary_positions
ALTER TABLE players ALTER COLUMN secondary_positions DROP DEFAULT;

-- Alter columns to use the new type
ALTER TABLE players 
  ALTER COLUMN primary_position TYPE granular_position 
  USING primary_position::text::granular_position;

ALTER TABLE players 
  ALTER COLUMN secondary_positions TYPE granular_position[] 
  USING secondary_positions::text[]::granular_position[];

-- Restore default on secondary_positions
ALTER TABLE players ALTER COLUMN secondary_positions SET DEFAULT '{}'::granular_position[];

-- Drop the old renamed type
DROP TYPE granular_position_old;

-- Recreate player_rankings view
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

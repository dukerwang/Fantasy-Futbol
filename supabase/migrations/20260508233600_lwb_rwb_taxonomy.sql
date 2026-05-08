-- Add new positions
ALTER TYPE granular_position ADD VALUE IF NOT EXISTS 'LWB';
ALTER TYPE granular_position ADD VALUE IF NOT EXISTS 'RWB';

-- Update primary_position
UPDATE players SET primary_position = 'LW' WHERE primary_position = 'LM';
UPDATE players SET primary_position = 'RW' WHERE primary_position = 'RM';

-- Update secondary_positions arrays (replace LM with LW, RM with RW, removing duplicates)
UPDATE players
SET secondary_positions = (
  SELECT array_agg(DISTINCT CASE 
    WHEN p = 'LM' THEN 'LW'::granular_position
    WHEN p = 'RM' THEN 'RW'::granular_position
    ELSE p 
  END)
  FROM unnest(secondary_positions) AS p
)
WHERE 'LM' = ANY(secondary_positions) OR 'RM' = ANY(secondary_positions);

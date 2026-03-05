-- Update default team FAAB budget to 500m to support the Transfermarkt economy
ALTER TABLE teams ALTER COLUMN faab_budget SET DEFAULT 500;

-- Optional: If the user wants to retroactive update existing teams that still have 100
-- UPDATE teams SET faab_budget = 500 WHERE faab_budget = 100;

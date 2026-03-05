-- ============================================================
-- Calibrated Reference Stats + GW25 Re-sync
-- Paste this entire block into the Supabase SQL editor and Run.
-- ============================================================

-- ── 1. Update reference stats with real 2024-25 data ────────

-- GK
UPDATE rating_reference_stats SET median = 10.0000, stddev = 9.8513, sample_size = 770 WHERE position_group = 'GK' AND component = 'match_impact' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 22.8000, stddev = 14.1289, sample_size = 770 WHERE position_group = 'GK' AND component = 'influence' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 2.0889, sample_size = 770 WHERE position_group = 'GK' AND component = 'creativity' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.2036, sample_size = 770 WHERE position_group = 'GK' AND component = 'threat' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0900, stddev = 2.7337, sample_size = 770 WHERE position_group = 'GK' AND component = 'defensive' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.4747, sample_size = 770 WHERE position_group = 'GK' AND component = 'goal_involvement' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.1000, sample_size = 770 WHERE position_group = 'GK' AND component = 'finishing' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 4.4500, stddev = 4.3783, sample_size = 770 WHERE position_group = 'GK' AND component = 'save_score' AND season = '2025-26';

-- DEF
UPDATE rating_reference_stats SET median = 7.0000, stddev = 9.3220, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'match_impact' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 15.2000, stddev = 11.9290, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'influence' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 2.2000, stddev = 11.1063, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'creativity' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 2.0000, stddev = 8.7685, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'threat' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.1000, stddev = 2.4905, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'defensive' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 1.4217, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'goal_involvement' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.1676, sample_size = 3787 WHERE position_group = 'DEF' AND component = 'finishing' AND season = '2025-26';

-- MID
UPDATE rating_reference_stats SET median = 8.0000, stddev = 7.0137, sample_size = 5738 WHERE position_group = 'MID' AND component = 'match_impact' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 8.0000, stddev = 15.0363, sample_size = 5738 WHERE position_group = 'MID' AND component = 'influence' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 10.2000, stddev = 15.3121, sample_size = 5738 WHERE position_group = 'MID' AND component = 'creativity' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 5.0000, stddev = 14.8998, sample_size = 5738 WHERE position_group = 'MID' AND component = 'threat' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.1200, stddev = 2.3319, sample_size = 5738 WHERE position_group = 'MID' AND component = 'defensive' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 2.5857, sample_size = 5738 WHERE position_group = 'MID' AND component = 'goal_involvement' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.2810, sample_size = 5738 WHERE position_group = 'MID' AND component = 'finishing' AND season = '2025-26';

-- ATT
UPDATE rating_reference_stats SET median = 5.0000, stddev = 9.1353, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'match_impact' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 3.8000, stddev = 18.9629, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'influence' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 2.8000, stddev = 10.3166, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'creativity' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 13.0000, stddev = 20.3699, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'threat' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0800, stddev = 2.3241, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'defensive' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 3.4336, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'goal_involvement' AND season = '2025-26';
UPDATE rating_reference_stats SET median = 0.0000, stddev = 0.3893, sample_size = 1271 WHERE position_group = 'ATT' AND component = 'finishing' AND season = '2025-26';

-- ── 2. Delete old GW25 data so the re-sync creates fresh rows ───────

DELETE FROM player_stats WHERE gameweek = 25 AND season = '2025-26';

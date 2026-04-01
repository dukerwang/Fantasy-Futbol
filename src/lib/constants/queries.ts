/**
 * Centralized select string for player queries to ensure 
 * consistent Rank and Stat data across the entire application.
 * Note: player_rankings is a view and cannot be joined nested 
 * via standard Postgrest relationships. We fetch rankings separately 
 * and map them in the page logic.
 */
export const FULL_PLAYER_SELECT = `
  id,
  fpl_id,
  api_football_id,
  web_name,
  name,
  full_name,
  date_of_birth,
  nationality,
  pl_team,
  pl_team_id,
  primary_position,
  secondary_positions,
  market_value,
  market_value_updated_at,
  projected_points,
  photo_url,
  height_cm,
  fpl_status,
  fpl_news,
  total_points,
  form_rating,
  ppg,
  is_active,
  transfermarkt_id,
  created_at,
  updated_at
`.replace(/\s+/g, ' ').trim();

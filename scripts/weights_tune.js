const fs = require('fs');
let content = fs.readFileSync('scripts/calc_season_leaderboard.js', 'utf8');

content = content.replace(/const FLEX_CONFIG = \{[\s\S]*?\};/, `const FLEX_CONFIG = {
  GK: { flex: 0.20, components: ['save_score', 'defensive'] },
  CB: { flex: 0.25, components: ['defensive', 'match_impact', 'influence'] },
  LB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity'] },
  RB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity'] },
  DM: { flex: 0.25, components: ['defensive', 'influence', 'match_impact'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  LM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'influence'] },
  RM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'influence'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  LW: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
  RW: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
  ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};`);

content = content.replace(/const POSITION_WEIGHTS = \{[\s\S]*?\};/, `const POSITION_WEIGHTS = {
  GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
  CB: { match_impact: 0.35, influence: 0.15, creativity: 0.05, threat: 0.00, defensive: 0.05, goal_involvement: 0.15, finishing: 0.05, save_score: 0.00 }, // Gabriel buff
  LB: { match_impact: 0.20, influence: 0.15, creativity: 0.10, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  RB: { match_impact: 0.20, influence: 0.15, creativity: 0.10, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  DM: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  LM: { match_impact: 0.15, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  RM: { match_impact: 0.15, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  AM: { match_impact: 0.15, influence: 0.15, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 }, // Bruno tune
  LW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.20, defensive: 0.00, goal_involvement: 0.20, finishing: 0.10, save_score: 0.00 },
  RW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.20, defensive: 0.00, goal_involvement: 0.20, finishing: 0.10, save_score: 0.00 },
  ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.30, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }, // Haaland buff
};`);

content = content.replace(/match_control: \{[^\}]+\}, /g, '');
content = content.replace(/\s*\/\/ 6\. Match Control[\s\S]*?\/\/ 7\. Goal Involvement/g, '\n  // 6. Goal Involvement');
content = content.replace(/\/\/ 7\. Goal Involvement/, '// 6. Goal Involvement');
content = content.replace(/\/\/ 8\. Finishing/, '// 7. Finishing');
content = content.replace(/\/\/ 9\. Save Score/, '// 8. Save Score');

// Also remove the "match_control" key from the score object inside function
content = content.replace(/match_control: [a-zA-Z0-9_]+,?/g, '');

fs.writeFileSync('scripts/calc_tune.js', content, 'utf8');

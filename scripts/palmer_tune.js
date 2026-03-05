const fs = require('fs');

let content = fs.readFileSync('scripts/calc_season_leaderboard.js', 'utf8');

content = content.replace(/const FLEX_CONFIG = \{[\s\S]*?\};/, `const FLEX_CONFIG = {
  GK: { flex: 0.20, components: ['save_score', 'defensive'] },
  CB: { flex: 0.25, components: ['defensive', 'goal_involvement', 'influence'] },
  LB: { flex: 0.25, components: ['creativity', 'goal_involvement', 'defensive'] },
  RB: { flex: 0.25, components: ['creativity', 'goal_involvement', 'defensive'] },
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'goal_involvement'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  LM: { flex: 0.20, components: ['creativity', 'goal_involvement', 'influence'] },
  RM: { flex: 0.20, components: ['creativity', 'goal_involvement', 'influence'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  LW: { flex: 0.20, components: ['threat', 'goal_involvement', 'finishing'] },
  RW: { flex: 0.20, components: ['threat', 'goal_involvement', 'finishing'] },
  ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};`);

content = content.replace(/const POSITION_WEIGHTS = \{[\s\S]*?\};/, `const POSITION_WEIGHTS = {
  GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
  CB: { match_impact: 0.25, influence: 0.15, creativity: 0.05, threat: 0.00, defensive: 0.05, goal_involvement: 0.20, finishing: 0.05, save_score: 0.00 },
  LB: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.10, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  RB: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.10, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  LM: { match_impact: 0.15, influence: 0.15, creativity: 0.10, threat: 0.10, defensive: 0.15, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  RM: { match_impact: 0.15, influence: 0.15, creativity: 0.10, threat: 0.10, defensive: 0.15, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  AM: { match_impact: 0.15, influence: 0.15, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  LW: { match_impact: 0.15, influence: 0.15, creativity: 0.05, threat: 0.15, defensive: 0.05, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
  RW: { match_impact: 0.15, influence: 0.15, creativity: 0.05, threat: 0.15, defensive: 0.05, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
  ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.30, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
};`);

// Append logic to dump Palmer
content = content.replace(/process\.exit\(1\);\n\}\);/, `
  const palmer = Array.from(playerTotals.values()).find(p => p.name.includes("Palmer"));
  if (palmer) {
    console.log("\\n\\n--- COLE PALMER RAW GAMES ---");
    palmer.gwBreakdown.forEach(gw => {
       console.log(\`GW\${gw.gw}: Rating \${gw.rating.toFixed(2)} -> Pts \${gw.points.toFixed(2)}\`);
    });
  }
  process.exit(1);
});
`);

fs.writeFileSync('scripts/calc_palmer_tune.js', content, 'utf8');

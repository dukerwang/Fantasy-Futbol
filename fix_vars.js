const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/page.tsx';
let code = fs.readFileSync(path, 'utf8');

const match = code.match(/const activity = activityResult\.data \?\? \[\];\n  const initialTeams = \([\s\S]*?\]\);/);
if (match) {
  const newVars = `const activity = activityResult.data ?? [];
  const initialTeams = (teamsResult.data ?? []) as Array<{ id: string; team_name: string; draft_order: number | null }>;
  const taxiSquad = taxiResult?.data ?? [];
  const tournaments = tournamentsResult?.data ?? [];`;
  code = code.replace(match[0], newVars);
  fs.writeFileSync(path, code);
  console.log("fixed vars");
} else {
  console.log("could not match vars block");
}

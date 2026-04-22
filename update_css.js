const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/league.module.css';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('.leftCol {') && code.includes('.centerCol {')) {
  code = code.replace('.centerCol {', '.leftCol,\n.centerCol {');
  fs.writeFileSync(path, code);
  console.log("added .leftCol to .centerCol group");
} else {
  console.log("already exists or .centerCol not found");
}

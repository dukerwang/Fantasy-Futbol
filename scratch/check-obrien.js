const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'sofifa_positions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const match = data.filter(p => p.full_name.includes("O'Brien") || p.short_name.includes("O'Brien"));
match.forEach(p => {
  console.log(`- Name: ${p.full_name}, Short: ${p.short_name}, Positions: ${JSON.stringify(p.positions)}`);
});

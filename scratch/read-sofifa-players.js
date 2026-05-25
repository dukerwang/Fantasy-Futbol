const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'sofifa_positions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const targets = ['Porro', 'Henry', 'Aït-Nouri', 'Robertson', 'Gusto', 'Bradley', 'Aznou', 'Timber'];

targets.forEach(t => {
  const match = data.filter(p => p.full_name.includes(t) || p.short_name.includes(t));
  console.log(`\nMatches for ${t}:`);
  match.forEach(p => {
    console.log(`- ${p.full_name} (${p.short_name}): Positions: ${JSON.stringify(p.positions)}`);
  });
});

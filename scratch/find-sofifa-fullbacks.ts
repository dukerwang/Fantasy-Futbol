import fs from 'fs';
import path from 'path';

const INPUT_FILE = path.join(process.cwd(), 'sofifa_positions.json');
const sofifaPlayers = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

const targets = ['Pedro Porro', 'Muñoz', 'Reece James'];

for (const name of targets) {
  const matches = sofifaPlayers.filter((p: any) => 
    (p.full_name && p.full_name.toLowerCase().includes(name.toLowerCase())) ||
    (p.short_name && p.short_name.toLowerCase().includes(name.toLowerCase())) ||
    (p.slug && p.slug.toLowerCase().includes(name.toLowerCase()))
  );
  console.log(`\nMatches for "${name}":`);
  console.log(JSON.stringify(matches, null, 2));
}

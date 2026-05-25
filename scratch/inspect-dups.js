const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'sofifa_positions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const nameMap = {};
data.forEach(p => {
  const short = p.short_name;
  const full = p.full_name;
  
  if (!nameMap[short]) nameMap[short] = [];
  nameMap[short].push(p);
  
  if (full && full !== short) {
    if (!nameMap[full]) nameMap[full] = [];
    nameMap[full].push(p);
  }
});

console.log("Checking duplicates in sofifa_positions.json:");
let dupCount = 0;
for (const [name, list] of Object.entries(nameMap)) {
  if (list.length > 1) {
    const ids = list.map(x => x.sofifa_id);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > 1) {
      dupCount++;
      console.log(`\nName: "${name}" has duplicate player entries:`);
      list.forEach(p => {
        console.log(`  - ID: ${p.sofifa_id}, Slug: ${p.slug}, Positions: ${JSON.stringify(p.positions)}`);
      });
    }
  }
}
console.log(`\nTotal duplicate name conflicts: ${dupCount}`);

import fs from 'fs';
import path from 'path';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const csvPath = path.resolve(process.cwd(), 'scratch/merged_gw_24_25.csv');
const fileContent = fs.readFileSync(csvPath, 'utf-8');
const lines = fileContent.split('\n');

const header = parseCSVLine(lines[0]);
const colIdx = (name: string) => header.indexOf(name);

const amadRows = lines.slice(1).map(l => parseCSVLine(l)).filter(p => p[colIdx('name')] === 'Amad Diallo');

if (amadRows.length > 0) {
  console.log(`=== AMAD DIALLO IN CSV ===`);
  console.log(`Total rows: ${amadRows.length}`);
  const played = amadRows.filter(r => Number(r[colIdx('minutes')]) > 0);
  console.log(`Games with minutes > 0: ${played.length}`);
  const sumPoints = played.reduce((s, r) => s + Number(r[colIdx('total_points')]), 0);
  console.log(`Total FPL points: ${sumPoints}`);
  console.log(`Average FPL PPG: ${(sumPoints / played.length).toFixed(2)}`);
  
  console.log("\nAppearances breakdown (GW | Mins | Points | Goals | Assists | BPS | Infl | Threat):");
  played.forEach(r => {
    console.log(`GW${r[colIdx('GW')]} | Mins: ${r[colIdx('minutes')]} | Pts: ${r[colIdx('total_points')]} | G: ${r[colIdx('goals_scored')]} | A: ${r[colIdx('assists')]} | BPS: ${r[colIdx('bps')]} | Infl: ${r[colIdx('influence')]} | Threat: ${r[colIdx('threat')]}`);
  });
} else {
  console.log("Amad Diallo not found in CSV!");
}

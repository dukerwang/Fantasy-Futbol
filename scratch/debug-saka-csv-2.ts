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

const id17 = lines.slice(1).map(l => parseCSVLine(l)).filter(p => p[colIdx('element')] === '17');
const id388 = lines.slice(1).map(l => parseCSVLine(l)).filter(p => p[colIdx('element')] === '388');

if (id17.length > 0) {
  console.log(`=== ID 17 ===`);
  console.log(`Name in CSV: ${id17[0][colIdx('name')]}`);
  console.log(`Total rows: ${id17.length}`);
  const played = id17.filter(r => Number(r[colIdx('minutes')]) > 0);
  console.log(`Games with minutes > 0: ${played.length}`);
  const sumPoints = played.reduce((s, r) => s + Number(r[colIdx('total_points')]), 0);
  console.log(`Total FPL points: ${sumPoints}`);
  console.log(`Average FPL PPG: ${(sumPoints / played.length).toFixed(2)}`);
}

if (id388.length > 0) {
  console.log(`=== ID 388 ===`);
  console.log(`Name in CSV: ${id388[0][colIdx('name')]}`);
  console.log(`Total rows: ${id388.length}`);
  const played = id388.filter(r => Number(r[colIdx('minutes')]) > 0);
  console.log(`Games with minutes > 0: ${played.length}`);
  const sumPoints = played.reduce((s, r) => s + Number(r[colIdx('total_points')]), 0);
  console.log(`Total FPL points: ${sumPoints}`);
  console.log(`Average FPL PPG: ${(sumPoints / played.length).toFixed(2)}`);
}

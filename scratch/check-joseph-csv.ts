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

console.log("=== SCANNING FOR JOSEPH IN CSV ===");
const matched = new Set<string>();
const matchedTeams = new Map<string, string>();
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const parts = parseCSVLine(line);
  if (parts.length < header.length) continue;

  const name = parts[colIdx('name')];
  if (name.toLowerCase().includes('joseph')) {
    matched.add(name);
    matchedTeams.set(name, parts[colIdx('team')]);
  }
}
console.log("Names matching 'joseph' in CSV:");
for (const n of matched) {
  console.log(`- Name: '${n}', Team: '${matchedTeams.get(n)}'`);
}

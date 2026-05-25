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

console.log("=== SCANNING FOR SAKA IN CSV ===");
const sakaRows: any[] = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const parts = parseCSVLine(line);
  if (parts.length < header.length) continue;

  const name = parts[colIdx('name')];
  if (name.toLowerCase().includes('saka')) {
    sakaRows.push(parts);
  }
}

console.log(`Found ${sakaRows.length} rows matching 'saka'.`);
if (sakaRows.length > 0) {
  console.log("First row match details:");
  const first = sakaRows[0];
  header.forEach((h, idx) => {
    console.log(`- ${h}: ${first[idx]}`);
  });

  // Group by element (ID) to see if there are multiple FPL IDs
  const elements = new Set<string>();
  sakaRows.forEach(r => elements.add(r[colIdx('element')]));
  console.log("Unique elements (IDs) found for Saka:", Array.from(elements));
  
  // Count minutes played > 0
  const played = sakaRows.filter(r => Number(r[colIdx('minutes')]) > 0);
  console.log(`Appearances with minutes > 0: ${played.length}`);
}

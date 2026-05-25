import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9 ]/g, "") // remove special characters
    .trim();
}

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

(async () => {
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('name, primary_position')
    .not('fpl_id', 'is', null);

  const nameToGranular = new Map<string, string>();
  const nameToRealName = new Map<string, string>();
  
  for (const p of dbPlayers ?? []) {
    const norm = normalizeName(p.name);
    nameToGranular.set(norm, p.primary_position);
    nameToRealName.set(norm, p.name);
  }

  const csvPath = path.resolve(process.cwd(), 'scratch/merged_gw_24_25.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = fileContent.split('\n');

  const header = parseCSVLine(lines[0]);
  const colIdx = (name: string) => header.indexOf(name);

  // Group raw rows by player (element)
  const playerRowsMap = new Map<number, any[]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = parseCSVLine(line);
    if (parts.length < header.length) continue;
    const element = Number(parts[colIdx('element')]);
    if (!playerRowsMap.has(element)) {
      playerRowsMap.set(element, []);
    }
    playerRowsMap.get(element)!.push(parts);
  }

  console.log("=== MATCHED LEADERS DIAGNOSIS ===");
  for (const [element, rows] of playerRowsMap.entries()) {
    const rawCsvName = rows[0][colIdx('name')].replace(/"/g, '');
    const normName = normalizeName(rawCsvName);
    
    const matchedRealName = nameToRealName.get(normName);
    if (matchedRealName === 'Mateo Joseph' || rawCsvName.includes('Joseph') || matchedRealName?.includes('Joseph')) {
      console.log(`CSV Name: '${rawCsvName}' (element ${element})`);
      console.log(`  - Normalized: '${normName}'`);
      console.log(`  - Matched DB Real Name: '${matchedRealName}'`);
      console.log(`  - Matched DB Position: '${nameToGranular.get(normName)}'`);
    }
  }
})();

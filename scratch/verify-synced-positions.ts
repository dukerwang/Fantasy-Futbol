import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env variables manually from .env.local
const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function verify() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const playersToVerify = [
    "Jake O'Brien",
    "Reece James",
    "John McGinn",
    "Adrien Truffert",
    "Matheus Nunes",
    "Jeremie Frimpong",
    "Patrick Dorgu"
  ];

  console.log('Querying synced positions from DB:\n');

  for (const name of playersToVerify) {
    const { data, error } = await supabase
      .from('players')
      .select('name, primary_position, secondary_positions')
      .ilike('name', `%${name}%`)
      .maybeSingle();

    if (error) {
      console.error(`Error fetching ${name}:`, error);
    } else if (data) {
      console.log(`- ${data.name}:`);
      console.log(`  Primary:   ${data.primary_position}`);
      console.log(`  Secondary: ${JSON.stringify(data.secondary_positions)}`);
    } else {
      console.log(`- ${name} not found in DB`);
    }
  }
}

verify().catch(console.error);

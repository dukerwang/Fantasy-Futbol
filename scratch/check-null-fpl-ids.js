const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data: players, error } = await supabase
    .from('players')
    .select('name, fpl_id, primary_position, secondary_positions')
    .eq('is_active', true);

  if (error) {
    console.error("Error fetching players:", error);
    return;
  }

  const nullFplIds = players.filter(p => p.fpl_id === null);
  console.log(`Total active players: ${players.length}`);
  console.log(`Active players with null fpl_id: ${nullFplIds.length}`);
  if (nullFplIds.length > 0) {
    console.log("Null FPL ID players:", nullFplIds.map(p => p.name));
  }
}

main().catch(console.error);

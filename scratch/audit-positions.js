const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase URL or Key in process.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data: players, error } = await supabase
    .from('players')
    .select('name, web_name, primary_position, secondary_positions')
    .in('primary_position', ['LWB', 'RWB', 'LB', 'RB'])
    .eq('is_active', true);

  if (error) {
    console.error("Error fetching players:", error);
    return;
  }

  console.log(`Total active wingbacks/fullbacks in DB: ${players.length}`);
  console.log("\nSample of LWB/RWB players in DB:");
  const wingbacks = players.filter(p => ['LWB', 'RWB'].includes(p.primary_position));
  console.log(`Found ${wingbacks.length} wingbacks.`);
  wingbacks.forEach(p => {
    console.log(`- ${p.name} (Primary: ${p.primary_position}, Secondaries: ${JSON.stringify(p.secondary_positions)})`);
  });

  console.log("\nSample of LB/RB players in DB (first 20):");
  const fullbacks = players.filter(p => ['LB', 'RB'].includes(p.primary_position));
  console.log(`Found ${fullbacks.length} standard fullbacks.`);
  fullbacks.slice(0, 20).forEach(p => {
    console.log(`- ${p.name} (Primary: ${p.primary_position}, Secondaries: ${JSON.stringify(p.secondary_positions)})`);
  });
}

main().catch(console.error);

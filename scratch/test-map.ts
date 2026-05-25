import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

// simple mock of normalizeName
function normalizeName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z\s]/g, "").toLowerCase().trim();
}

dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: dbPlayers } = await supabase.from('players').select('id, name, web_name').ilike('name', '%James%');
  console.log("DB Players:", dbPlayers);
  
  const scraped = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));
  for (const t of scraped) {
    for (const p of t.players) {
      if (p.fullName && p.fullName.includes('James')) {
        console.log("Scraped:", p.fullName, p.commonName);
      }
    }
  }
})();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCherkiAndEderson() {
  const { data: cherki } = await supabase.from('players').select('*').ilike('name', '%cherki%');
  console.log('Cherki rows in DB:', cherki);

  const { data: ederson } = await supabase.from('players').select('*').ilike('name', '%ederson%');
  console.log('\nEderson rows in DB:', ederson);
}

checkCherkiAndEderson();

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

async function fixWebNames() {
  const fixes = [
    { id: 'a608ff0c-c282-4e15-a0f8-0e21d91cb378', web_name: 'Páez', name: 'Kendry Páez Andrade' },
    { id: '1b86dcf8-6b20-489c-91c6-162afcb36e31', web_name: 'Paulsen', name: 'Alex Paulsen' },
    { id: '987a5ca4-2058-43d6-97e9-453e3bda0134', web_name: 'Hein', name: 'Karl Hein' },
    { id: 'd4be7445-9780-4de3-8970-1a8f77ef66bb', web_name: 'Roberts', name: 'Patrick Roberts' }
  ];

  for (const f of fixes) {
    const { error } = await supabase.from('players').update({ web_name: f.web_name }).eq('id', f.id);
    if (error) console.error(`Error updating ${f.name}:`, error);
    else console.log(`✅ Restored web_name for ${f.name} -> '${f.web_name}'`);
  }
}

fixWebNames();

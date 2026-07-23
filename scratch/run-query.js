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

async function check() {
  const { data: bowen } = await supabase
    .from('players')
    .select('id')
    .eq('web_name', 'Bowen')
    .limit(1)
    .single();

  if (bowen) {
    const { data: debugRows, error } = await supabase
      .rpc('temp_debug_form_ratings');

    if (error) {
      console.error(error);
      return;
    }

    console.log(`Total debug rows returned: ${debugRows.length}`);
    const bowenRow = debugRows.find(r => r.p_id === bowen.id);
    console.log('Bowen debug rating row:', bowenRow);
  }
}

check();

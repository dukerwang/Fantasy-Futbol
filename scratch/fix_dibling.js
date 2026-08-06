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

async function fixDibling() {
  const { error } = await supabase
    .from('players')
    .update({
      primary_position: 'RW',
      secondary_positions: ['AM']
    })
    .eq('id', 'f0e5257d-5cf1-43ac-b8a5-d51b6d837346');

  if (error) {
    console.error('Failed to update Tyler Dibling:', error);
  } else {
    const { data: after } = await supabase.from('players').select('id, name, web_name, primary_position, secondary_positions').eq('id', 'f0e5257d-5cf1-43ac-b8a5-d51b6d837346').single();
    console.log('After repairing Tyler Dibling:', after);
  }
}

fixDibling();

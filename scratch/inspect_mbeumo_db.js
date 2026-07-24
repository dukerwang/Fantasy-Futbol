process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMbeumo() {
  const { data: p } = await supabase.from('players').select('*').eq('id', 'f5333e64-a954-46bb-9d20-f4e5784a6b68');
  console.log('Row f5333e64-a954-46bb-9d20-f4e5784a6b68 in DB:', p);
}

checkMbeumo().catch(console.error);

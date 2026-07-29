process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkColumns() {
  const { data, error } = await supabase.from('players').select('*').limit(1);
  if (error) {
    console.error(error);
    return;
  }
  console.log('Columns in players table:', Object.keys(data[0] || {}));
}

checkColumns();

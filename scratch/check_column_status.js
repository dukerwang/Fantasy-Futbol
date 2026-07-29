process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkOrAddColumn() {
  const { data, error } = await supabase.from('players').select('sofifa_common_name').limit(1);
  if (error && error.code === 'PGRST204') {
    console.log('Column sofifa_common_name does not exist yet.');
  } else if (!error) {
    console.log('✅ Column sofifa_common_name already exists in Supabase DB!');
    return;
  }

  // Attempt raw query or rpc if available
  console.log('Running RPC or table update test...');
}

checkOrAddColumn().catch(console.error);

process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyColumn() {
  const { data, error } = await supabase.from('players').select('id, name, sofifa_common_name').limit(5);
  if (error) {
    console.error('Error selecting sofifa_common_name:', error);
  } else {
    console.log('✅ Successfully selected sofifa_common_name! Sample data:');
    console.table(data);
  }
}

verifyColumn().catch(console.error);

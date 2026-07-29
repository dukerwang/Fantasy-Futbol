const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await db.from('players')
    .select('web_name, name, full_name')
    .in('web_name', ['Truffert','Senesi','Tarkowski','Calvert-Lewin','Stach','Welbeck','Mukiele','Anthony','Kroupi.Jr','Saka','Haaland'])
    .limit(15);
  console.table(data);
  // How often does web_name differ from a computed short name?
  const { data: sample } = await db.from('players').select('web_name, name, full_name').eq('is_active', true).limit(400);
  const noSpaceInName = sample.filter(p => !(p.name||'').trim().includes(' ')).length;
  console.log('\nactive sampled:', sample.length);
  console.log('name has no space (single-word):', noSpaceInName);
  console.log('full_name null:', sample.filter(p => !p.full_name).length);
  console.log('name null:', sample.filter(p => !p.name).length);
})();

const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
(async () => {
  const { data } = await db.from('players').select('id, web_name, name, pl_team, is_active').eq('is_active', true);
  const bad = data.filter(p => !norm(p.name).includes(norm(p.web_name)));
  console.log('active players     :', data.length);
  console.log('web_name NOT found in name:', bad.length, `(${(bad.length/data.length*100).toFixed(1)}%)`);
  console.log('\nfirst 12 mismatches:');
  console.table(bad.slice(0,12).map(p => ({ web_name: p.web_name, name: p.name, club: p.pl_team })));

  // duplicate web_names among active players
  const counts = {};
  for (const p of data) counts[p.web_name] = (counts[p.web_name]||0)+1;
  const dupes = Object.entries(counts).filter(([,n]) => n>1).sort((a,b)=>b[1]-a[1]);
  console.log('\nduplicate web_names:', dupes.length, '— top:', JSON.stringify(dupes.slice(0,8)));
})();

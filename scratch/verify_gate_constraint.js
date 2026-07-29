const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Functional test of player_sale_listings_gate_not_inert.
// Target: the EXPIRED listing (not actionable by anyone). If the constraint is
// live the write is rejected and nothing changes. If it is missing, we restore.
const TARGET = 'bab4b051-efea-49c4-8541-df668ae53301';

(async () => {
  const { data: before } = await db.from('player_sale_listings')
    .select('open_to_trade, open_to_sale, open_to_loan').eq('id', TARGET).single();
  console.log('before:', JSON.stringify(before));

  const { error } = await db.from('player_sale_listings')
    .update({ open_to_trade: false, open_to_sale: false, open_to_loan: false })
    .eq('id', TARGET);

  if (error) {
    console.log('\nwrite REJECTED ✓ — constraint is enforcing');
    console.log('  ', error.code, error.message);
  } else {
    console.log('\n✗ write ACCEPTED — gate_not_inert is NOT enforcing. Restoring…');
    await db.from('player_sale_listings').update(before).eq('id', TARGET);
  }

  const { data: after } = await db.from('player_sale_listings')
    .select('open_to_trade, open_to_sale, open_to_loan').eq('id', TARGET).single();
  console.log('after :', JSON.stringify(after));
  console.log('unchanged:', JSON.stringify(before) === JSON.stringify(after) ? 'YES ✓' : 'NO ✗');
})();

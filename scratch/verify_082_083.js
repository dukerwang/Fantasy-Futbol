const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1. Does open_to_loan exist? (083 §1)
  const { error: colErr } = await db.from('player_sale_listings').select('open_to_loan').limit(1);
  console.log('083 open_to_loan column :', colErr ? 'MISSING — ' + colErr.message : 'PRESENT ✓');

  // 2. Gate backfill + inert count (082 §1, 083 §2 post-apply check)
  const { data, error } = await db.from('player_sale_listings')
    .select('id, status, open_to_trade, open_to_sale, open_to_loan, min_bid, ask_price, buy_now_price');
  if (error) return console.error('ERR', error.message);

  const open = data.filter(l => ['pending','active'].includes(l.status));
  const inert = data.filter(l => !l.open_to_trade && !l.open_to_sale && !l.open_to_loan);
  const both  = data.filter(l => l.open_to_trade && l.open_to_sale);
  const saleNoPrice = data.filter(l => l.open_to_sale && l.ask_price === null);

  console.log('total listings         :', data.length, `(${open.length} open)`);
  console.log('082 inert (all 3 false):', inert.length, inert.length === 0 ? '✓' : '✗ EXPECTED 0');
  console.log('082 backfilled to both :', both.length);
  console.log('082 sale w/o ask_price :', saleNoPrice.length, saleNoPrice.length === 0 ? '✓' : '✗ EXPECTED 0');
  console.log('083 opted into loan    :', data.filter(l => l.open_to_loan).length, '(expected 0 — nothing opts in until a seller does)');
  console.log();
  console.log(JSON.stringify(data, null, 1));
})();

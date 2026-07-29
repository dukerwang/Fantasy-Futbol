const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await db.from('player_sale_listings')
    .select('id, league_id, player_id, status, open_to_trade, open_to_sale, min_bid, ask_price, buy_now_price, created_at')
    .order('created_at', { ascending: false });
  if (error) return console.error('ERR', error.message);
  console.log('total listings:', data.length);
  const inert = data.filter(l => !l.open_to_trade && !l.open_to_sale);
  console.log('INERT (both gates false):', inert.length);
  console.log(JSON.stringify(data.slice(0, 10), null, 1));
})();

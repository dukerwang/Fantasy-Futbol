const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error: e1 } = await db.from('player_loans')
    .select('id, lender_team_id, borrower_team_id, loan_fee, created_at, status, player_id, league_id').limit(1);
  console.log('player_loans select:', e1 ? 'FAIL ' + e1.message : 'OK');

  const { error: e2 } = await db.from('player_sale_listings').select('open_to_loan').limit(1);
  console.log('open_to_loan column:', e2 ? 'ABSENT (083 not yet applied) — ' + e2.message : 'PRESENT (083 already applied)');
})();

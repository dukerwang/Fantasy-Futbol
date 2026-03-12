const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://hnkavimrsbytsesdzwvj.supabase.co";
const SUPABASE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log('Creating Mock League and Teams...');
  
  const testUsers = [];
  for (let i = 1; i <= 4; i++) {
    const email = `bot${i}@fantasyfutbol.test`;
    const password = 'Password123!';
    
    // Check if exists
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).single();
    
    let userId;
    if (existingUser) {
        userId = existingUser.id;
        console.log(`User ${email} exists: ${userId}`);
    } else {
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (authErr && !authErr.message.includes('already exists')) {
            console.error('Error creating user', email, authErr);
            continue;
        }
        
        userId = authData?.user?.id;
        
        if (userId) {
            // Ensure public.users record exists
            await supabase.from('users').upsert({ id: userId, email, username: `Bot ${i}` });
            console.log(`Created user ${email}: ${userId}`);
        }
    }
    if (userId) testUsers.push(userId);
  }
  
  if (testUsers.length === 0) return console.log('No users created/found.');

  const commishId = testUsers[0];

  // 2. Create League
  const leagueName = `Test League ${Date.now()}`;
  const joinCode = `TEST${Math.floor(Math.random() * 1000)}`;
  const { data: league, error: leagueErr } = await supabase.from('leagues').insert({
      name: leagueName,
      commissioner_id: commishId,
      join_code: joinCode,
      status: 'drafting',
      roster_size: 5 // Keep it small for quick testing
  }).select().single();
  
  if (leagueErr) return console.error('Error creating league', leagueErr);
  console.log(`Created League: ${league.name} (${league.id})`);
  
  // 3. Create Teams
  for (let i = 0; i < testUsers.length; i++) {
      const { error: teamErr } = await supabase.from('teams').insert({
          league_id: league.id,
          user_id: testUsers[i],
          team_name: `FC Bot ${i+1}`,
          manager_name: `Bot ${i+1}`,
          draft_order: i + 1,
          transfer_budget: 100
      });
      if (teamErr) console.error(`Error creating team for Bot ${i+1}`, teamErr);
  }
  
  console.log('Successfully set up test league!');
  console.log(`League ID: ${league.id}`);
}

main().catch(console.error);

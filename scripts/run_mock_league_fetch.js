const URL = "https://hnkavimrsbytsesdzwvj.supabase.co/rest/v1";
const AUTH_URL = "https://hnkavimrsbytsesdzwvj.supabase.co/auth/v1";
const KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY";

const headers = {
  'apikey': KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function main() {
  console.log('Creating Mock League and Teams via REST...');
  
  const newSessionId = Math.floor(Math.random() * 100000);
  const freshUsers = [];
  
  for (let i = 1; i <= 4; i++) {
      const email = `testbot${i}_${newSessionId}@fantasyfutbol.test`;
      const username = `TestBot${i}_${newSessionId}`;
      
      let res = await fetch(`${AUTH_URL}/admin/users`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, password: 'Password123!', email_confirm: true })
      });
      let authData = await res.json();
      let userId = authData?.user?.id || authData?.id;
      
      if (userId) {
          await fetch(`${URL}/users`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
                body: JSON.stringify({ id: userId, email, username })
          });
          console.log(`Created fresh user ${email}: ${userId}`);
          freshUsers.push(userId);
      } else {
          console.error(`Failed creating fresh user ${email}:`, authData);
      }
  }
  
  if (freshUsers.length === 0) return console.log('No users created/found.');

  const commishId = freshUsers[0];

  // 2. Create League
  const leagueName = `Test League ${newSessionId}`;
  const inviteCode = `TEST${newSessionId}`;
  
  let res = await fetch(`${URL}/leagues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
          name: leagueName,
          commissioner_id: commishId,
          season: "2025-26",
          max_teams: 4,
          roster_size: 5,
          bench_size: 2,
          faab_budget: 100,
          draft_type: "snake",
          is_dynasty: false,
          status: 'drafting',
          scoring_rules: { goal: 6, assist: 4, clean_sheet: 4 } // Minimal mock
      })
  });
  const leagueData = await res.json();
  const league = leagueData[0];
  
  if (!league) return console.error('Error creating league', leagueData);
  console.log(`Created League: ${league.name} (${league.id})`);
  
  // 3. Create Teams
  for (let i = 0; i < freshUsers.length; i++) {
      let r = await fetch(`${URL}/teams`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
              league_id: league.id,
              user_id: freshUsers[i],
              team_name: `FC Bot ${i+1}`,
              draft_order: i + 1,
              faab_budget: 100,
              total_points: 0
          })
      });
      const t = await r.json();
      if ((t.error || t.code) && !Array.isArray(t)) console.error(`Error creating team for Bot ${i+1}`, t);
      else console.log(`Created team for Bot ${i+1}`);
  }
  
  console.log('\n=============================================');
  console.log('Successfully set up test league!');
  console.log(`League ID: ${league.id}`);
  console.log(`League Invite Code: (not needed since bots are auto-added)`);
  console.log('\n--- PLAYERS FOR TESTING (Password: Password123!) ---');
  for (let i=1; i<=4; i++) {
      console.log(`Bot ${i}: testbot${i}_${newSessionId}@fantasyfutbol.test`);
  }
  console.log('=============================================');
}

main().catch(console.error);

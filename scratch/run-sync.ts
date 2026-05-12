
import { createAdminClient } from './src/lib/supabase/admin.ts';
import { syncPlayersFromFpl } from './src/lib/players/syncPlayers.ts';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function runSync() {
  console.log('Starting manual sync to apply position overrides...');
  const admin = createAdminClient();
  const result = await syncPlayersFromFpl(admin);
  console.log('Sync complete:', JSON.stringify(result, null, 2));
  process.exit(0);
}

runSync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});

/** Replicates the fixed loadSeasonStatsContext pool rule against real data. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const page = async (t,s,eq)=>{let o=[];for(let f=0;;f+=1000){let q=admin.from(t).select(s).range(f,f+999);if(eq)q=q.eq(...eq);const{data,error}=await q;if(error)throw error;o=o.concat(data);if(data.length<1000)break;}return o;};

const season = '2025-26';
const archives = await page('season_player_stats_archive','player_id, total_points',['season',season]);
const archiveMap = new Map(archives.map(a=>[a.player_id,a]));
const archived = archives.length > 0;
const players = await page('players','id, name, pl_team, is_active, total_points');

const pool = (includeActive) => players.filter(p => archived ? (archiveMap.has(p.id) || (includeActive && p.is_active)) : p.is_active);

const before = pool(false), after = pool(true);
console.log(`season=${season} archived=${archived}`);
console.log(`leaderboard pool BEFORE fix: ${before.length}`);
console.log(`leaderboard pool AFTER  fix: ${after.length}   (+${after.length - before.length})`);
console.log(`rank-recompute pool (unchanged, no option): ${before.length}`);

const probe = ['Rashford','van Ewijk','Vušković','Leif Davis','Nicolas Jackson','Quenda'];
console.log('\nsearchable now?');
for (const q of probe) {
  const hit = after.find(p => p.name.includes(q));
  const wasThere = before.some(p => p.name.includes(q));
  console.log(`   ${q.padEnd(16)} after=${hit ? 'YES' : 'no'} before=${wasThere ? 'YES' : 'no'}  ${hit ? `(${hit.pl_team}, shows ${archiveMap.has(hit.id) ? 'archive pts' : '0 pts'})` : ''}`);
}
const clubs = {};
after.forEach(p => { if (!archiveMap.has(p.id)) clubs[p.pl_team ?? 'null'] = (clubs[p.pl_team ?? 'null'] ?? 0) + 1; });
console.log('\nrestored players by current club:', clubs);

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const { data } = await admin.from('players').select('name, pl_team, total_points, ppg, form_rating, is_active')
  .in('name', ['Marcus Rashford','Luka Vušković','Nicolas Jackson','Evan Ferguson','Leif Davis','Milan van Ewijk']);
console.log(data);
// how many active players have nonzero total_points but no 2025-26 archive row
let arch=[]; for(let f=0;;f+=1000){const {data:d}=await admin.from('season_player_stats_archive').select('player_id').eq('season','2025-26').range(f,f+999); arch=arch.concat(d); if(d.length<1000)break;}
const set=new Set(arch.map(r=>r.player_id));
let all=[]; for(let f=0;;f+=1000){const {data:d}=await admin.from('players').select('id,name,pl_team,total_points,ppg,is_active').range(f,f+999); all=all.concat(d); if(d.length<1000)break;}
const ex = all.filter(p=>p.is_active && !set.has(p.id));
const nonzero = ex.filter(p=>Number(p.total_points||0)!==0 || Number(p.ppg||0)!==0);
console.log('\nexcluded active players:', ex.length, '| with nonzero live total_points/ppg:', nonzero.length);
nonzero.slice(0,15).forEach(p=>console.log('  ', p.name, p.pl_team, 'pts=',p.total_points,'ppg=',p.ppg));

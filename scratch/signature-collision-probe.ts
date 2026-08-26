/* Signature-collision probe — "do two performances read the same?"
   Copy to src/lib/scoring/__tests__/zz-collide.test.ts, run vitest on it,
   read /tmp/collide.txt, delete the copy.

   Section A is the headline: P(two random same-position appearances carry an
   identical band+anchor signature). Section B is the tie structure of the raw
   group score, which is what diagnosed the mute rule — LB/RB/DM attacking had
   5-7 distinct values in a season. Section C shows WHAT the modal signatures
   are, so an honest collision (two identical bad games) is not mistaken for a
   defect. Section D restricts to the top 10% by points — the games a manager
   actually compares, and the number to watch.

   Baseline after the mute rule, 2025-26: section D collision is under 2.1%
   everywhere except GK at 7.3%, which is the open goalkeeper question in
   docs/HANDOFF-2026-08-23-scoring.md, not a banding problem. */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, POSITION_WEIGHTS as POSW, FEAT_GI_SATURATION_RAW, FEAT_GI_UNIT, FEAT_CREATIVITY_RAW, FEAT_CREATIVITY_UNIT } from '../matchRating';
import { buildPerformanceGroups } from '../perfBand';

const MEMBERS: Record<string, string[]> = {
  attacking: ['goal_involvement','finishing','threat'], creating: ['creativity'],
  defending: ['defensive','save_score'], involvement: ['match_impact','influence'],
  shotStopping: ['save_score'], goalsPrevented: ['defensive'],
};

it('collide', { timeout: 600000 }, async () => {
  for (const line of readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: refRows } = await db.from('rating_reference_stats').select('*').eq('season','2025-26');
  const refStats: any = {};
  for (const r of refRows ?? []) { refStats[r.position_group] ??= {}; refStats[r.position_group][r.component] = { median:Number(r.median), stddev:Number(r.stddev) }; }
  const excess = (s:any) => Math.max(0, Number(s.goals??0)*FEAT_GI_UNIT + Number(s.assists??0)*4 - FEAT_GI_SATURATION_RAW)/FEAT_GI_UNIT
    + Math.max(0, Number(s.creativity??0) - FEAT_CREATIVITY_RAW)/FEAT_CREATIVITY_UNIT;

  const rows:any[] = [];
  for (let from=0;;from+=1000) {
    const { data } = await db.from('player_stats').select('gameweek, stats, fantasy_points, players!inner(primary_position,name)').eq('season','2025-26').range(from,from+999);
    if (!data?.length) break; rows.push(...data); if (data.length<1000) break;
  }
  const out:string[]=[]; const log=(x:string)=>out.push(x);

  // signature = band|rank per group, in fixed order
  const sigOf = new Map<string,{sig:string,pos:string,gw:number,name:string,pts:number}>();
  const perPos = new Map<string, Map<string, number>>();
  const rawScores = new Map<string, number[]>();
  let n=0;
  for (const r of rows) {
    const pos=(r as any).players?.primary_position, s=(r as any).stats, nm=(r as any).players?.name;
    if (!pos||!s||Number(s.minutes_played??0)<=0) continue;
    const mr=calculateMatchRating(s,pos,refStats); if(!mr.breakdown.length) continue;
    n++;
    const by=new Map(mr.breakdown.map((b:any)=>[b.key,b.score]));
    const w:any=(POSW as any)[pos]??{};
    const gs=buildPerformanceGroups(mr.breakdown,pos,s,excess(s));
    const sig=gs.map(g=>`${g.band}${g.rank?'/'+g.rank.match(/(\d+)%/)![1]:''}`).join(' ');
    sigOf.set(`${r.gameweek}|${nm}`,{sig,pos,gw:Number(r.gameweek),name:nm,pts:Number(r.fantasy_points)});
    const pp=perPos.get(pos)??perPos.set(pos,new Map()).get(pos)!;
    pp.set(sig,(pp.get(sig)??0)+1);
    for (const g of gs) {
      const mem=MEMBERS[g.key]; const ws=mem.reduce((a,c)=>a+(Number(w[c])||0),0);
      if (ws<=0) continue;
      const sc=mem.reduce((a,c)=>a+Number(by.get(c)??0)*(Number(w[c])||0),0)/ws;
      const k=`${pos}|${g.key}`; let a=rawScores.get(k); if(!a){a=[];rawScores.set(k,a);} a.push(Number(sc.toFixed(6)));
    }
  }

  log(`${n} appearances\n`);
  log('=== A. SIGNATURE COLLISION, within position (whole season) ===');
  log('pos    n      distinct  modal-share  top-2-share  P(two random alike)');
  for (const [pos,m] of [...perPos].sort()) {
    const tot=[...m.values()].reduce((a,b)=>a+b,0);
    const sorted=[...m.values()].sort((a,b)=>b-a);
    const collide=sorted.reduce((a,c)=>a+c*(c-1),0)/(tot*(tot-1));
    log(pos.padEnd(7)+String(tot).padEnd(7)+String(m.size).padEnd(10)+
      `${(100*sorted[0]/tot).toFixed(1)}%`.padEnd(13)+
      `${(100*(sorted[0]+(sorted[1]??0))/tot).toFixed(1)}%`.padEnd(13)+
      `${(100*collide).toFixed(1)}%`);
  }

  log('\n=== B. TIE STRUCTURE of the raw group score ===');
  log('pos|group            n      distinct  mass@mode  modal value');
  for (const [k,arr] of [...rawScores].sort()) {
    const c=new Map<number,number>(); for(const v of arr) c.set(v,(c.get(v)??0)+1);
    const [mv,mc]=[...c].sort((a,b)=>b[1]-a[1])[0];
    log(k.padEnd(22)+String(arr.length).padEnd(7)+String(c.size).padEnd(10)+
      `${(100*mc/arr.length).toFixed(1)}%`.padEnd(11)+mv.toFixed(3));
  }

  // C. WHAT the colliding signatures actually are, and the points spread inside
  log('\n=== C. modal signatures — are the collisions honest? ===');
  const byPos=new Map<string,any[]>();
  for (const v of sigOf.values()) (byPos.get(v.pos)??byPos.set(v.pos,[]).get(v.pos)!).push(v);
  for (const pos of ['ST','LW','RW','GK','AM']) {
    const vs=byPos.get(pos)??[]; const m=new Map<string,any[]>();
    for (const v of vs) (m.get(v.sig)??m.set(v.sig,[]).get(v.sig)!).push(v);
    log(`\n${pos} — top 3 signatures of ${vs.length} appearances`);
    for (const [sig,list] of [...m].sort((a,b)=>b[1].length-a[1].length).slice(0,3)) {
      const pts=list.map(x=>x.pts).sort((a,b)=>a-b);
      log(`  ${String(list.length).padStart(4)} (${(100*list.length/vs.length).toFixed(1)}%)  ${sig.padEnd(34)} pts ${pts[0].toFixed(1)}–${pts[pts.length-1].toFixed(1)} (median ${pts[Math.floor(pts.length/2)].toFixed(1)})`);
    }
  }
  // D. collisions among games that MATTER — top 10% of points
  log('\n=== D. collision among the top 10% of performances by points ===');
  log('pos    n     distinct  modal  P(alike)');
  for (const [pos,vs] of [...byPos].sort()) {
    const top=[...vs].sort((a,b)=>b.pts-a.pts).slice(0,Math.max(10,Math.floor(vs.length*0.1)));
    const m=new Map<string,number>(); for(const v of top) m.set(v.sig,(m.get(v.sig)??0)+1);
    const sorted=[...m.values()].sort((a,b)=>b-a); const t=top.length;
    const col=sorted.reduce((a,c)=>a+c*(c-1),0)/(t*(t-1));
    log(pos.padEnd(7)+String(t).padEnd(6)+String(m.size).padEnd(10)+`${(100*sorted[0]/t).toFixed(1)}%`.padEnd(7)+`${(100*col).toFixed(1)}%`);
  }
  writeFileSync('/tmp/collide.txt',out.join('\n'));
});

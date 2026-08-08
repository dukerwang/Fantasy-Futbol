import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
/**
 * ANCHORED exposure-conditioned baseline — exploration only, ships nothing.
 *
 * Constraint being tested: the core engine must be untouched. Same components,
 * same weights, same sigmoid, same display/points curves, and FULL-90 RATINGS
 * MUST BE BIT-IDENTICAL to today.
 *
 * Idea: today's constant baseline is really "the baseline at full exposure".
 * So keep it as the anchor and scale it down for shorter outings:
 *
 *     mu_used(m)    = current_median * f(m)
 *     sigma_used(m) = current_stddev * f(m)
 *     f(m) = mean_data(m) / mean_data(75-90)      f(75..90) == 1
 *
 * Only appearances under 75 minutes can move. Nothing else in the engine changes.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SEASON = '2025-26';
const POSITIONS = ['GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LW','RW','ST'];

const FLEX_CONFIG = {
  GK:{flex:0.20,components:['save_score','defensive']},
  CB:{flex:0.25,components:['defensive','match_impact','goal_involvement']},
  LB:{flex:0.25,components:['defensive','match_impact','goal_involvement']},
  RB:{flex:0.25,components:['defensive','match_impact','goal_involvement']},
  DM:{flex:0.25,components:['match_impact','influence','defensive']},
  CM:{flex:0.25,components:['match_impact','creativity','influence']},
  LWB:{flex:0.25,components:['defensive','match_impact','creativity','threat','goal_involvement']},
  RWB:{flex:0.25,components:['defensive','match_impact','creativity','threat','goal_involvement']},
  AM:{flex:0.25,components:['creativity','goal_involvement','finishing']},
  LW:{flex:0.25,components:['goal_involvement','threat','creativity']},
  RW:{flex:0.25,components:['goal_involvement','threat','creativity']},
  ST:{flex:0.25,components:['threat','goal_involvement','finishing']},
};
const POSITION_WEIGHTS = {
  GK:{match_impact:0.25,influence:0.20,creativity:0.00,threat:0.00,defensive:0.32,goal_involvement:0.00,finishing:0.00,save_score:0.03},
  CB:{match_impact:0.30,influence:0.05,creativity:0.05,threat:0.00,defensive:0.25,goal_involvement:0.05,finishing:0.05,save_score:0.00},
  LB:{match_impact:0.30,influence:0.05,creativity:0.10,threat:0.00,defensive:0.20,goal_involvement:0.10,finishing:0.00,save_score:0.00},
  RB:{match_impact:0.30,influence:0.05,creativity:0.10,threat:0.00,defensive:0.20,goal_involvement:0.10,finishing:0.00,save_score:0.00},
  DM:{match_impact:0.30,influence:0.25,creativity:0.05,threat:0.00,defensive:0.10,goal_involvement:0.05,finishing:0.00,save_score:0.00},
  CM:{match_impact:0.20,influence:0.15,creativity:0.15,threat:0.10,defensive:0.05,goal_involvement:0.10,finishing:0.00,save_score:0.00},
  LWB:{match_impact:0.25,influence:0.05,creativity:0.15,threat:0.05,defensive:0.15,goal_involvement:0.10,finishing:0.00,save_score:0.00},
  RWB:{match_impact:0.25,influence:0.05,creativity:0.15,threat:0.05,defensive:0.15,goal_involvement:0.10,finishing:0.00,save_score:0.00},
  AM:{match_impact:0.10,influence:0.10,creativity:0.25,threat:0.15,defensive:0.00,goal_involvement:0.15,finishing:0.00,save_score:0.00},
  LW:{match_impact:0.15,influence:0.05,creativity:0.05,threat:0.10,defensive:0.00,goal_involvement:0.15,finishing:0.25,save_score:0.00},
  RW:{match_impact:0.15,influence:0.05,creativity:0.05,threat:0.10,defensive:0.00,goal_involvement:0.15,finishing:0.25,save_score:0.00},
  ST:{match_impact:0.15,influence:0.10,creativity:0.10,threat:0.15,defensive:0.00,goal_involvement:0.15,finishing:0.10,save_score:0.00},
};
const GI_SD = 2.5, GI_MED = 0, FIN_SD = 0.28, FIN_MED = -0.03;

const posGroup = (p) => p==='GK'?'GK':['CB','LB','RB','LWB','RWB'].includes(p)?'DEF':['DM','CM','AM'].includes(p)?'MID':'ATT';
const sigmoid = (v, med, sd) => sd <= 0 ? 0.5 : 1/(1+Math.exp(-((v-med)/sd)));

function rawInputs(s, pos) {
  const mins = s.minutes_played ?? 0;
  const goals = s.goals ?? 0, assists = s.assists ?? 0;
  const adjBps = Math.max(0, (s.bps ?? 0) - goals*12 - assists*9);
  const gc = s.goals_conceded ?? 0, xgc = s.expected_goals_conceded ?? 0;
  const tackles = Math.max(0, s.fpl_tackles ?? 0), cbi = Math.max(0, s.fpl_cbi ?? 0), rec = Math.max(0, s.fpl_recoveries ?? 0);
  let defActions;
  if (pos==='GK') defActions = rec*0.5 + cbi*0.5;
  else if (pos==='CB') defActions = tackles + cbi*0.5;
  else defActions = (tackles+cbi) + rec*0.5;
  let csBonus = 0;
  if (s.clean_sheet && mins >= 60) {
    const pg = posGroup(pos);
    if (pos==='GK') csBonus = 16; else if (pg==='DEF'||pos==='DM') csBonus = 12; else if (pos==='CM') csBonus = 4;
  }
  const defMods = pos==='GK' ? csBonus - gc*4.0 : csBonus + Math.max(0,xgc-gc)*5 - Math.max(0,gc-xgc)*5;
  const xg = s.expected_goals ?? 0, xa = s.expected_assists ?? 0;
  return {
    match_impact: adjBps, influence: s.influence ?? 0, creativity: s.creativity ?? 0, threat: s.threat ?? 0,
    defensive: defActions + defMods,
    goal_involvement: goals*6 + assists*4,
    finishing: (goals-xg) + (assists-xa)*0.5,
    save_score: pos==='GK' ? (s.saves??0)*2 + (s.penalty_saves??0)*5 : 0,
    mins, cleanSheet: !!s.clean_sheet,
  };
}

function composite(sc, pos) {
  const w = POSITION_WEIGHTS[pos], fc = FLEX_CONFIG[pos];
  let best=-1, bestK='';
  for (const k of fc.components) if (sc[k] > best) { best = sc[k]; bestK = k; }
  let c = 0;
  for (const k of Object.keys(w)) { let fw = w[k]; if (k===bestK) fw += fc.flex; if (fw===0) continue; c += sc[k]*fw; }
  return Math.min(1, c);
}
const disp = (c,m) => (c<0||m===0)?0:Math.max(1,Math.min(10, 3.5+6.0*c));
const pts  = (c,m) => { if(m===0) return 0; const r=Math.max(1,Math.min(10,1+9*c));
  return Math.max(0, Number((10*Math.pow(Math.max(0,r-4.5)/2.0,1.5)).toFixed(2))); };
const median=(a)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const mean=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const pct=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};

const RATE = ['match_impact','influence','creativity','threat','defensive','save_score'];
// Anchor knot sits at the LOWER edge of the full-exposure bin so that f(m)=1
// for every m >= 75 — not just at exactly 90.
const KNOTS = [5, 16, 27, 39, 52, 67, 75];
const EDGES = [[1,9],[10,22],[23,32],[33,44],[45,59],[60,74],[75,90]];
const ANCHOR = EDGES.length - 1;
const poolKey = (p) => ['LB','RB','LWB','RWB'].includes(p) ? 'WIDE_DEF' : ['LW','RW'].includes(p) ? 'WING' : p;

/**
 * Two SEPARATE exposure curves per component, both == 1 at the anchor:
 *   fmu(m) = mean_data(m) / mean_data(75-90)   — centre falls ~linearly with exposure
 *   fsd(m) = sd_data(m)   / sd_data(75-90)     — spread falls MORE SLOWLY (~sqrt)
 * Scaling both by one factor makes the z-score of a zero-output player
 * invariant ((0-mu*f)/(sd*f) = -mu/sd), i.e. a no-op for exactly the cases
 * that motivated this. They must be modelled separately.
 */
function buildExposureCurves(samples) {
  const groups = new Map();
  for (const s of samples) {
    const k = poolKey(s.pos);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const sd = (a) => { if (a.length < 2) return 0; const mu = mean(a);
    return Math.sqrt(a.reduce((t,x)=>t+(x-mu)**2,0)/a.length); };
  const out = new Map();
  for (const [k, arr] of groups) {
    const tbl = {};
    for (const comp of RATE) {
      const vals = EDGES.map(([lo,hi]) => arr.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi).map(s=>s.inp[comp]));
      const mus = vals.map(mean), sds = vals.map(sd);
      const aMu = mus[ANCHOR], aSd = sds[ANCHOR];
      tbl[comp] = {
        fmu: mus.map((v,i) => i===ANCHOR ? 1
          : Math.abs(aMu) > 1e-6 ? Math.min(1.2, Math.max(0.02, v/aMu)) : Math.min(1, KNOTS[i]/90)),
        fsd: sds.map((v,i) => i===ANCHOR ? 1
          : aSd > 1e-6 ? Math.min(1.2, Math.max(0.05, v/aSd)) : Math.min(1, Math.sqrt(KNOTS[i]/90))),
      };
    }
    out.set(k, tbl);
  }
  return out;
}

function fAt(curves, pos, comp, mins) {
  const tbl = curves.get(poolKey(pos));
  if (!tbl || !tbl[comp]) return { fmu: 1, fsd: 1 };
  const { fmu, fsd } = tbl[comp];
  if (mins >= KNOTS[ANCHOR]) return { fmu: 1, fsd: 1 };
  if (mins <= KNOTS[0]) return { fmu: fmu[0], fsd: fsd[0] };
  for (let i=0;i<KNOTS.length-1;i++) {
    if (mins>=KNOTS[i] && mins<=KNOTS[i+1]) {
      const t=(mins-KNOTS[i])/(KNOTS[i+1]-KNOTS[i]);
      return { fmu: fmu[i]+t*(fmu[i+1]-fmu[i]), fsd: fsd[i]+t*(fsd[i+1]-fsd[i]) };
    }
  }
  return { fmu: 1, fsd: 1 };
}

function scoreCurrent(inp, pos, ref) {
  const r = ref[pos] || ref.CM;
  const sc = {
    match_impact: sigmoid(inp.match_impact, r.match_impact.median, r.match_impact.stddev),
    influence: sigmoid(inp.influence, r.influence.median, r.influence.stddev),
    creativity: sigmoid(inp.creativity, r.creativity.median, r.creativity.stddev),
    threat: sigmoid(inp.threat, r.threat.median, r.threat.stddev),
    defensive: sigmoid(inp.defensive, r.defensive.median, r.defensive.stddev),
    goal_involvement: sigmoid(inp.goal_involvement, GI_MED, GI_SD),
    finishing: sigmoid(inp.finishing, FIN_MED, FIN_SD),
    save_score: pos==='GK' ? (inp.cleanSheet && inp.mins>=60
      ? Math.max(sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev), 0.85)
      : sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev)) : 0.5,
  };
  return composite(sc, pos);
}

function scoreAnchored(inp, pos, ref, curves) {
  const r = ref[pos] || ref.CM;
  const S = (comp) => {
    const { fmu, fsd } = fAt(curves, pos, comp, inp.mins);
    return sigmoid(inp[comp], r[comp].median * fmu, r[comp].stddev * fsd);
  };
  const sc = {
    match_impact: S('match_impact'), influence: S('influence'),
    creativity: S('creativity'), threat: S('threat'), defensive: S('defensive'),
    goal_involvement: sigmoid(inp.goal_involvement, GI_MED, GI_SD),
    finishing: sigmoid(inp.finishing, FIN_MED, FIN_SD),
    save_score: pos==='GK' ? (inp.cleanSheet && inp.mins>=60 ? Math.max(S('save_score'),0.85) : S('save_score')) : 0.5,
  };
  return composite(sc, pos);
}

const BUCKETS=[['1-9',1,9],['10-24',10,24],['25-44',25,44],['45-59',45,59],['60-74',60,74],['75-90',75,90]];

async function main() {
  const players = new Map();
  for (let f=0;;f+=1000){const{data,error}=await supabase.from('players').select('id,name,primary_position').range(f,f+999);
    if(error)throw error; for(const p of data) players.set(p.id,p); if(data.length<1000)break;}
  const rows=[];
  for (let f=0;;f+=1000){const{data,error}=await supabase.from('player_stats')
    .select('player_id,gameweek,stats,match_rating').eq('season',SEASON).range(f,f+999);
    if(error)throw error; rows.push(...data); if(data.length<1000)break;}
  const {data:refRows}=await supabase.from('rating_reference_stats').select('*').eq('season',SEASON);
  const ref={};
  for(const r of refRows)(ref[r.position_group]??={})[r.component]={median:Number(r.median),stddev:Number(r.stddev)};

  const samples=[];
  for(const r of rows){
    const p=players.get(r.player_id); if(!p||!POSITIONS.includes(p.primary_position))continue;
    const s=r.stats||{}; if((s.minutes_played??0)<=0)continue;
    samples.push({pos:p.primary_position,name:p.name,gw:r.gameweek,inp:rawInputs(s,p.primary_position),stored:Number(r.match_rating)});
  }
  let sum=0,n=0,ok=0;
  for(const s of samples){const d=Math.abs(disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins)-s.stored);sum+=d;n++;if(d<=0.1)ok++;}
  console.log(`${samples.length} appearances | VALIDATION mean abs diff ${(sum/n).toFixed(4)} | within 0.10 ${(100*ok/n).toFixed(1)}%\n`);

  const curves = buildExposureCurves(samples);

  console.log('=== f(m): fraction of the full-exposure bar reachable in m minutes ===');
  console.log('pool        comp            ' + KNOTS.map(k=>String(k+'m').padStart(7)).join(''));
  for (const pk of ['DM','CM','CB','ST']) {
    for (const c of ['match_impact','influence']) {
      const t = curves.get(pk); if(!t) continue;
      console.log(pk.padEnd(12) + (c+' mu').padEnd(19) + t[c].fmu.map(v=>v.toFixed(2).padStart(7)).join(''));
      console.log(''.padEnd(12) + (c+' sd').padEnd(19) + t[c].fsd.map(v=>v.toFixed(2).padStart(7)).join(''));
    }
  }

  // ---- emit the constants a real implementation would need ----
  if (process.env.EMIT) {
    const COMPS = ['match_impact','influence','creativity','threat','defensive','save_score'];
    let out = '';
    out += '/** Fraction of the full-exposure baseline reachable in N minutes.\n';
    out += ' *  Derived from 2025-26 FPL data by scratch/anchored_test.mjs.\n';
    out += ' *  fmu scales the median, fsd scales the stddev. Both are 1.0 at >=75 min,\n';
    out += ' *  so every full-match rating is unchanged by construction. */\n';
    out += 'export const EXPOSURE_KNOTS = [' + KNOTS.join(', ') + '] as const;\n\n';
    out += 'export const EXPOSURE_CURVES: Record<string, Record<string, { fmu: number[]; fsd: number[] }>> = {\n';
    for (const [pool, tbl] of [...curves.entries()].sort()) {
      out += '  ' + pool + ': {\n';
      for (const c of COMPS) {
        if (!tbl[c]) continue;
        out += '    ' + c + ': { fmu: [' + tbl[c].fmu.map(v=>v.toFixed(3)).join(', ') +
               '], fsd: [' + tbl[c].fsd.map(v=>v.toFixed(3)).join(', ') + '] },\n';
      }
      out += '  },\n';
    }
    out += '};\n';
    require('node:fs').writeFileSync('scratch/exposureCurves.generated.ts', out);
    console.log('wrote scratch/exposureCurves.generated.ts');
  }

  console.log('\n=== BLAST RADIUS: full-90 must be bit-identical ===');
  const long = samples.filter(s=>s.inp.mins>=75);
  const maxLong = Math.max(...long.map(s=>Math.abs(
    disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins) - disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins))));
  const changed = samples.filter(s=>Math.abs(
    disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins)-disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins))>0.005);
  console.log(`appearances >=75 min: ${long.length}  max |rating change| = ${maxLong.toFixed(6)}`);
  console.log(`appearances changed at all: ${changed.length}/${samples.length} (${(100*changed.length/samples.length).toFixed(1)}%) — all under 75 min`);

  console.log('\n=== RATING & POINTS BY BUCKET ===');
  console.log('bucket    n      cur med  new med  |  cur p99  new p99  |  cur pts  new pts');
  for (const [b,lo,hi] of BUCKETS) {
    const g=samples.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi);
    const cr=g.map(s=>disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins));
    const nr=g.map(s=>disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins));
    const cp=g.map(s=>pts(scoreCurrent(s.inp,s.pos,ref),s.inp.mins));
    const np=g.map(s=>pts(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins));
    console.log(b.padEnd(9)+String(g.length).padEnd(7)+median(cr).toFixed(2).padStart(8)+median(nr).toFixed(2).padStart(9)+
      '  |'+pct(cr,0.99).toFixed(2).padStart(9)+pct(nr,0.99).toFixed(2).padStart(9)+
      '  |'+median(cp).toFixed(2).padStart(9)+median(np).toFixed(2).padStart(9));
  }

  console.log('\n=== WITHIN-PLAYER SHORT(10-35) vs LONG(75+) GAP ===');
  const byP=new Map();
  for(const s of samples){if(!byP.has(s.name))byP.set(s.name,[]);byP.get(s.name).push(s);}
  const gap=(f)=>{const g=[];for(const[,arr]of byP){
    const sh=arr.filter(s=>s.inp.mins>=10&&s.inp.mins<=35),lo=arr.filter(s=>s.inp.mins>=75);
    if(sh.length<3||lo.length<3)continue;
    const av=(x)=>x.reduce((t,s)=>t+f(s),0)/x.length; g.push(av(lo)-av(sh));}
    return g.reduce((x,y)=>x+y,0)/g.length;};
  console.log(`current  : ${gap(s=>disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins)).toFixed(3)}`);
  console.log(`anchored : ${gap(s=>disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins)).toFixed(3)}`);

  console.log('\n=== CAMEO SANITY (mins <= 20) ===');
  const cam=samples.filter(s=>s.inp.mins<=20);
  const cr=cam.map(s=>disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins));
  const nr=cam.map(s=>disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins));
  const ab=(a,t)=>`${(100*a.filter(x=>x>t).length/a.length).toFixed(1)}%`;
  console.log(`n=${cam.length}  median ${median(cr).toFixed(2)} -> ${median(nr).toFixed(2)}  | >8.0: ${ab(cr,8)} -> ${ab(nr,8)}  | >8.5: ${ab(cr,8.5)} -> ${ab(nr,8.5)}`);
  const noEvent = cam.filter(s=>s.inp.goal_involvement===0);
  console.log(`cameos with NO goal/assist (n=${noEvent.length}): median ${median(noEvent.map(s=>disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins))).toFixed(2)} -> ${median(noEvent.map(s=>disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins))).toFixed(2)}, p99 ${pct(noEvent.map(s=>disp(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins)),0.99).toFixed(2)}`);

  console.log('\n=== SEASON TOTALS: top-30 stability ===');
  const tot=new Map();
  for(const s of samples){
    if(!tot.has(s.name))tot.set(s.name,{cur:0,nw:0});
    const t=tot.get(s.name);
    t.cur+=pts(scoreCurrent(s.inp,s.pos,ref),s.inp.mins);
    t.nw+=pts(scoreAnchored(s.inp,s.pos,ref,curves),s.inp.mins);
  }
  const arr=[...tot.entries()].map(([name,t])=>({name,...t}));
  const rc=[...arr].sort((a,b)=>b.cur-a.cur).map(x=>x.name);
  const rn=[...arr].sort((a,b)=>b.nw-a.nw).map(x=>x.name);
  console.log(`top-10 overlap ${rn.slice(0,10).filter(n=>new Set(rc.slice(0,10)).has(n)).length}/10 | top-30 ${rn.slice(0,30).filter(n=>new Set(rc.slice(0,30)).has(n)).length}/30 | top-50 ${rn.slice(0,50).filter(n=>new Set(rc.slice(0,50)).has(n)).length}/50`);
  console.log('biggest season-total risers:');
  const movers=arr.map(x=>({...x,d:x.nw-x.cur})).sort((a,b)=>b.d-a.d).slice(0,8);
  for(const m of movers) console.log(`  ${m.name.slice(0,24).padEnd(26)} ${m.cur.toFixed(0).padStart(5)} -> ${m.nw.toFixed(0).padStart(5)}  (+${m.d.toFixed(0)})`);

  // ── Is mu(m) measuring OPPORTUNITY, or is it partly SELECTION? ────────────
  // A player hooked at 60 is often having a bad game. If so, conditioning on
  // minutes partly conditions on performance, and over-credits him.
  console.log('\n=== SELECTION-EFFECT CHECK (within-player, per-minute BPS) ===');
  const bands = [[10,35],[36,59],[60,74],[75,90]];
  const perMin = bands.map(() => []);
  for (const [, arr] of byP) {
    const longs = arr.filter(s=>s.inp.mins>=75);
    if (longs.length < 3) continue;
    const ref90 = mean(longs.map(s=>s.inp.match_impact/s.inp.mins));
    if (!(ref90 > 0)) continue;
    bands.forEach(([lo,hi], i) => {
      const g = arr.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi);
      if (g.length < 2) return;
      perMin[i].push(mean(g.map(s=>s.inp.match_impact/s.inp.mins)) / ref90);
    });
  }
  console.log('band       n     BPS/min relative to same player\'s own 75+ games');
  bands.forEach(([lo,hi], i) => {
    console.log(`${(lo+'-'+hi).padEnd(10)} ${String(perMin[i].length).padEnd(5)} ${median(perMin[i]).toFixed(3)}`);
  });
  console.log('(>1 = more productive per minute than his own full games; <1 = genuinely worse)');

  // ── lambda: how much of the exposure correction to apply ──────────────────
  // f_used(m) = 1 - lambda*(1 - f(m)).  lambda=0 is today's engine exactly,
  // lambda=1 is full conditioning. Full-90 stays bit-identical for ANY lambda.
  console.log('\n=== LAMBDA SWEEP: partial exposure correction ===');
  const LAM = [0, 0.25, 0.5, 0.75, 1.0];
  const scoreLam = (inp, pos, lam) => {
    const r = ref[pos] || ref.CM;
    const S = (comp) => {
      const { fmu, fsd } = fAt(curves, pos, comp, inp.mins);
      const mu = 1 - lam * (1 - fmu), sg = 1 - lam * (1 - fsd);
      return sigmoid(inp[comp], r[comp].median*mu, r[comp].stddev*sg);
    };
    return composite({
      match_impact:S('match_impact'), influence:S('influence'), creativity:S('creativity'),
      threat:S('threat'), defensive:S('defensive'),
      goal_involvement:sigmoid(inp.goal_involvement,GI_MED,GI_SD),
      finishing:sigmoid(inp.finishing,FIN_MED,FIN_SD),
      save_score: pos==='GK' ? (inp.cleanSheet&&inp.mins>=60?Math.max(S('save_score'),0.85):S('save_score')) : 0.5,
    }, pos);
  };
  console.log('MEDIAN RATING');
  console.log('bucket   ' + LAM.map(l=>`  L=${l}`.padStart(8)).join(''));
  for (const [b,lo,hi] of BUCKETS) {
    const g = samples.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi);
    console.log(b.padEnd(9) + LAM.map(l=>median(g.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(8)).join(''));
  }
  console.log('MEDIAN POINTS');
  console.log('bucket   ' + LAM.map(l=>`  L=${l}`.padStart(8)).join(''));
  for (const [b,lo,hi] of BUCKETS) {
    const g = samples.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi);
    console.log(b.padEnd(9) + LAM.map(l=>median(g.map(s=>pts(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(8)).join(''));
  }
  console.log('SEASON-TOTAL DISRUPTION');
  for (const l of LAM) {
    const t2 = new Map();
    for (const s of samples) t2.set(s.name, (t2.get(s.name)||0) + pts(scoreLam(s.inp,s.pos,l), s.inp.mins));
    const r2 = [...t2.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    const ov = r2.slice(0,30).filter(n=>new Set(rc.slice(0,30)).has(n)).length;
    const maxRise = Math.max(...[...t2.entries()].map(([n,v]) => v - (tot.get(n)?.cur ?? 0)));
    console.log(`  L=${l}  top-30 overlap ${ov}/30  |  biggest season-total rise +${maxRise.toFixed(0)} pts`);
  }

  // ── THE ACTUAL ASK ────────────────────────────────────────────────────────
  // "cameos shouldn't sit sub-5.0 unless they played terribly, and they must
  //  NOT score like regular-minute players."
  const bal_=samples.filter(s=>s.name?.toLowerCase().includes('baleba')).sort((a,b)=>a.gw-b.gw);
  console.log('\n\n########## TARGETED: SMALL CORRECTION ONLY ##########');
  const LOW = [0, 0.2, 0.3, 0.4, 0.5];
  const shortApps = samples.filter(s=>s.inp.mins<=35);
  const starters  = samples.filter(s=>s.inp.mins>=75);

  console.log('\n1) Does it lift cameos off the floor?  (appearances <= 35 min, n=' + shortApps.length + ')');
  console.log('lambda   med rating   %<5.0   %<5.5   min rating');
  for (const l of LOW) {
    const r = shortApps.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins));
    console.log(`${String(l).padEnd(9)}${median(r).toFixed(2).padStart(10)}` +
      `${(100*r.filter(x=>x<5).length/r.length).toFixed(1).padStart(8)}%` +
      `${(100*r.filter(x=>x<5.5).length/r.length).toFixed(1).padStart(7)}%` +
      `${Math.min(...r).toFixed(2).padStart(12)}`);
  }

  console.log('\n2) Do cameos still score FAR less than starters? (median points)');
  console.log('lambda   1-9    10-24   25-44   45-59   60-74   75-90(starter)');
  for (const l of LOW) {
    let line = String(l).padEnd(9);
    for (const [b,lo,hi] of BUCKETS) {
      const g = samples.filter(s=>s.inp.mins>=lo&&s.inp.mins<=hi);
      line += median(g.map(s=>pts(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(8);
    }
    console.log(line);
  }

  console.log('\n3) Do genuinely bad cameos STAY bad?');
  // "played terribly" = card, own goal, or bottom-quartile match impact for the exposure
  const badCameos = shortApps.filter(s => s.inp.match_impact <= 1 && s.inp.goal_involvement === 0);
  const okCameos  = shortApps.filter(s => s.inp.match_impact >= 6 && s.inp.goal_involvement === 0);
  console.log(`   terrible cameos (adjBPS<=1, no G/A, n=${badCameos.length}) vs solid-but-quiet (adjBPS>=6, no G/A, n=${okCameos.length})`);
  console.log('lambda   terrible med   solid med   separation');
  for (const l of LOW) {
    const b = median(badCameos.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins)));
    const o = median(okCameos.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins)));
    console.log(`${String(l).padEnd(9)}${b.toFixed(2).padStart(13)}${o.toFixed(2).padStart(12)}${(o-b).toFixed(2).padStart(13)}`);
  }

  console.log('\n4) Season-level disruption');
  console.log('lambda   top-10   top-30   top-50   biggest riser   starters affected');
  for (const l of LOW) {
    const t2=new Map();
    for(const s of samples) t2.set(s.name,(t2.get(s.name)||0)+pts(scoreLam(s.inp,s.pos,l),s.inp.mins));
    const r2=[...t2.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    const ov=(k)=>r2.slice(0,k).filter(n=>new Set(rc.slice(0,k)).has(n)).length;
    const maxRise=Math.max(...[...t2.entries()].map(([n,v])=>v-(tot.get(n)?.cur??0)));
    const stChanged = starters.filter(s=>Math.abs(disp(scoreLam(s.inp,s.pos,l),s.inp.mins)-disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins))>0.001).length;
    console.log(`${String(l).padEnd(9)}${(ov(10)+'/10').padStart(8)}${(ov(30)+'/30').padStart(9)}${(ov(50)+'/50').padStart(9)}${('+'+maxRise.toFixed(0)).padStart(16)}${String(stChanged).padStart(19)}`);
  }

  const LS = [0, 0.3, 0.5, 0.7, 1.0];
  console.log('\n5) BALEBA 2025-26 — full season across lambda (rating / points)');
  console.log('GW  mins  ' + LS.map(l=>('L='+l).padStart(13)).join(''));
  for (const s of bal_) {
    let line = String(s.gw).padStart(2) + String(s.inp.mins).padStart(6) + '  ';
    for (const l of LS) {
      const c = scoreLam(s.inp, s.pos, l);
      line += `${disp(c,s.inp.mins).toFixed(2)}/${pts(c,s.inp.mins).toFixed(1).padStart(5)}`.padStart(13);
    }
    console.log(line + (s.inp.mins>=75 ? '   <- unchanged by design' : ''));
  }
  console.log('\n   Baleba summary');
  const shortB = bal_.filter(s=>s.inp.mins<60), longB = bal_.filter(s=>s.inp.mins>=75);
  console.log('   metric                 ' + LS.map(l=>('L='+l).padStart(10)).join(''));
  console.log('   avg rating <60min      ' + LS.map(l=>mean(shortB.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(10)).join(''));
  console.log('   worst rating <60min    ' + LS.map(l=>Math.min(...shortB.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(10)).join(''));
  console.log('   # games rated <5.0     ' + LS.map(l=>String(bal_.filter(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins)<5).length).padStart(10)).join(''));
  console.log('   avg rating 75+min      ' + LS.map(l=>mean(longB.map(s=>disp(scoreLam(s.inp,s.pos,l),s.inp.mins))).toFixed(2).padStart(10)).join(''));
  console.log('   season points          ' + LS.map(l=>bal_.reduce((t,s)=>t+pts(scoreLam(s.inp,s.pos,l),s.inp.mins),0).toFixed(0).padStart(10)).join(''));

  console.log('\n6) WHAT IT COSTS at each lambda (league-wide guardrails)');
  console.log('   metric                 ' + LS.map(l=>('L='+l).padStart(10)).join(''));
  const gp=(lo,hi,l)=>median(samples.filter(x=>x.inp.mins>=lo&&x.inp.mins<=hi).map(x=>pts(scoreLam(x.inp,x.pos,l),x.inp.mins)));
  console.log('   median pts 25-44min    ' + LS.map(l=>gp(25,44,l).toFixed(2).padStart(10)).join(''));
  console.log('   median pts 75-90min    ' + LS.map(l=>gp(75,90,l).toFixed(2).padStart(10)).join(''));
  console.log('   sub:starter pts ratio  ' + LS.map(l=>(gp(25,44,l)/gp(75,90,l)).toFixed(2).padStart(10)).join(''));
  console.log('   % cameos(<=35) <5.0    ' + LS.map(l=>{const r=samples.filter(x=>x.inp.mins<=35).map(x=>disp(scoreLam(x.inp,x.pos,l),x.inp.mins));
    return ((100*r.filter(v=>v<5).length/r.length).toFixed(1)+'%').padStart(10);}).join(''));
  console.log('   starters changed       ' + LS.map(l=>String(starters.filter(x=>Math.abs(disp(scoreLam(x.inp,x.pos,l),x.inp.mins)-disp(scoreCurrent(x.inp,x.pos,ref),x.inp.mins))>0.001).length).padStart(10)).join(''));
  console.log('   top-30 season overlap  ' + LS.map(l=>{const t2=new Map();
    for(const x of samples) t2.set(x.name,(t2.get(x.name)||0)+pts(scoreLam(x.inp,x.pos,l),x.inp.mins));
    const r2=[...t2.entries()].sort((a,b)=>b[1]-a[1]).map(z=>z[0]);
    return (r2.slice(0,30).filter(n=>new Set(rc.slice(0,30)).has(n)).length+'/30').padStart(10);}).join(''));
  console.log('   biggest season riser   ' + LS.map(l=>{const t2=new Map();
    for(const x of samples) t2.set(x.name,(t2.get(x.name)||0)+pts(scoreLam(x.inp,x.pos,l),x.inp.mins));
    return ('+'+Math.max(...[...t2.entries()].map(([n,v])=>v-(tot.get(n)?.cur??0))).toFixed(0)).padStart(10);}).join(''));

  console.log('\n=== BALEBA 2025-26 (full lambda=1 for reference) ===');
  const bal=samples.filter(s=>s.name?.toLowerCase().includes('baleba')).sort((a,b)=>a.gw-b.gw);
  console.log('GW  mins   current      anchored');
  for(const s of bal){
    const c1=scoreCurrent(s.inp,s.pos,ref),c2=scoreAnchored(s.inp,s.pos,ref,curves);
    const mark = s.inp.mins>=75 ? '  (unchanged)' : '';
    console.log(`${String(s.gw).padStart(2)}  ${String(s.inp.mins).padStart(4)}  ${disp(c1,s.inp.mins).toFixed(2)}/${pts(c1,s.inp.mins).toFixed(1).padStart(5)}  ${disp(c2,s.inp.mins).toFixed(2)}/${pts(c2,s.inp.mins).toFixed(1).padStart(5)}${mark}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});

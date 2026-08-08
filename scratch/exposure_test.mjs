/**
 * Exposure-conditioned baseline test.
 *
 * Hypothesis: the scoring engine's defect is that it compares a match total
 * against a CONSTANT baseline, when the baseline should be a FUNCTION of the
 * minutes played:  z = (observed - mu(mins)) / sigma(mins).
 *
 * Rate components (bps/influence/creativity/threat/defensive actions/saves)
 * get exposure-conditioned baselines. Event components (goal_involvement,
 * finishing) stay absolute - a goal is a goal regardless of minutes.
 *
 * Validation gate: 'current' mode must reproduce stored match_rating.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
const GLOBAL_GI_STDDEV = 2.5, GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FIN_STDDEV = 0.28, GLOBAL_FIN_MEDIAN = -0.03;

const posGroup = (p) => p === 'GK' ? 'GK'
  : ['CB','LB','RB','LWB','RWB'].includes(p) ? 'DEF'
  : ['DM','CM','AM'].includes(p) ? 'MID' : 'ATT';
const sigmoid = (v, med, sd) => sd <= 0 ? 0.5 : 1 / (1 + Math.exp(-((v - med) / sd)));

function rawInputs(s, pos) {
  const mins = s.minutes_played ?? 0;
  const goals = s.goals ?? 0, assists = s.assists ?? 0;
  const adjBps = Math.max(0, (s.bps ?? 0) - goals * 12 - assists * 9);
  const gc = s.goals_conceded ?? 0, xgc = s.expected_goals_conceded ?? 0;
  const tackles = Math.max(0, s.fpl_tackles ?? 0);
  const cbi = Math.max(0, s.fpl_cbi ?? 0);
  const rec = Math.max(0, s.fpl_recoveries ?? 0);
  let defActions;
  if (pos === 'GK') defActions = rec * 0.5 + cbi * 0.5;
  else if (pos === 'CB') defActions = tackles + cbi * 0.5;
  else defActions = (tackles + cbi) + rec * 0.5;
  let csBonus = 0;
  if (s.clean_sheet && mins >= 60) {
    const pg = posGroup(pos);
    if (pos === 'GK') csBonus = 16;
    else if (pg === 'DEF' || pos === 'DM') csBonus = 12;
    else if (pos === 'CM') csBonus = 4;
  }
  const defMods = pos === 'GK' ? csBonus - gc * 4.0
    : csBonus + Math.max(0, xgc - gc) * 5 - Math.max(0, gc - xgc) * 5;
  const xg = s.expected_goals ?? 0, xa = s.expected_assists ?? 0;
  return {
    match_impact: adjBps,
    influence: s.influence ?? 0,
    creativity: s.creativity ?? 0,
    threat: s.threat ?? 0,
    defensive: defActions + defMods,
    goal_involvement: goals * 6 + assists * 4,
    finishing: (goals - xg) + (assists - xa) * 0.5,
    save_score: pos === 'GK' ? (s.saves ?? 0) * 2 + (s.penalty_saves ?? 0) * 5 : 0,
    mins, cleanSheet: !!s.clean_sheet,
  };
}

function composite(scores, pos) {
  const w = POSITION_WEIGHTS[pos], fc = FLEX_CONFIG[pos];
  let best = -1, bestK = '';
  for (const k of fc.components) if (scores[k] > best) { best = scores[k]; bestK = k; }
  let c = 0;
  for (const k of Object.keys(w)) {
    let fw = w[k]; if (k === bestK) fw += fc.flex;
    if (fw === 0) continue;
    c += scores[k] * fw;
  }
  return Math.min(1, c);
}
const disp = (c, mins) => (c < 0 || mins === 0) ? 0 : Math.max(1, Math.min(10, 3.5 + 6.0 * c));
const pts = (c, mins) => {
  if (mins === 0) return 0;
  const r = Math.max(1, Math.min(10, 1 + 9 * c));
  return Math.max(0, Number((10 * Math.pow(Math.max(0, r - 4.5) / 2.0, 1.5)).toFixed(2)));
};
const median = (a) => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
const pstdev = (a) => { if (a.length<2) return 1; const mu=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((s,x)=>s+(x-mu)**2,0)/a.length); return sd<0.001?1:sd; };
const pct = (a,p) => { if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y);
  return s[Math.min(s.length-1, Math.floor(p*s.length))]; };

// ── exposure-conditioned baselines ───────────────────────────────────────────
// Non-parametric: bin by minutes, take median + spread per bin, interpolate.
const RATE_COMPONENTS = ['match_impact','influence','creativity','threat','defensive','save_score'];
const KNOTS = [5, 17, 27, 37, 52, 67, 83];   // bin centres in minutes
const EDGES = [[1,9],[10,22],[23,32],[33,44],[45,59],[60,74],[75,90]];

// Pool sparse positions, mirroring recompute_reference_stats.mjs conventions
function poolKey(pos) {
  if (['LB','RB','LWB','RWB'].includes(pos)) return 'WIDE_DEF';
  if (['LW','RW'].includes(pos)) return 'WING';
  return pos;
}

function buildExposureBaselines(samples) {
  const groups = new Map();
  for (const s of samples) {
    const k = poolKey(s.pos);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = new Map();
  for (const [k, arr] of groups) {
    const tbl = {};
    for (const comp of RATE_COMPONENTS) {
      tbl[comp] = EDGES.map(([lo, hi]) => {
        const vals = arr.filter(s => s.inp.mins >= lo && s.inp.mins <= hi).map(s => s.inp[comp]);
        return { median: median(vals), stddev: pstdev(vals), n: vals.length };
      });
    }
    out.set(k, tbl);
  }
  return out;
}

/** Linear interpolation of (median, stddev) across the minute knots. */
function baselineAt(tbl, comp, mins) {
  const pts_ = tbl[comp];
  if (mins <= KNOTS[0]) return pts_[0];
  if (mins >= KNOTS[KNOTS.length - 1]) return pts_[pts_.length - 1];
  for (let i = 0; i < KNOTS.length - 1; i++) {
    if (mins >= KNOTS[i] && mins <= KNOTS[i + 1]) {
      const t = (mins - KNOTS[i]) / (KNOTS[i + 1] - KNOTS[i]);
      return {
        median: pts_[i].median + t * (pts_[i + 1].median - pts_[i].median),
        stddev: pts_[i].stddev + t * (pts_[i + 1].stddev - pts_[i].stddev),
      };
    }
  }
  return pts_[pts_.length - 1];
}

function scoreCurrent(inp, pos, ref) {
  const r = ref[pos] || ref.CM;
  const sc = {
    match_impact: sigmoid(inp.match_impact, r.match_impact.median, r.match_impact.stddev),
    influence: sigmoid(inp.influence, r.influence.median, r.influence.stddev),
    creativity: sigmoid(inp.creativity, r.creativity.median, r.creativity.stddev),
    threat: sigmoid(inp.threat, r.threat.median, r.threat.stddev),
    defensive: sigmoid(inp.defensive, r.defensive.median, r.defensive.stddev),
    goal_involvement: sigmoid(inp.goal_involvement, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
    finishing: sigmoid(inp.finishing, GLOBAL_FIN_MEDIAN, GLOBAL_FIN_STDDEV),
    save_score: pos === 'GK'
      ? (inp.cleanSheet && inp.mins >= 60
         ? Math.max(sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev), 0.85)
         : sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev))
      : 0.5,
  };
  return composite(sc, pos);
}

function scoreExposure(inp, pos, baselines) {
  const tbl = baselines.get(poolKey(pos));
  const S = (comp) => {
    const b = baselineAt(tbl, comp, inp.mins);
    return sigmoid(inp[comp], b.median, b.stddev);
  };
  const sc = {
    match_impact: S('match_impact'),
    influence: S('influence'),
    creativity: S('creativity'),
    threat: S('threat'),
    defensive: S('defensive'),
    goal_involvement: sigmoid(inp.goal_involvement, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
    finishing: sigmoid(inp.finishing, GLOBAL_FIN_MEDIAN, GLOBAL_FIN_STDDEV),
    save_score: pos === 'GK'
      ? (inp.cleanSheet && inp.mins >= 60 ? Math.max(S('save_score'), 0.85) : S('save_score'))
      : 0.5,
  };
  return composite(sc, pos);
}

const BUCKETS = [['1-9',1,9],['10-24',10,24],['25-44',25,44],['45-59',45,59],['60-74',60,74],['75-90',75,90]];

async function main() {
  const players = new Map();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('players').select('id,name,primary_position').range(f, f+999);
    if (error) throw error;
    for (const p of data) players.set(p.id, p);
    if (data.length < 1000) break;
  }
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('player_stats')
      .select('player_id,gameweek,stats,match_rating,fantasy_points').eq('season', SEASON).range(f, f+999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const { data: refRows } = await supabase.from('rating_reference_stats').select('*').eq('season', SEASON);
  const ref = {};
  for (const r of refRows) {
    (ref[r.position_group] ??= {})[r.component] = { median: Number(r.median), stddev: Number(r.stddev) };
  }

  const samples = [];
  for (const r of rows) {
    const p = players.get(r.player_id);
    if (!p || !POSITIONS.includes(p.primary_position)) continue;
    const s = r.stats || {};
    if ((s.minutes_played ?? 0) <= 0) continue;
    samples.push({ pos: p.primary_position, name: p.name, gw: r.gameweek,
      inp: rawInputs(s, p.primary_position), storedRating: Number(r.match_rating) });
  }
  console.log(`${samples.length} appearances\n`);

  let sum = 0, n = 0, ok = 0;
  for (const s of samples) {
    const d = Math.abs(disp(scoreCurrent(s.inp, s.pos, ref), s.inp.mins) - s.storedRating);
    sum += d; n++; if (d <= 0.1) ok++;
  }
  console.log(`VALIDATION mean abs diff ${(sum/n).toFixed(4)} | within 0.10: ${(100*ok/n).toFixed(1)}%\n`);

  const bl = buildExposureBaselines(samples);

  console.log('=== BASELINE mu(minutes) LEARNED PER EXPOSURE (MID pool, match_impact/BPS) ===');
  console.log('mins   ' + KNOTS.map(k=>String(k).padStart(8)).join(''));
  for (const g of ['DM','CM','AM','CB','ST']) {
    const t = bl.get(poolKey(g));
    if (!t) continue;
    console.log(g.padEnd(7) + t.match_impact.map(x=>x.median.toFixed(1).padStart(8)).join(''));
  }

  const bucketOf = (m) => BUCKETS.find(([,lo,hi]) => m>=lo && m<=hi)?.[0] ?? '75-90';
  const cur = {}, exp = {};
  for (const [b] of BUCKETS) { cur[b] = {r:[],p:[]}; exp[b] = {r:[],p:[]}; }
  for (const s of samples) {
    const b = bucketOf(s.inp.mins);
    const c1 = scoreCurrent(s.inp, s.pos, ref), c2 = scoreExposure(s.inp, s.pos, bl);
    cur[b].r.push(disp(c1, s.inp.mins)); cur[b].p.push(pts(c1, s.inp.mins));
    exp[b].r.push(disp(c2, s.inp.mins)); exp[b].p.push(pts(c2, s.inp.mins));
  }

  console.log('\n=== RATING: current vs exposure-conditioned ===');
  console.log('bucket    n      cur med  cur p95  cur p99  |  new med  new p95  new p99');
  for (const [b] of BUCKETS) {
    console.log(b.padEnd(9) + String(cur[b].r.length).padEnd(7) +
      median(cur[b].r).toFixed(2).padStart(8) + pct(cur[b].r,0.95).toFixed(2).padStart(9) + pct(cur[b].r,0.99).toFixed(2).padStart(9) +
      '  |' + median(exp[b].r).toFixed(2).padStart(9) + pct(exp[b].r,0.95).toFixed(2).padStart(9) + pct(exp[b].r,0.99).toFixed(2).padStart(9));
  }

  console.log('\n=== FANTASY POINTS: median, and % scoring > 0 ===');
  console.log('bucket    cur med   new med  |  cur %>0   new %>0');
  for (const [b] of BUCKETS) {
    const c0 = 100*cur[b].p.filter(x=>x>0).length/cur[b].p.length;
    const n0 = 100*exp[b].p.filter(x=>x>0).length/exp[b].p.length;
    console.log(b.padEnd(9) + median(cur[b].p).toFixed(2).padStart(8) + median(exp[b].p).toFixed(2).padStart(10) +
      '  |' + (c0.toFixed(1)+'%').padStart(9) + (n0.toFixed(1)+'%').padStart(10));
  }

  console.log('\n=== 75-90 TOP-END INTEGRITY ===');
  const long = samples.filter(s => s.inp.mins >= 75);
  const a = long.map(s => disp(scoreCurrent(s.inp,s.pos,ref), s.inp.mins));
  const b2 = long.map(s => disp(scoreExposure(s.inp,s.pos,bl), s.inp.mins));
  const d = b2.map((v,i)=>v-a[i]);
  const mx=a.reduce((x,y)=>x+y,0)/a.length, my=b2.reduce((x,y)=>x+y,0)/b2.length;
  let num=0,dx=0,dy=0;
  for(let i=0;i<a.length;i++){const p=a[i]-mx,q=b2[i]-my;num+=p*q;dx+=p*p;dy+=q*q;}
  console.log(`mean shift ${(d.reduce((x,y)=>x+y,0)/d.length).toFixed(3)} | mean |shift| ${(d.reduce((x,y)=>x+Math.abs(y),0)/d.length).toFixed(3)} | corr ${(num/Math.sqrt(dx*dy)).toFixed(4)}`);
  console.log(`p99 ${pct(a,0.99).toFixed(2)} -> ${pct(b2,0.99).toFixed(2)} | max ${Math.max(...a).toFixed(2)} -> ${Math.max(...b2).toFixed(2)} | %moving >0.25: ${(100*d.filter(x=>Math.abs(x)>0.25).length/d.length).toFixed(1)}%`);

  console.log('\n=== WITHIN-PLAYER SHORT(10-35) vs LONG(75+) GAP ===');
  const byP = new Map();
  for (const s of samples) { if(!byP.has(s.name)) byP.set(s.name,[]); byP.get(s.name).push(s); }
  const gap = (f) => { const g=[];
    for (const [,arr] of byP) {
      const sh=arr.filter(s=>s.inp.mins>=10&&s.inp.mins<=35), lo=arr.filter(s=>s.inp.mins>=75);
      if (sh.length<3||lo.length<3) continue;
      const av=(x)=>x.reduce((t,s)=>t+f(s),0)/x.length;
      g.push(av(lo)-av(sh)); }
    return g.reduce((x,y)=>x+y,0)/g.length; };
  console.log(`current  : ${gap(s=>disp(scoreCurrent(s.inp,s.pos,ref),s.inp.mins)).toFixed(3)}`);
  console.log(`exposure : ${gap(s=>disp(scoreExposure(s.inp,s.pos,bl),s.inp.mins)).toFixed(3)}`);

  console.log('\n=== BALEBA 2025-26 (rating / points) ===');
  const bal = samples.filter(s=>s.name?.toLowerCase().includes('baleba')).sort((x,y)=>x.gw-y.gw);
  console.log('GW  mins    current       exposure');
  for (const s of bal) {
    const c1=scoreCurrent(s.inp,s.pos,ref), c2=scoreExposure(s.inp,s.pos,bl);
    console.log(`${String(s.gw).padStart(2)}  ${String(s.inp.mins).padStart(4)}  ${disp(c1,s.inp.mins).toFixed(2)}/${pts(c1,s.inp.mins).toFixed(1).padStart(5)}   ${disp(c2,s.inp.mins).toFixed(2)}/${pts(c2,s.inp.mins).toFixed(1).padStart(5)}`);
  }

  console.log('\n=== SANITY: best & worst short appearances under new model ===');
  const shorts = samples.filter(s=>s.inp.mins<=20)
    .map(s=>({...s, nr: disp(scoreExposure(s.inp,s.pos,bl), s.inp.mins), g: s.inp.goal_involvement}))
    .sort((x,y)=>y.nr-x.nr);
  console.log('TOP 8:');
  for (const s of shorts.slice(0,8))
    console.log(`  ${s.name?.slice(0,22).padEnd(24)} ${s.pos.padEnd(4)} ${String(s.inp.mins).padStart(3)}min  ${s.nr.toFixed(2)}  (G/A pts ${s.g})`);
  console.log('BOTTOM 5:');
  for (const s of shorts.slice(-5))
    console.log(`  ${s.name?.slice(0,22).padEnd(24)} ${s.pos.padEnd(4)} ${String(s.inp.mins).padStart(3)}min  ${s.nr.toFixed(2)}  (G/A pts ${s.g})`);

  // ── AVAILABILITY TERM: points = curve(rating) x (mins/90)^alpha ────────────
  const ALPHAS = [0, 0.5, 0.75, 1.0];
  const avail = (m, al) => al === 0 ? 1 : Math.pow(Math.min(90, m) / 90, al);

  console.log('\n=== MEDIAN POINTS WITH AVAILABILITY WEIGHTING ===');
  console.log('bucket    current' + ALPHAS.map(a=>`   a=${a}`.padStart(9)).join(''));
  for (const [b, lo, hi] of BUCKETS) {
    const rowsB = samples.filter(s => s.inp.mins >= lo && s.inp.mins <= hi);
    let line = b.padEnd(9) + median(rowsB.map(s=>pts(scoreCurrent(s.inp,s.pos,ref), s.inp.mins))).toFixed(2).padStart(8);
    for (const al of ALPHAS) {
      line += median(rowsB.map(s=>pts(scoreExposure(s.inp,s.pos,bl), s.inp.mins) * avail(s.inp.mins, al))).toFixed(2).padStart(9);
    }
    console.log(line);
  }

  console.log('\n=== SEASON TOTAL POINTS: does the leaderboard survive? ===');
  const totals = new Map();
  for (const s of samples) {
    if (!totals.has(s.name)) totals.set(s.name, { cur:0, a0:0, a50:0, a75:0, a100:0, pos:s.pos, apps:0, mins:0 });
    const t = totals.get(s.name);
    const p2 = pts(scoreExposure(s.inp,s.pos,bl), s.inp.mins);
    t.cur += pts(scoreCurrent(s.inp,s.pos,ref), s.inp.mins);
    t.a0 += p2;
    t.a50 += p2 * avail(s.inp.mins, 0.5);
    t.a75 += p2 * avail(s.inp.mins, 0.75);
    t.a100 += p2 * avail(s.inp.mins, 1.0);
    t.apps++; t.mins += s.inp.mins;
  }
  const arr = [...totals.entries()].map(([name, t]) => ({ name, ...t }));
  const rankBy = (k) => [...arr].sort((x,y)=>y[k]-x[k]).map(x=>x.name);
  const rCur = rankBy('cur');
  const rankIn = (list, name) => list.indexOf(name) + 1;
  console.log('  #  player                 pos  apps  mins   current   a=0.75   rank(0.75)');
  for (let i = 0; i < 20; i++) {
    const nm = rCur[i]; const t = totals.get(nm);
    console.log(`${String(i+1).padStart(3)}  ${nm.slice(0,21).padEnd(23)}${t.pos.padEnd(5)}${String(t.apps).padStart(4)}${String(t.mins).padStart(6)}${t.cur.toFixed(0).padStart(10)}${t.a75.toFixed(0).padStart(9)}${String(rankIn(rankBy('a75'), nm)).padStart(12)}`);
  }
  const top30cur = new Set(rCur.slice(0,30));
  for (const k of ['a0','a50','a75','a100']) {
    const overlap = rankBy(k).slice(0,30).filter(n=>top30cur.has(n)).length;
    console.log(`  top-30 overlap with current, ${k}: ${overlap}/30`);
  }

  console.log('\n=== CAMEO INFLATION CHECK (mins <= 20) ===');
  const cam = samples.filter(s=>s.inp.mins<=20);
  const camNew = cam.map(s=>disp(scoreExposure(s.inp,s.pos,bl), s.inp.mins));
  const camCur = cam.map(s=>disp(scoreCurrent(s.inp,s.pos,ref), s.inp.mins));
  const above = (a,t)=>`${(100*a.filter(x=>x>t).length/a.length).toFixed(1)}%`;
  console.log(`n=${cam.length}  rating >8.0: cur ${above(camCur,8)} -> new ${above(camNew,8)}   >8.5: cur ${above(camCur,8.5)} -> new ${above(camNew,8.5)}`);
  const withGA = cam.filter(s=>s.inp.goal_involvement>0).length;
  console.log(`cameos with a goal/assist: ${withGA} (${(100*withGA/cam.length).toFixed(1)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); });

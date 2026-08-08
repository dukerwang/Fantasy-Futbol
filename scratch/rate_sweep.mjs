/**
 * Offline replica of the Gaffa scoring engine + a "rate-normalized" variant.
 *
 * Purpose: measure exactly what per-90 normalization + exposure shrinkage does
 * to the rating distribution, especially the 75-90 minute top end which must
 * stay recognisable.
 *
 * Validation gate: MODE 'current' must reproduce stored player_stats.match_rating.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = '/Users/dukewang/Fantasy Futbol';
if (existsSync(`${ROOT}/.env.local`)) {
  for (const line of readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n')) {
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
const COMPONENTS = ['match_impact','influence','creativity','threat','defensive','goal_involvement','finishing','save_score'];

// ── engine constants (mirrored from src/lib/scoring/matchRating.ts) ──────────
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
const SIGMOID_K = 1.0;
const GLOBAL_GI_STDDEV = 2.5, GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28, GLOBAL_FINISHING_MEDIAN = -0.03;

const posGroup = (p) => p === 'GK' ? 'GK'
  : ['CB','LB','RB','LWB','RWB'].includes(p) ? 'DEF'
  : ['DM','CM','AM'].includes(p) ? 'MID' : 'ATT';

function sigmoid(v, med, sd) {
  if (sd <= 0) return 0.5;
  return 1 / (1 + Math.exp(-(SIGMOID_K * (v - med) / sd)));
}

// ── raw component inputs, split into RATE vs EVENT ───────────────────────────
// RATE  = accumulates with time on pitch  -> should be measured per-90
// EVENT = discrete occurrence             -> already correctly absolute
const RATE_COMPONENTS = new Set(['match_impact','influence','creativity','threat','defensive','save_score']);

function rawInputs(s, pos) {
  const mins = s.minutes_played ?? 0;
  const goals = s.goals ?? 0, assists = s.assists ?? 0;
  const adjBps = Math.max(0, (s.bps ?? 0) - goals * 12 - assists * 9);

  const gc = s.goals_conceded ?? 0;
  const xgc = s.expected_goals_conceded ?? 0;
  const tackles = Math.max(0, s.fpl_tackles ?? 0);
  const cbi = Math.max(0, s.fpl_cbi ?? 0);
  const recoveries = Math.max(0, s.fpl_recoveries ?? 0);

  let defActions;
  if (pos === 'GK') defActions = recoveries * 0.5 + cbi * 0.5;
  else if (pos === 'CB') defActions = tackles + cbi * 0.5;
  else defActions = (tackles + cbi) + recoveries * 0.5;

  let csBonus = 0;
  if (s.clean_sheet && mins >= 60) {
    const pg = posGroup(pos);
    if (pos === 'GK') csBonus = 16;
    else if (pg === 'DEF' || pos === 'DM') csBonus = 12;
    else if (pos === 'CM') csBonus = 4;
  }
  // outcome modifiers: tied to what happened on the pitch, not to volume
  const defMods = pos === 'GK'
    ? csBonus - gc * 4.0
    : csBonus + Math.max(0, xgc - gc) * 5 - Math.max(0, gc - xgc) * 5;

  const xg = s.expected_goals ?? 0, xa = s.expected_assists ?? 0;

  return {
    match_impact: adjBps,
    influence: s.influence ?? 0,
    creativity: s.creativity ?? 0,
    threat: s.threat ?? 0,
    defActions,
    defMods,
    goal_involvement: goals * 6 + assists * 4,
    finishing: (goals - xg) + (assists - xa) * 0.5,
    save_score: pos === 'GK' ? (s.saves ?? 0) * 2 + (s.penalty_saves ?? 0) * 5 : 0,
    mins,
    cleanSheet: !!s.clean_sheet,
  };
}

/** Exposure-weighted rate estimate. m is a prior weight expressed in minutes. */
function shrunkPer90(observedTotal, mins, prior90, m) {
  if (mins <= 0) return 0;
  return (observedTotal + prior90 * (m / 90)) * 90 / (mins + m);
}

function composite(scores, pos) {
  const w = POSITION_WEIGHTS[pos] || POSITION_WEIGHTS.CM;
  const fc = FLEX_CONFIG[pos] || FLEX_CONFIG.CM;
  let maxScore = -1, maxComp = '';
  for (const k of fc.components) if (scores[k] > maxScore) { maxScore = scores[k]; maxComp = k; }
  let c = 0;
  for (const k of Object.keys(w)) {
    let fw = w[k]; if (k === maxComp) fw += fc.flex;
    if (fw === 0) continue;
    c += scores[k] * fw;
  }
  return Math.min(1.0, c);
}
const displayRating = (c, mins) => (c < 0 || mins === 0) ? 0 : Math.max(1, Math.min(10, 3.5 + 6.0 * c));
const fantasyPoints = (c, mins) => {
  if (mins === 0) return 0;
  const r = Math.max(1, Math.min(10, 1 + 9 * c));
  return Math.max(0, Number((10 * Math.pow(Math.max(0, r - 4.5) / 2.0, 1.5)).toFixed(2)));
};

function median(a){ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2? s[m] : (s[m-1]+s[m])/2; }
function pstdev(a){ if(!a.length) return 1; const mu=a.reduce((x,y)=>x+y,0)/a.length;
  const v=a.reduce((s,x)=>s+(x-mu)**2,0)/a.length; const sd=Math.sqrt(v); return sd<0.001?1:sd; }
function pct(a,p){ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y);
  return s[Math.min(s.length-1, Math.floor(p*s.length))]; }

// ── load data ────────────────────────────────────────────────────────────────
async function loadAll() {
  const players = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('players')
      .select('id, name, primary_position').range(from, from + 999);
    if (error) throw error;
    for (const p of data) players.set(p.id, p);
    if (data.length < 1000) break;
  }
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('player_stats')
      .select('player_id, gameweek, stats, match_rating, fantasy_points')
      .eq('season', SEASON).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const { data: refRows, error: refErr } = await supabase
    .from('rating_reference_stats').select('*').eq('season', SEASON);
  if (refErr) throw refErr;

  const ref = {};
  for (const p of POSITIONS) ref[p] = {};
  for (const r of refRows) {
    if (!ref[r.position_group]) ref[r.position_group] = {};
    ref[r.position_group][r.component] = { median: Number(r.median), stddev: Number(r.stddev) };
  }
  return { players, rows, ref };
}

// ── scoring modes ────────────────────────────────────────────────────────────
function scoreCurrent(inp, pos, ref) {
  const r = ref[pos] || ref.CM;
  const defensiveRaw = inp.defActions + inp.defMods;
  const scores = {
    match_impact: sigmoid(inp.match_impact, r.match_impact.median, r.match_impact.stddev),
    influence: sigmoid(inp.influence, r.influence.median, r.influence.stddev),
    creativity: sigmoid(inp.creativity, r.creativity.median, r.creativity.stddev),
    threat: sigmoid(inp.threat, r.threat.median, r.threat.stddev),
    defensive: sigmoid(defensiveRaw, r.defensive.median, r.defensive.stddev),
    goal_involvement: sigmoid(inp.goal_involvement, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
    finishing: sigmoid(inp.finishing, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
    save_score: pos === 'GK'
      ? (inp.cleanSheet && inp.mins >= 60
          ? Math.max(sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev), 0.85)
          : sigmoid(inp.save_score, r.save_score.median, r.save_score.stddev))
      : 0.5,
  };
  return composite(scores, pos);
}

function scoreRate(inp, pos, base, m) {
  const b = base[pos];
  const sh = (key, obs) => shrunkPer90(obs, inp.mins, b[key].median, m);
  const defensiveRaw = sh('defActions', inp.defActions) + inp.defMods;
  const scores = {
    match_impact: sigmoid(sh('match_impact', inp.match_impact), b.match_impact.median, b.match_impact.stddev),
    influence: sigmoid(sh('influence', inp.influence), b.influence.median, b.influence.stddev),
    creativity: sigmoid(sh('creativity', inp.creativity), b.creativity.median, b.creativity.stddev),
    threat: sigmoid(sh('threat', inp.threat), b.threat.median, b.threat.stddev),
    defensive: sigmoid(defensiveRaw, b.defensive.median, b.defensive.stddev),
    goal_involvement: sigmoid(inp.goal_involvement, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
    finishing: sigmoid(inp.finishing, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
    save_score: pos === 'GK'
      ? (inp.cleanSheet && inp.mins >= 60
          ? Math.max(sigmoid(sh('save_score', inp.save_score), b.save_score.median, b.save_score.stddev), 0.85)
          : sigmoid(sh('save_score', inp.save_score), b.save_score.median, b.save_score.stddev))
      : 0.5,
  };
  return composite(scores, pos);
}

/**
 * Derive per-90 baselines. Two-pass: pass 1 gets an unshrunk per-90 prior from
 * well-measured (>=60 min) appearances; pass 2 recomputes the baseline over the
 * SHRUNK inputs so the sigmoid sees the same distribution it will score against.
 */
function deriveBaselines(samples, m) {
  const KEYS = ['match_impact','influence','creativity','threat','save_score','defActions'];
  const pass1 = {};
  for (const pos of POSITIONS) {
    pass1[pos] = {};
    const rowsPos = samples.filter(s => s.pos === pos && s.inp.mins >= 60);
    for (const k of KEYS) {
      const vals = rowsPos.map(s => s.inp[k] * 90 / s.inp.mins);
      pass1[pos][k] = { median: median(vals), stddev: pstdev(vals) };
    }
  }
  const base = {};
  for (const pos of POSITIONS) {
    base[pos] = {};
    const rowsPos = samples.filter(s => s.pos === pos && s.inp.mins >= 60);
    for (const k of KEYS) {
      const vals = rowsPos.map(s => shrunkPer90(s.inp[k], s.inp.mins, pass1[pos][k].median, m));
      base[pos][k] = { median: median(vals), stddev: pstdev(vals) };
    }
    const defVals = rowsPos.map(s =>
      shrunkPer90(s.inp.defActions, s.inp.mins, pass1[pos].defActions.median, m) + s.inp.defMods);
    base[pos].defensive = { median: median(defVals), stddev: pstdev(defVals) };
  }
  return base;
}

const BUCKETS = [
  ['1-9',   1,  9],
  ['10-24', 10, 24],
  ['25-44', 25, 44],
  ['45-59', 45, 59],
  ['60-74', 60, 74],
  ['75-90', 75, 90],
];

async function main() {
  const { players, rows, ref } = await loadAll();
  console.log(`Loaded ${rows.length} player_stats rows, ${players.size} players\n`);

  const samples = [];
  for (const r of rows) {
    const p = players.get(r.player_id);
    if (!p || !POSITIONS.includes(p.primary_position)) continue;
    const s = r.stats || {};
    const mins = s.minutes_played ?? 0;
    if (mins <= 0) continue;
    samples.push({
      pos: p.primary_position, name: p.name, gw: r.gameweek,
      inp: rawInputs(s, p.primary_position),
      storedRating: Number(r.match_rating), storedPts: Number(r.fantasy_points),
    });
  }
  console.log(`${samples.length} appearances with minutes > 0\n`);

  // ── VALIDATION ────────────────────────────────────────────────────────────
  let maxDiff = 0, sumAbs = 0, n = 0, within01 = 0;
  for (const s of samples) {
    const c = scoreCurrent(s.inp, s.pos, ref);
    const d = Math.abs(displayRating(c, s.inp.mins) - s.storedRating);
    maxDiff = Math.max(maxDiff, d); sumAbs += d; n++;
    if (d <= 0.1) within01++;
  }
  console.log('=== VALIDATION: replica vs stored match_rating ===');
  console.log(`mean abs diff ${(sumAbs/n).toFixed(4)} | max ${maxDiff.toFixed(3)} | within 0.10: ${(100*within01/n).toFixed(1)}%\n`);
  if (sumAbs / n > 0.05) {
    console.log('!! Replica does not reproduce stored ratings; sweep results are NOT trustworthy.\n');
  }

  // ── SWEEP ─────────────────────────────────────────────────────────────────
  const MS = [10, 20, 30, 45];
  const report = {};

  const bucketOf = (mins) => BUCKETS.find(([, lo, hi]) => mins >= lo && mins <= hi)?.[0] ?? '75-90';

  // current
  const cur = {};
  for (const [name] of BUCKETS) cur[name] = { r: [], p: [] };
  for (const s of samples) {
    const c = scoreCurrent(s.inp, s.pos, ref);
    const b = bucketOf(s.inp.mins);
    cur[b].r.push(displayRating(c, s.inp.mins));
    cur[b].p.push(fantasyPoints(c, s.inp.mins));
  }
  report.current = cur;

  for (const m of MS) {
    const base = deriveBaselines(samples, m);
    const acc = {};
    for (const [name] of BUCKETS) acc[name] = { r: [], p: [] };
    for (const s of samples) {
      const c = scoreRate(s.inp, s.pos, base, m);
      const b = bucketOf(s.inp.mins);
      acc[b].r.push(displayRating(c, s.inp.mins));
      acc[b].p.push(fantasyPoints(c, s.inp.mins));
    }
    report[`m=${m}`] = acc;
    report[`m=${m}__base`] = base;
  }

  console.log('=== RATING BY MINUTES BUCKET (median | p95 | p99) ===');
  const modes = ['current', ...MS.map(m => `m=${m}`)];
  console.log('bucket'.padEnd(8) + modes.map(x => x.padStart(20)).join(''));
  for (const [name] of BUCKETS) {
    let line = name.padEnd(8);
    for (const mode of modes) {
      const a = report[mode][name].r;
      line += `${median(a).toFixed(2)}|${pct(a,0.95).toFixed(2)}|${pct(a,0.99).toFixed(2)}`.padStart(20);
    }
    console.log(line);
  }

  console.log('\n=== MEDIAN FANTASY POINTS BY BUCKET ===');
  console.log('bucket'.padEnd(8) + modes.map(x => x.padStart(12)).join(''));
  for (const [name] of BUCKETS) {
    let line = name.padEnd(8);
    for (const mode of modes) line += median(report[mode][name].p).toFixed(2).padStart(12);
    console.log(line);
  }

  console.log('\n=== % OF APPEARANCES SCORING > 0 ===');
  console.log('bucket'.padEnd(8) + modes.map(x => x.padStart(12)).join(''));
  for (const [name] of BUCKETS) {
    let line = name.padEnd(8);
    for (const mode of modes) {
      const a = report[mode][name].p;
      line += `${(100*a.filter(x=>x>0).length/a.length).toFixed(1)}%`.padStart(12);
    }
    console.log(line);
  }

  // ── top-end integrity: does the 75-90 elite tail survive? ──────────────────
  console.log('\n=== 75-90 MIN TOP-END INTEGRITY ===');
  const long = samples.filter(s => s.inp.mins >= 75);
  const curLong = long.map(s => displayRating(scoreCurrent(s.inp, s.pos, ref), s.inp.mins));
  for (const m of MS) {
    const base = deriveBaselines(samples, m);
    const newLong = long.map(s => displayRating(scoreRate(s.inp, s.pos, base, m), s.inp.mins));
    const diffs = newLong.map((v, i) => v - curLong[i]);
    const mu = diffs.reduce((a,b)=>a+b,0)/diffs.length;
    const absMu = diffs.reduce((a,b)=>a+Math.abs(b),0)/diffs.length;
    // rank correlation proxy: Pearson on ratings
    const mx = curLong.reduce((a,b)=>a+b,0)/curLong.length;
    const my = newLong.reduce((a,b)=>a+b,0)/newLong.length;
    let num=0, dx=0, dy=0;
    for (let i=0;i<curLong.length;i++){ const a=curLong[i]-mx, b=newLong[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
    const r = num/Math.sqrt(dx*dy);
    console.log(`m=${String(m).padEnd(3)} mean shift ${mu>=0?'+':''}${mu.toFixed(3)} | mean |shift| ${absMu.toFixed(3)} | corr ${r.toFixed(4)} | p99 ${pct(curLong,0.99).toFixed(2)} -> ${pct(newLong,0.99).toFixed(2)} | max ${Math.max(...curLong).toFixed(2)} -> ${Math.max(...newLong).toFixed(2)}`);
  }

  // ── Baleba ────────────────────────────────────────────────────────────────
  console.log('\n=== CARLOS BALEBA 2025-26 ===');
  const bal = samples.filter(s => s.name && s.name.toLowerCase().includes('baleba'))
                     .sort((a,b)=>a.gw-b.gw);
  const bases = Object.fromEntries(MS.map(m => [m, deriveBaselines(samples, m)]));
  console.log('GW  mins  current' + MS.map(m=>`      m=${m}`).join(''));
  for (const s of bal) {
    const c = displayRating(scoreCurrent(s.inp, s.pos, ref), s.inp.mins);
    const cp = fantasyPoints(scoreCurrent(s.inp, s.pos, ref), s.inp.mins);
    let line = `${String(s.gw).padStart(2)}  ${String(s.inp.mins).padStart(4)}  ${c.toFixed(2)}/${cp.toFixed(1).padStart(5)}`;
    for (const m of MS) {
      const cc = scoreRate(s.inp, s.pos, bases[m], m);
      line += `  ${displayRating(cc,s.inp.mins).toFixed(2)}/${fantasyPoints(cc,s.inp.mins).toFixed(1).padStart(5)}`;
    }
    console.log(line);
  }

  // ── within-player gap, the original symptom ───────────────────────────────
  console.log('\n=== WITHIN-PLAYER SHORT vs LONG RATING GAP ===');
  const byPlayer = new Map();
  for (const s of samples) {
    if (!byPlayer.has(s.name)) byPlayer.set(s.name, []);
    byPlayer.get(s.name).push(s);
  }
  const gapFor = (scorer) => {
    const gaps = [];
    for (const [, arr] of byPlayer) {
      const sh = arr.filter(s => s.inp.mins >= 10 && s.inp.mins <= 35);
      const lo = arr.filter(s => s.inp.mins >= 75);
      if (sh.length < 3 || lo.length < 3) continue;
      const avg = (xs) => xs.reduce((a,s)=>a+scorer(s),0)/xs.length;
      gaps.push(avg(lo) - avg(sh));
    }
    return gaps.reduce((a,b)=>a+b,0)/gaps.length;
  };
  console.log(`current : ${gapFor(s => displayRating(scoreCurrent(s.inp,s.pos,ref), s.inp.mins)).toFixed(3)}`);
  for (const m of MS) {
    console.log(`m=${String(m).padEnd(7)}: ${gapFor(s => displayRating(scoreRate(s.inp,s.pos,bases[m],m), s.inp.mins)).toFixed(3)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

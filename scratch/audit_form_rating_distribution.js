// Run with: node --env-file=.env.local scratch/audit_form_rating_distribution.js
// Calibrates an ABSOLUTE form arrow: what rating values should map to full-down vs full-up?
// Uses the effective value the UI resolves (archive for past seasons), not the zeroed live column.
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const pct = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * f)))];

async function main() {
  // Effective form_rating as the UI resolves it in offseason: 2025-26 archive.
  let arch = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('season_player_stats_archive')
      .select('player_id, form_rating, ppg, total_points').eq('season', '2025-26').range(from, from + 999);
    if (error) throw error;
    arch = arch.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }

  const vals = arch.map(a => Number(a.form_rating ?? 0)).filter(v => v > 0).sort((a, b) => a - b);
  console.log(`archived players with a usable form_rating: ${vals.length}`);
  console.log('\n=== form_rating distribution (archive, 2025-26) ===');
  for (const f of [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]) {
    console.log(`  p${String(Math.round(f * 100)).padStart(3)}: ${pct(vals, f).toFixed(2)}`);
  }

  // Histogram in 0.25 buckets to see where the mass sits.
  const buckets = {};
  for (const v of vals) {
    const b = (Math.floor(v * 4) / 4).toFixed(2);
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  console.log('\n=== histogram (0.25 buckets) ===');
  for (const [b, n] of Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${b.padStart(5)} | ${'█'.repeat(Math.ceil(n / 2))} ${n}`);
  }

  // Live column too, for in-season behaviour once 2026-27 starts.
  const { data: live } = await db.from('players')
    .select('form_rating, is_active').eq('is_active', true);
  const liveVals = (live ?? []).map(p => Number(p.form_rating ?? 0)).filter(v => v > 0).sort((a, b) => a - b);
  console.log(`\n=== live players.form_rating (active, non-zero): n=${liveVals.length} ===`);
  if (liveVals.length) {
    for (const f of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
      console.log(`  p${String(Math.round(f * 100)).padStart(3)}: ${pct(liveVals, f).toFixed(2)}`);
    }
  }

  // Candidate absolute mappings: how would players spread across 5 visual bands?
  console.log('\n=== how many players land in each band, for two candidate ranges ===');
  const candidates = [
    { lo: 5.5, hi: 8.0, label: 'floor 5.5 / ceil 8.0' },
    { lo: 5.0, hi: 8.5, label: 'floor 5.0 / ceil 8.5' },
    { lo: 6.0, hi: 7.75, label: 'floor 6.0 / ceil 7.75' },
  ];
  for (const c of candidates) {
    const bands = [0, 0, 0, 0, 0];
    for (const v of vals) {
      const t = Math.max(0, Math.min(1, (v - c.lo) / (c.hi - c.lo)));
      bands[Math.min(4, Math.floor(t * 5))]++;
    }
    const pctOf = n => `${((n / vals.length) * 100).toFixed(0)}%`;
    console.log(`  ${c.label.padEnd(24)} down:${pctOf(bands[0])} dip:${pctOf(bands[1])} flat:${pctOf(bands[2])} rise:${pctOf(bands[3])} up:${pctOf(bands[4])}`);
  }

  // Saturation check: what fraction pin at the extremes (bad if too high)?
  for (const c of candidates) {
    const atFloor = vals.filter(v => v <= c.lo).length;
    const atCeil = vals.filter(v => v >= c.hi).length;
    console.log(`  ${c.label.padEnd(24)} pinned full-down: ${((atFloor / vals.length) * 100).toFixed(1)}%  pinned full-up: ${((atCeil / vals.length) * 100).toFixed(1)}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

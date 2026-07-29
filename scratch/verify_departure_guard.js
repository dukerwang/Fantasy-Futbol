/**
 * Verifies the plPresence guard against the real backlog: for every inactive
 * rostered player, does the live FPL bootstrap still contain them?
 *
 * A hit means the row is corrupted, not departed — and that departure detection
 * will correctly skip it rather than opening a decision that auto-releases into
 * a real payout.
 *
 * Usage: node --env-file=.env.local scratch/verify_departure_guard.js
 */

const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le',
  'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'junior', 'santos', 'silva', 'costa',
]);

const normalize = (s) =>
  !s ? '' : s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const tokens = (s) => normalize(s).split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t));

function looksLikeSamePlayer(dbName, el) {
  const a = tokens(dbName);
  const b = tokens(`${el.first_name} ${el.second_name}`);
  if (!a.length || !b.length) return false;
  const shared = a.filter((t) => b.includes(t));
  if (shared.length >= 2) return true;
  return shared.length === 1 && (a.length === 1 || b.length === 1);
}

async function main() {
  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'Gaffa/1.0' },
  });
  const { elements } = await res.json();
  console.log(`FPL bootstrap: ${elements.length} players\n`);

  const { data: teams } = await db.from('teams').select('id');
  const { data: entries } = await db
    .from('roster_entries')
    .select('player_id')
    .in('team_id', (teams ?? []).map((t) => t.id));

  const rosteredIds = [...new Set((entries ?? []).map((e) => e.player_id))];

  const { data: inactive } = await db
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', false)
    .in('id', rosteredIds);

  const seen = new Set();
  let corrupted = 0;
  let genuine = 0;

  for (const p of inactive ?? []) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    const hit = elements.find((el) => looksLikeSamePlayer(p.name, el));
    if (hit) {
      corrupted++;
      console.log(`  SKIP (still in PL)  ${p.name}  →  FPL "${hit.first_name} ${hit.second_name}" [${hit.web_name}]`);
    } else {
      genuine++;
      console.log(`  DEPARTURE           ${p.name}  (${p.pl_team})  €${p.market_value}m`);
    }
  }

  console.log(`\n${corrupted} corrupted row(s) will be skipped.`);
  console.log(`${genuine} genuine departure(s) would open a decision.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

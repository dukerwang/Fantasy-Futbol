/**
 * Dry-run for the players-table duplicate merge (see migration 089).
 *
 * Detects (web_name, pl_team) duplicate groups within pl_season = '2025-26',
 * splits them into:
 *   - SAME-IDENTITY pairs: both rows' `name` shares a significant token —
 *     these are the same real footballer under two rows (the SoFIFA/FPL
 *     web_name-drift bug) and are safe to merge.
 *   - DIFFERENT-IDENTITY pairs: the rows' `name` fields share no token —
 *     this is a SEPARATE, unrelated corruption (an inactive/departed
 *     player's row has had its web_name/pl_team overwritten to coincide
 *     with an unrelated active player's). These are NOT merged here —
 *     merging would destroy a distinct real player's row.
 *
 * For each same-identity pair, keeper = the row carrying real player_stats
 * history (not necessarily the active/fpl_id row — that's usually the
 * empty duplicate). Prints every FK table row that would be repointed or
 * deleted, and flags any collision (e.g. a team holding both rows, or a
 * player_season_clubs PK collision) so the migration can special-case it.
 *
 * Read-only. Makes no writes.
 */
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizeName(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const NAME_PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le', 'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'santos', 'silva', 'junior']);
function tokens(str) {
  return new Set(normalizeName(str).split(' ').filter((t) => t.length >= 3 && !NAME_PARTICLES.has(t)));
}
function shareToken(a, b) {
  const ta = tokens(a), tb = tokens(b);
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

async function main() {
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, fpl_id, pl_team, pl_team_id, is_active, total_points, ppg, form, form_rating, market_value, market_value_updated_at, photo_url, fpl_status, fpl_news, date_of_birth, created_at, updated_at, sofifa_common_name, primary_position, secondary_positions, position_ranks, pl_season, pl_status, api_football_id, transfermarkt_id, adp, projected_points, height_cm')
    .eq('pl_season', '2025-26');
  if (error) { console.error(error); process.exit(1); }

  const byKey = new Map();
  for (const p of players) {
    if (!p.web_name) continue;
    const key = `${p.web_name}||${p.pl_team}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const dupeGroups = [...byKey.entries()].filter(([, rows]) => rows.length > 1);

  // Build merge pairs: within each group, union-find rows that share a token.
  const pairs = []; // { key, keeperCandidate, loserCandidate }
  const skippedDifferentIdentity = [];
  for (const [key, rows] of dupeGroups) {
    // Partition rows into identity clusters by pairwise token sharing.
    const clusters = [];
    for (const r of rows) {
      let placed = false;
      for (const c of clusters) {
        if (c.some((m) => shareToken(m.name, r.name))) { c.push(r); placed = true; break; }
      }
      if (!placed) clusters.push([r]);
    }
    for (const cluster of clusters) {
      if (cluster.length < 2) continue; // singleton — not a duplicate, leave alone
      if (cluster.length > 2) {
        console.log(`!! group "${key}" has a ${cluster.length}-way same-identity cluster — needs manual review:`, cluster.map((r) => r.id));
        continue;
      }
      pairs.push({ key, rows: cluster });
    }
    if (clusters.every((c) => c.length < 2) === false && clusters.length && rows.length > clusters.reduce((n, c) => n + (c.length >= 2 ? c.length : 0), 0)) {
      // some rows in this group were NOT part of any same-identity cluster
    }
    const unclusteredCount = rows.length - clusters.filter((c) => c.length >= 2).reduce((n, c) => n + c.length, 0);
    if (unclusteredCount > 0) {
      skippedDifferentIdentity.push([key, rows]);
    }
  }

  console.log(`Total duplicate groups: ${dupeGroups.length}`);
  console.log(`Same-identity merge pairs found: ${pairs.length}`);
  console.log(`Groups with a different-identity (non-mergeable) component: ${skippedDifferentIdentity.length}\n`);

  // Fetch all FK tables once.
  // NOTE: player_stats has 14k+ rows total, well past PostgREST's default
  // 1000-row response cap — a bulk `.in('player_id', allIds)` silently
  // truncates. Stats counts (used to pick which row is the "real" one) are
  // fetched per-id with an exact count instead.
  const allIds = dupeGroups.flatMap(([, rows]) => rows.map((r) => r.id));
  const statsCountById = new Map();
  for (const id of allIds) {
    const { count } = await supabase.from('player_stats').select('id', { count: 'exact', head: true }).eq('player_id', id);
    statsCountById.set(id, count ?? 0);
  }
  const [
    { data: roster },
    { data: transactions },
    { data: waivers },
    { data: draftPicks },
    { data: saleListings },
    { data: loans },
    { data: departures },
    { data: seasonClubs },
    { data: trades },
  ] = await Promise.all([
    supabase.from('roster_entries').select('id, team_id, player_id, status, acquisition_type, acquired_at').in('player_id', allIds),
    supabase.from('transactions').select('id, player_id').in('player_id', allIds),
    supabase.from('waiver_claims').select('id, player_id, drop_player_id, league_id, team_id, status').or(`player_id.in.(${allIds.join(',')}),drop_player_id.in.(${allIds.join(',')})`),
    supabase.from('draft_picks').select('id, player_id').in('player_id', allIds),
    supabase.from('player_sale_listings').select('id, player_id, status').in('player_id', allIds),
    supabase.from('player_loans').select('id, player_id, status').in('player_id', allIds),
    supabase.from('departure_decisions').select('id, player_id, status').in('player_id', allIds),
    supabase.from('player_season_clubs').select('player_id, season, club_slug').in('player_id', allIds),
    supabase.from('trade_proposals').select('id, offered_players, requested_players, status'),
  ]);

  const byPlayerId = (rows) => {
    const m = new Map();
    for (const r of rows ?? []) {
      if (!m.has(r.player_id)) m.set(r.player_id, []);
      m.get(r.player_id).push(r);
    }
    return m;
  };
  const rosterBy = byPlayerId(roster);
  const txBy = byPlayerId(transactions);
  const draftBy = byPlayerId(draftPicks);
  const listingsBy = byPlayerId(saleListings);
  const loansBy = byPlayerId(loans);
  const depBy = byPlayerId(departures);
  const seasonClubsBy = byPlayerId(seasonClubs);
  const waiverByPlayer = byPlayerId(waivers);
  const waiverByDropPlayer = new Map();
  for (const w of waivers ?? []) {
    if (w.drop_player_id) {
      if (!waiverByDropPlayer.has(w.drop_player_id)) waiverByDropPlayer.set(w.drop_player_id, []);
      waiverByDropPlayer.get(w.drop_player_id).push(w);
    }
  }
  const tradesAffecting = (id) => (trades ?? []).filter((t) => (t.offered_players ?? []).includes(id) || (t.requested_players ?? []).includes(id));

  console.log('=== MERGE PLAN ===\n');
  const plan = [];
  for (const { key, rows } of pairs) {
    const [a, b] = rows;
    const statsCountA = statsCountById.get(a.id) ?? 0;
    const statsCountB = statsCountById.get(b.id) ?? 0;

    let keeper, loser;
    if (statsCountA !== statsCountB) {
      [keeper, loser] = statsCountA > statsCountB ? [a, b] : [b, a];
    } else if ((a.total_points ?? 0) !== (b.total_points ?? 0)) {
      [keeper, loser] = (a.total_points ?? 0) > (b.total_points ?? 0) ? [a, b] : [b, a];
    } else if (a.fpl_id != null || b.fpl_id != null) {
      // both empty of stats/points — prefer the currently FPL-synced row as keeper
      [keeper, loser] = a.fpl_id != null ? [a, b] : [b, a];
    } else {
      // fully tied — keep the older row (lower created_at) for id stability
      [keeper, loser] = new Date(a.created_at) <= new Date(b.created_at) ? [a, b] : [b, a];
    }

    const keeperRoster = rosterBy.get(keeper.id) || [];
    const loserRoster = rosterBy.get(loser.id) || [];
    const keeperTeams = new Set(keeperRoster.map((r) => r.team_id));
    const collisionTeams = loserRoster.filter((r) => keeperTeams.has(r.team_id));

    const keeperSeasonClub = (seasonClubsBy.get(keeper.id) || []).find((r) => r.season === '2025-26');
    const loserSeasonClub = (seasonClubsBy.get(loser.id) || []).find((r) => r.season === '2025-26');
    const seasonClubConflict = keeperSeasonClub && loserSeasonClub;
    const seasonClubMismatch = seasonClubConflict && keeperSeasonClub.club_slug !== loserSeasonClub.club_slug;

    const { data: kStatMatches } = await supabase.from('player_stats').select('match_id').eq('player_id', keeper.id);
    const { data: lStatMatches } = await supabase.from('player_stats').select('match_id').eq('player_id', loser.id);
    const kMatchIds = new Set((kStatMatches || []).map((s) => s.match_id));
    const overlappingMatchIds = (lStatMatches || []).map((s) => s.match_id).filter((m) => kMatchIds.has(m));

    const entry = {
      key,
      keeperId: keeper.id, keeperName: keeper.name, keeperPts: keeper.total_points, keeperStats: statsCountA >= 0 ? (keeper === a ? statsCountA : statsCountB) : 0,
      loserId: loser.id, loserName: loser.name, loserPts: loser.total_points, loserFplId: loser.fpl_id, keeperFplId: keeper.fpl_id,
      loserRosterRows: loserRoster.length,
      collisionTeams: collisionTeams.map((r) => r.team_id),
      loserStatsRows: loser === a ? statsCountA : statsCountB,
      overlappingMatchIds,
      loserTx: (txBy.get(loser.id) || []).length,
      loserDraft: (draftBy.get(loser.id) || []).length,
      loserListings: (listingsBy.get(loser.id) || []).length,
      loserLoans: (loansBy.get(loser.id) || []).length,
      loserDepartures: (depBy.get(loser.id) || []).length,
      loserWaiverAsPlayer: (waiverByPlayer.get(loser.id) || []).length,
      loserWaiverAsDrop: (waiverByDropPlayer.get(loser.id) || []).length,
      loserTrades: tradesAffecting(loser.id).length,
      seasonClubConflict, seasonClubMismatch,
      keeperSeasonClub, loserSeasonClub,
    };
    plan.push(entry);

    console.log(`${key}`);
    console.log(`  KEEP   id=${keeper.id} name="${keeper.name}" pts=${keeper.total_points} player_stats=${entry.keeperStats} fpl_id=${keeper.fpl_id}`);
    console.log(`  DELETE id=${loser.id} name="${loser.name}" pts=${loser.total_points} player_stats=${entry.loserStatsRows} fpl_id=${loser.fpl_id}`);
    console.log(`    -> repoint: roster_entries=${loserRoster.length}${collisionTeams.length ? ` [COLLISION on team(s): ${collisionTeams.map(r=>r.team_id).join(',')}]` : ''}, player_stats=${entry.loserStatsRows}${overlappingMatchIds.length ? ` [match_id OVERLAP: ${overlappingMatchIds.join(',')} — those loser rows will be dropped, not repointed]` : ''}, transactions=${entry.loserTx}, draft_picks=${entry.loserDraft}, sale_listings=${entry.loserListings}, loans=${entry.loserLoans}, departure_decisions=${entry.loserDepartures}, waiver_claims(player_id)=${entry.loserWaiverAsPlayer}, waiver_claims(drop_player_id)=${entry.loserWaiverAsDrop}, trade_proposals=${entry.loserTrades}`);
    if (seasonClubConflict) {
      console.log(`    -> player_season_clubs: BOTH have a 2025-26 row (keeper=${keeperSeasonClub.club_slug}, loser=${loserSeasonClub.club_slug}) — ${seasonClubMismatch ? 'MISMATCH, needs manual review' : 'identical, loser row will just be deleted'}`);
    } else if (loserSeasonClub) {
      console.log(`    -> player_season_clubs: only loser has a 2025-26 row (${loserSeasonClub.club_slug}) — will be repointed to keeper`);
    }
    console.log('');
  }

  console.log('\n=== SUMMARY ===');
  console.log('Merge pairs:', plan.length);
  console.log('Pairs with a roster_entries team collision:', plan.filter((p) => p.collisionTeams.length > 0).length);
  console.log('Pairs with a player_season_clubs mismatch:', plan.filter((p) => p.seasonClubMismatch).length);
  console.log('Total roster_entries rows to repoint:', plan.reduce((n, p) => n + p.loserRosterRows, 0));
  console.log('Total player_stats rows to repoint:', plan.reduce((n, p) => n + p.loserStatsRows, 0));

  console.log('\n=== DIFFERENT-IDENTITY groups intentionally NOT merged (separate corruption, needs its own investigation) ===');
  console.log(`${skippedDifferentIdentity.length} groups — sample:`);
  skippedDifferentIdentity.slice(0, 5).forEach(([key, rows]) => {
    console.log(' ', key, rows.map((r) => r.name).join(' / '));
  });
}
main();

// Run with: node --env-file=.env.local scratch/audit_transfers_db.js
//
// Post-076..081 data audit. READ ONLY — no writes anywhere in this file.
//
// PostgREST cannot read pg_catalog, so the function/trigger/constraint checks
// still need the SQL editor (scratch/verify_080_081.sql). Everything here is a
// real table, which is where the open questions actually are:
//
//   1. Did 080 seed an anchor for every open listing?
//   2. What are the 172 live auctions, and are they still ticking or long dead?
//   3. Is process-auctions actually resolving anything?

const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const now = Date.now();
const days = (iso) => (now - new Date(iso).getTime()) / 86400000;
const pad = (s, n) => String(s).padEnd(n);

// PostgREST caps page size; walk it.
async function all(table, select, tweak = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(db.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

function section(t) { console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`); }
function verdict(label, actual, expected, note = '') {
  const ok = actual === expected;
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${pad(label, 44)} ${pad(actual, 8)} ${ok ? '' : `(expected ${expected}) ${note}`}`);
  return ok;
}

async function main() {
  const [listings, anchors, auctions, leagues] = await Promise.all([
    all('player_sale_listings', 'id, league_id, player_id, status, min_bid, ask_price, buy_now_price, open_to_trade, open_to_sale, auction_expires_at, created_at'),
    all('waiver_claims', 'id, league_id, player_id, team_id, status, is_auction, sale_listing_id, faab_bid, expires_at, created_at', q => q.eq('is_auction', true)),
    all('auction_state', 'league_id, player_id, kind, status, highest_bid, bid_count, expires_at, sale_listing_id'),
    all('leagues', 'id, name, status, roster_locked'),
  ]);

  const leagueName = Object.fromEntries(leagues.map(l => [l.id, l.name]));
  const open = listings.filter(l => l.status === 'pending' || l.status === 'active');
  const sysAnchors = anchors.filter(a => a.team_id === null && a.status === 'pending');

  // ── 1. Did 080 seed correctly? ───────────────────────────
  section('080 — every open listing must have an anchor and a board row');

  const anchorByListing = new Set(sysAnchors.filter(a => a.sale_listing_id).map(a => a.sale_listing_id));
  const liveBoard = new Set(
    auctions.filter(a => a.status === 'live').map(a => `${a.league_id}::${a.player_id}`)
  );

  const noAnchor = open.filter(l => !anchorByListing.has(l.id));
  const noBoardRow = open.filter(l => !liveBoard.has(`${l.league_id}::${l.player_id}`));
  const orphanAnchor = sysAnchors.filter(a => {
    if (!a.sale_listing_id) return false;
    const l = listings.find(x => x.id === a.sale_listing_id);
    return l && l.status !== 'pending' && l.status !== 'active';
  });

  console.log(`  open listings: ${open.length}`);
  verdict('Open listings with no anchor', noAnchor.length, 0);
  verdict('Open listings missing from board', noBoardRow.length, 0);
  verdict('Anchors outliving a closed listing', orphanAnchor.length, 0);
  for (const l of noAnchor.slice(0, 5)) console.log(`      no anchor: listing ${l.id} (${leagueName[l.league_id]})`);
  for (const l of noBoardRow.slice(0, 5)) console.log(`      no board row: listing ${l.id} (${leagueName[l.league_id]})`);

  // ── 2. What ARE the live auctions? ───────────────────────
  section('The live auction population — is 172 real?');

  const live = auctions.filter(a => a.status === 'live');
  const expired = live.filter(a => a.expires_at && new Date(a.expires_at).getTime() < now);
  const ticking = live.filter(a => a.expires_at && new Date(a.expires_at).getTime() >= now);
  const noClock = live.filter(a => !a.expires_at);

  console.log(`  live total            ${live.length}`);
  console.log(`    kind=free_agent     ${live.filter(a => a.kind === 'free_agent').length}`);
  console.log(`    kind=listing        ${live.filter(a => a.kind === 'listing').length}`);
  console.log(`    zero bids           ${live.filter(a => a.bid_count === 0).length}`);
  console.log(`    has bids            ${live.filter(a => a.bid_count > 0).length}`);
  console.log(`  still ticking         ${ticking.length}`);
  console.log(`  NO expiry set         ${noClock.length}`);
  console.log(`  EXPIRED but live      ${expired.length}   <-- unresolved`);

  if (expired.length) {
    const ages = expired.map(a => days(a.expires_at)).sort((x, y) => y - x);
    console.log(`    oldest overdue      ${ages[0].toFixed(1)} days`);
    console.log(`    median overdue      ${ages[Math.floor(ages.length / 2)].toFixed(1)} days`);
    console.log(`    with real bids      ${expired.filter(a => a.bid_count > 0).length}  <-- these owe someone a player`);
  }

  const byLeague = {};
  for (const a of live) {
    const k = leagueName[a.league_id] ?? a.league_id;
    byLeague[k] = (byLeague[k] ?? 0) + 1;
  }
  console.log('\n  live auctions per league:');
  for (const [n, c] of Object.entries(byLeague).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(n, 34)} ${c}`);
  }

  // ── 3. Is the resolver cron alive? ───────────────────────
  section('Is process-auctions actually running?');

  const settled = anchors
    .filter(a => a.status === 'approved' || a.status === 'rejected')
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at));

  if (!settled.length) {
    console.log('  No auction claim has EVER been resolved.');
  } else {
    console.log(`  most recent settled claim was created ${days(settled[0].created_at).toFixed(1)} days ago`);
    console.log(`  settled claims total: ${settled.length}  (approved ${settled.filter(s => s.status === 'approved').length} / rejected ${settled.filter(s => s.status === 'rejected').length})`);
  }
  console.log(`  pending auction claims: ${anchors.filter(a => a.status === 'pending').length}`);

  if (expired.length > live.length * 0.5 && live.length > 10) {
    console.log('\n  >> Most live auctions are past their clock. The resolver is almost');
    console.log('     certainly not running. 019_auction_pgcron.sql pins a hardcoded');
    console.log('     Vercel preview URL — if that deployment is gone, nothing fires.');
  }

  // ── 4. Listing gate sanity (077 columns in practice) ─────
  section('Listing gates as configured today');
  const g = (f) => open.filter(f).length;
  console.log(`  open to trade only     ${g(l => l.open_to_trade && !l.open_to_sale)}`);
  console.log(`  open to sale only      ${g(l => !l.open_to_trade && l.open_to_sale)}`);
  console.log(`  both                   ${g(l => l.open_to_trade && l.open_to_sale)}`);
  console.log(`  neither (inert)        ${g(l => !l.open_to_trade && !l.open_to_sale)}`);
  console.log(`  with buy-now price     ${g(l => l.buy_now_price != null)}`);
  console.log(`  with ask price         ${g(l => l.ask_price != null)}`);

  console.log('\nDone. Read-only — nothing was modified.\n');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

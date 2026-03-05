/**
 * debug_fpl_live.js
 *
 * Fetch raw FPL live data for a specific GW and print stats for known players
 * to verify the data coming back from the API is correct.
 */

const FPL_BASE = 'https://fantasy.premierleague.com/api';

async function main() {
  // 1. Get bootstrap to find player IDs
  console.log('Fetching bootstrap...');
  const bootstrap = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
  }).then(r => r.json());

  // Search for key players by name
  const searchNames = ['Mac Allister', 'Caicedo', 'Salah', 'Haaland', 'Rice', 'Mbeumo'];
  const found = [];

  for (const el of bootstrap.elements) {
    const fullName = `${el.first_name} ${el.second_name}`;
    const web = el.web_name;
    for (const search of searchNames) {
      if (fullName.toLowerCase().includes(search.toLowerCase()) || web.toLowerCase().includes(search.toLowerCase())) {
        found.push({ id: el.id, name: fullName, web_name: web, search });
        break;
      }
    }
  }

  console.log('\nFound players:');
  for (const p of found) {
    console.log(`  ${p.id.toString().padStart(4)}  ${p.web_name.padEnd(20)} (${p.name})`);
  }

  const targetIds = new Set(found.map(p => p.id));

  // 2. Fetch live data for GW1 and GW10 (two different points in the season)
  for (const gw of [1, 10, 20]) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  GW${gw} LIVE DATA — raw stats for target players`);
    console.log('═'.repeat(70));

    const liveData = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    }).then(r => r.json());

    const elements = liveData.elements ?? [];
    const elementMap = new Map(elements.map(e => [e.id, e]));

    for (const p of found) {
      const el = elementMap.get(p.id);
      if (!el) {
        console.log(`\n  ${p.web_name}: NOT IN LIVE DATA`);
        continue;
      }

      const s = el.stats;
      const didPlay = s.minutes > 0;
      console.log(`\n  ${p.web_name} (id=${p.id}) — played: ${didPlay ? `${s.minutes} min` : 'DNP'}`);
      if (didPlay) {
        console.log(`    Goals: ${s.goals_scored}  Assists: ${s.assists}  CS: ${s.clean_sheets}`);
        console.log(`    BPS: ${s.bps}  Bonus: ${s.bonus}`);
        console.log(`    Influence: ${s.influence}  Creativity: ${s.creativity}  Threat: ${s.threat}  ICT: ${s.ict_index}`);
        console.log(`    xG: ${s.expected_goals}  xA: ${s.expected_assists}  xGC: ${s.expected_goals_conceded}`);
        console.log(`    GC: ${s.goals_conceded}  Saves: ${s.saves}`);
        console.log(`    FPL raw points: ${s.total_points}`);
      }

      // Also show explain array (per fixture breakdown)
      if (el.explain && el.explain.length > 0 && didPlay) {
        console.log(`    Explain fixtures: ${el.explain.length}`);
        for (const fix of el.explain) {
          const stats = fix.stats.map(st => `${st.identifier}=${st.value}(${st.points}pts)`).join(', ');
          console.log(`      Fixture ${fix.fixture}: ${stats}`);
        }
      }
    }
  }

  // 3. Also fetch player history via element-summary to compare
  console.log('\n\n' + '═'.repeat(70));
  console.log('  ELEMENT-SUMMARY HISTORY (Mac Allister + Caicedo)');
  console.log('  This is the authoritative per-GW history endpoint');
  console.log('═'.repeat(70));

  const macAllister = found.find(p => p.search === 'Mac Allister');
  const caicedo = found.find(p => p.search === 'Caicedo');

  for (const p of [macAllister, caicedo].filter(Boolean)) {
    console.log(`\n  ${p.web_name} (id=${p.id}) — per-GW history:`);

    const summary = await fetch(`${FPL_BASE}/element-summary/${p.id}/`, {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    }).then(r => r.json());

    const history = summary.history ?? [];
    console.log('  GW   Min  G  A  BPS  Infl  Crea  Thrt  ICT     xG     xA    xGC    FPLpts');
    console.log('  ' + '─'.repeat(75));
    for (const h of history.slice(0, 26)) {
      const gw = h.round;
      const pts = h.total_points;
      console.log(
        `  ${String(gw).padStart(2)}  ` +
        `${String(h.minutes).padStart(3)}  ` +
        `${h.goals_scored}  ` +
        `${h.assists}  ` +
        `${String(h.bps).padStart(3)}  ` +
        `${String(h.influence).padStart(5)}  ` +
        `${String(h.creativity).padStart(5)}  ` +
        `${String(h.threat).padStart(5)}  ` +
        `${String(h.ict_index).padStart(5)}  ` +
        `${String(h.expected_goals).padStart(5)}  ` +
        `${String(h.expected_assists).padStart(5)}  ` +
        `${String(h.expected_goals_conceded).padStart(5)}  ` +
        `${String(pts).padStart(6)} pts`
      );
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

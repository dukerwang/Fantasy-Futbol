process.loadEnvFile('.env.local');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const SOFIFA_POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB', LB: 'LB', LWB: 'LWB',
  RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RW', RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LW', RAM: 'AM',
  CAM: 'AM', LAM: 'AM', RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
  DM: 'DM', AM: 'AM'
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchMissingTransfers() {
  console.log('--- FETCHING MISSING SOFIFA CARDS FOR NEW TRANSFERS ---');

  const sofifaRaw = fs.readFileSync(path.join(__dirname, '..', 'scraped-sofifa.json'), 'utf-8');
  const sofifaTeams = JSON.parse(sofifaRaw);

  const matchedSoFifaIds = new Set();
  sofifaTeams.forEach(t => {
    (t.players || []).forEach(p => {
      matchedSoFifaIds.add((p.fullName || '').toLowerCase());
      matchedSoFifaIds.add((p.commonName || '').toLowerCase());
    });
  });

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions')
    .eq('is_active', true);

  const missingFromPlSofifa = dbPlayers.filter(p => {
    const fn = p.name.toLowerCase();
    const wn = p.web_name.toLowerCase();
    return !matchedSoFifaIds.has(fn) && !matchedSoFifaIds.has(wn);
  });

  console.log(`Found ${missingFromPlSofifa.length} players not in PL SoFIFA team rosters (new international transfers or academy players).\n`);

  let updatedCount = 0;

  for (let i = 0; i < missingFromPlSofifa.length; i++) {
    const p = missingFromPlSofifa[i];
    console.log(`[${i + 1}/${missingFromPlSofifa.length}] Searching SoFIFA for ${p.name} (${p.web_name} - ${p.pl_team})...`);

    try {
      await delay(600);
      const searchUrl = `https://sofifa.com/players?keyword=${encodeURIComponent(p.web_name || p.name)}`;
      const res = await fetch(searchUrl, { headers: HEADERS });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      const firstRow = $('table tbody tr').first();
      const playerLink = firstRow.find('a[href^="/player/"]').first();
      const rawPosEls = firstRow.find('span.pos');

      if (playerLink.length > 0 && rawPosEls.length > 0) {
        const foundName = playerLink.text().trim();
        const rawPositions = Array.from(rawPosEls).map(el => $(el).text().trim());

        const primaryRaw = rawPositions[0];
        const primaryPos = SOFIFA_POS_MAP[primaryRaw] || p.primary_position;
        const secondaries = rawPositions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(pos => pos && pos !== primaryPos);

        console.log(`  -> Found on SoFIFA: "${foundName}" [Positions: ${rawPositions.join(', ')} -> Mapped: ${primaryPos} ${JSON.stringify(secondaries)}]`);

        await supabase
          .from('players')
          .update({
            primary_position: primaryPos,
            secondary_positions: Array.from(new Set(secondaries))
          })
          .eq('id', p.id);

        updatedCount++;
      } else {
        console.log(`  -> Not found on SoFIFA search.`);
      }
    } catch (err) {
      console.error(`  ⚠️ Error searching for ${p.name}: ${err.message}`);
    }
  }

  console.log(`\n✅ Finished! Successfully searched and updated ${updatedCount} missing players with their live SoFIFA cards.`);
}

fetchMissingTransfers().catch(console.error);

process.loadEnvFile('.env.local');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function parseMarketValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '');
  if (!s || s === '-' || s === 'N/A') return null;
  const clean = s.replace(/^[€$£]/, '');
  const lower = clean.toLowerCase();
  if (lower.endsWith('bn')) return parseFloat(lower) * 1000;
  if (lower.endsWith('m')) return parseFloat(lower);
  if (lower.endsWith('k')) return parseFloat(lower) / 1000;
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

// Fixed club squad endpoints on Transfermarkt
const CLUB_SQUAD_URLS = [
  { name: 'Manchester City', url: 'https://www.transfermarkt.com/manchester-city/kader/verein/281/saison_id/2026' },
  { name: 'Arsenal FC', url: 'https://www.transfermarkt.com/fc-arsenal/kader/verein/11/saison_id/2026' },
  { name: 'Chelsea FC', url: 'https://www.transfermarkt.com/fc-chelsea/kader/verein/631/saison_id/2026' },
  { name: 'Liverpool FC', url: 'https://www.transfermarkt.com/fc-liverpool/kader/verein/31/saison_id/2026' },
  { name: 'Tottenham Hotspur', url: 'https://www.transfermarkt.com/tottenham-hotspur/kader/verein/148/saison_id/2026' },
  { name: 'Manchester United', url: 'https://www.transfermarkt.com/manchester-united/kader/verein/985/saison_id/2026' },
  { name: 'Brighton & Hove Albion', url: 'https://www.transfermarkt.com/brighton-amp-hove-albion/kader/verein/1237/saison_id/2026' },
  { name: 'Newcastle United', url: 'https://www.transfermarkt.com/newcastle-united/kader/verein/762/saison_id/2026' },
  { name: 'Crystal Palace', url: 'https://www.transfermarkt.com/crystal-palace/kader/verein/873/saison_id/2026' },
  { name: 'AFC Bournemouth', url: 'https://www.transfermarkt.com/afc-bournemouth/kader/verein/989/saison_id/2026' },
  { name: 'Brentford FC', url: 'https://www.transfermarkt.com/brentford-fc/kader/verein/1148/saison_id/2026' },
  { name: 'Aston Villa', url: 'https://www.transfermarkt.com/aston-villa/kader/verein/405/saison_id/2026' },
  { name: 'Nottingham Forest', url: 'https://www.transfermarkt.com/nottingham-forest/kader/verein/703/saison_id/2026' },
  { name: 'Everton FC', url: 'https://www.transfermarkt.com/everton-fc/kader/verein/29/saison_id/2026' },
  { name: 'Leeds United', url: 'https://www.transfermarkt.com/leeds-united/kader/verein/399/saison_id/2026' },
  { name: 'Sunderland AFC', url: 'https://www.transfermarkt.com/sunderland-afc/kader/verein/289/saison_id/2026' },
  { name: 'Fulham FC', url: 'https://www.transfermarkt.com/fulham-fc/kader/verein/931/saison_id/2026' },
  { name: 'Ipswich Town', url: 'https://www.transfermarkt.com/ipswich-town/kader/verein/687/saison_id/2026' },
  { name: 'Coventry City', url: 'https://www.transfermarkt.com/coventry-city/kader/verein/990/saison_id/2026' },
  { name: 'Hull City', url: 'https://www.transfermarkt.com/hull-city/kader/verein/3008/saison_id/2026' },
];

async function scrapeLiveTransfermarkt() {
  console.log('=====================================================');
  console.log('   LIVE TRANSFERMARKT SCRAPER STARTED');
  console.log('=====================================================\n');

  const scrapedPlayers = [];

  for (let i = 0; i < CLUB_SQUAD_URLS.length; i++) {
    const club = CLUB_SQUAD_URLS[i];
    console.log(`[${i + 1}/${CLUB_SQUAD_URLS.length}] Scraping live squad for ${club.name}...`);

    try {
      await delay(800);
      const res = await fetch(club.url, { headers: HEADERS });
      if (!res.ok) {
        console.error(`  ⚠️ Error fetching ${club.name}: ${res.status}`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      let clubPlayerCount = 0;

      $('table.items tbody tr.odd, table.items tbody tr.even').each((_, el) => {
        const nameEl = $(el).find('td.hauptlink a').first();
        const playerName = nameEl.text().trim();
        const mvRaw = $(el).find('td.rechts.hauptlink').text().trim();

        if (playerName && mvRaw) {
          scrapedPlayers.push({
            player_name: playerName,
            market_value_raw: mvRaw,
            market_value: parseMarketValue(mvRaw),
            club_name: club.name
          });
          clubPlayerCount++;
        }
      });

      console.log(`  -> Extracted ${clubPlayerCount} players from ${club.name}`);
    } catch (err) {
      console.error(`  ⚠️ Exception scraping ${club.name}: ${err.message}`);
    }
  }

  console.log(`\nLive Scraping Complete! Extracted ${scrapedPlayers.length} total players from Transfermarkt.`);

  // Save fresh scraped data to scripts/players.json
  const outPath = path.join(__dirname, '..', 'scripts', 'players.json');
  fs.writeFileSync(outPath, JSON.stringify(scrapedPlayers, null, 2));
  console.log(`Saved fresh live data to ${outPath}\n`);

  // Bulk update DB with live values
  console.log('Syncing fresh live Transfermarkt values into Gaffa Supabase DB...');
  const { data: activePlayers } = await supabase.from('players').select('id, name, market_value').eq('is_active', true);
  const dbNames = (activePlayers || []).map(p => p.name);

  let matched = 0;
  const updates = [];

  for (const tmP of scrapedPlayers) {
    if (tmP.market_value == null) continue;
    const match = stringSimilarity.findBestMatch(tmP.player_name, dbNames);
    if (match.bestMatch.rating >= 0.70) {
      const dbP = activePlayers.find(p => p.name === match.bestMatch.target);
      if (dbP) {
        matched++;
        updates.push({
          id: dbP.id,
          market_value: tmP.market_value,
          market_value_updated_at: new Date().toISOString()
        });
      }
    }
  }

  console.log(`Matched ${matched} / ${activePlayers.length} active players with fresh live Transfermarkt values.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({
      market_value: u.market_value,
      market_value_updated_at: u.market_value_updated_at
    }).eq('id', u.id)));
  }

  console.log('✅ Live Transfermarkt Sync Completed Successfully!');
}

scrapeLiveTransfermarkt().catch(console.error);

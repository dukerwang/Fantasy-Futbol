process.loadEnvFile('.env.local');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const stringSimilarity = require('string-similarity');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeIpswichDirect() {
  console.log('Fetching Ipswich Town live squad (verein/677) from Transfermarkt...');
  const url = 'https://www.transfermarkt.com/ipswich-town/kader/verein/677/saison_id/2026';
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.error('Failed to fetch Ipswich page:', res.status);
    return;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const ipswichPlayers = [];

  $('table.items tbody tr.odd, table.items tbody tr.even').each((_, el) => {
    const name = $(el).find('td.hauptlink a').first().text().trim();
    const mvRaw = $(el).find('td.rechts.hauptlink').text().trim();
    if (name && mvRaw) {
      ipswichPlayers.push({ name, mv: parseMarketValue(mvRaw) });
    }
  });

  console.log(`Extracted ${ipswichPlayers.length} players from Ipswich Town live squad:`, ipswichPlayers.slice(0, 10));

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, market_value')
    .eq('pl_team', 'Ipswich Town')
    .eq('is_active', true);

  const dbNames = dbPlayers.map(p => p.name);
  let matched = 0;

  for (const tmP of ipswichPlayers) {
    if (!tmP.mv) continue;
    const tmNorm = normalize(tmP.name);

    let matchP = dbPlayers.find(p => normalize(p.name) === tmNorm || normalize(p.web_name) === tmNorm);
    if (!matchP) {
      const match = stringSimilarity.findBestMatch(tmP.name, dbNames);
      if (match.bestMatch.rating >= 0.55) {
        matchP = dbPlayers.find(p => p.name === match.bestMatch.target);
      }
    }

    if (matchP) {
      matched++;
      await supabase
        .from('players')
        .update({ market_value: tmP.mv, market_value_updated_at: new Date().toISOString() })
        .eq('id', matchP.id);
      console.log(`  ✅ Matched Ipswich player: ${matchP.name} (€${tmP.mv}m)`);
    }
  }

  console.log(`\nSuccessfully matched and updated ${matched} / ${dbPlayers.length} Ipswich Town players in Gaffa DB!`);
}

scrapeIpswichDirect();

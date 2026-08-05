/**
 * Fetches squad + position + role data from sofifa.com using a real browser
 * (bypasses Cloudflare API block by scraping HTML), then POSTs it to the sync route.
 *
 * Usage:
 *   node playwright-sofifa.js --headful               # Premier League only
 *   node playwright-sofifa.js --headful --top5         # all top-5 leagues (1-2x/year)
 *   node playwright-sofifa.js --headful --only=bournemouth,fulham   # just these teams' squads
 *   node playwright-sofifa.js --send-only
 *
 * --headful is effectively required, not optional: tested directly, headless mode
 * gets 0/357 real results even immediately after a --headful run warms the saved
 * session (./playwright-profile) -- Cloudflare here evaluates whether the live
 * request looks automated, not just whether a valid session cookie exists. Headless
 * is left in as a fallback path (and the "no teams collected" guard below keeps a
 * failed attempt from sending garbage), but don't rely on it succeeding.
 *
 * --top5 additionally scrapes La Liga/Serie A/Bundesliga/Ligue 1, tagging each team
 * with sofifaLeagueId so the sync route can cache every player (not just Premier
 * League matches) into sofifa_position_reference -- lets a brand-new Prem signing
 * get a real position immediately on arrival if they transferred from one of these
 * leagues, instead of waiting for the next PL-only crawl to happen to cover them.
 *
 * SYNC_URL defaults to localhost for manual/dev runs; set SOFIFA_SYNC_URL to point
 * at production instead, e.g.:
 *   SOFIFA_SYNC_URL=https://gaffa.live/api/sync/sofifa-players node playwright-sofifa.js --headful --top5
 */

const { chromium } = require('playwright');
const fs = require('fs');

const SOFIFA_BASE = 'https://sofifa.com';
const SYNC_URL = process.env.SOFIFA_SYNC_URL || 'http://localhost:3000/api/sync/sofifa-players';
const DATA_FILE = 'scraped-sofifa.json';

// SoFIFA's own league ids (sofifa.com/league/<id>), verified against real
// indexed SoFIFA pages, not guessed -- getting one wrong here means silently
// scraping the wrong league's squads into the position reference cache.
const LEAGUES = [
  { id: 13, name: 'Premier League' },
  { id: 53, name: 'La Liga' },
  { id: 31, name: 'Serie A' },
  { id: 19, name: 'Bundesliga' },
  { id: 16, name: 'Ligue 1' },
];

// Try to load CRON_SECRET from .env.local
let CRON_SECRET = 'change-me-to-a-random-secret';
try {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  const match = envFile.match(/CRON_SECRET=([^\n]+)/);
  if (match) CRON_SECRET = match[1].trim();
} catch (e) {
  // Ignored
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const sendOnly = process.argv.includes('--send-only');
  let preloadedTeams = [];

  if (sendOnly) {
    if (!fs.existsSync(DATA_FILE)) {
      console.error(`❌ Error: ${DATA_FILE} not found. You must run a full scrape first.`);
      process.exit(1);
    }
    console.log(`📦 Loading previously scraped data from ${DATA_FILE}...`);
    try {
      preloadedTeams = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error(`❌ Error parsing ${DATA_FILE}:`, e.message);
      process.exit(1);
    }
  } else {
    const headful = process.argv.includes('--headful');
    const top5 = process.argv.includes('--top5');
    const leaguesToScrape = top5 ? LEAGUES : [LEAGUES[0]];
    let context = null;
    let page = null;

    // Always the same persistent profile, same real-Chrome binary, same args --
    // only `headless` differs. Using the same executablePath for both keeps the
    // saved cookies/fingerprint consistent regardless of which mode wrote them,
    // so a session solved once in --headful actually carries over headlessly.
    context = await chromium.launchPersistentContext('./playwright-profile', {
      headless: !headful,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    page = context.pages()[0] || await context.newPage();

    try {
      console.log('Loading sofifa.com to establish session...');
      await page.goto(SOFIFA_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(2000);

      for (const league of leaguesToScrape) {
      console.log(`\n=== ${league.name} (lg=${league.id}) ===`);
      console.log('Fetching teams...');
      await page.goto(`${SOFIFA_BASE}/teams?lg=${league.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (headful) {
        console.log('🔒 Cloudflare challenge may appear. If a "Verify you are human" checkbox is shown in the browser, please check it to proceed...');
        await page.waitForSelector('table tbody tr a[href^="/team/"]', { timeout: 60000 }).catch(e => console.log('⚠️ Warning: Timeout waiting for team selector. proceeding...'));
      } else {
        await page.waitForSelector('table tbody tr a[href^="/team/"]', { timeout: 15000 }).catch(e => console.log('⚠️ Warning: Timeout waiting for team selector. proceeding...'));
      }
      
      let teamsData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('table tbody tr a[href^="/team/"]'));
        const unique = [];
        const seen = new Set();
        for (const a of links) {
          const href = a.getAttribute('href');
          if (!seen.has(href)) {
            seen.add(href);
            const id = parseInt(href.split('/')[2]);
            const name = a.innerText.trim();
            if (name) unique.push({ id, name, href });
          }
        }
        return unique;
      });

      const onlyArg = process.argv.find((a) => a.startsWith('--only='));
      if (onlyArg) {
        const filters = onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        teamsData = teamsData.filter((t) => filters.some((f) => t.name.toLowerCase().includes(f)));
        console.log(`--only filter applied: ${teamsData.map((t) => t.name).join(', ') || '(no teams matched)'}`);
      }

      console.log(`Found ${teamsData.length} teams. Starting extraction...`);

      for (let i = 0; i < teamsData.length; i++) {
        const team = teamsData[i];
        console.log(`\n[${i + 1}/${teamsData.length}] Roster for ${team.name} (ID: ${team.id})...`);
        
        // Fetch HTML seamlessly via same-origin XHR to bypass Cloudflare navigation tracking
        await delay(2000);
        const playerLinks = await page.evaluate(async (url) => {
          const res = await fetch(url);
          const html = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          const rows = Array.from(doc.querySelectorAll('table tbody tr'));
          const unique = [];
          const seen = new Set();

          const positionMap = {
            'GK': 'GK',
            'CB': 'CB', 'LCB': 'CB', 'RCB': 'CB',
            'LB': 'LB',
            'RB': 'RB',
            'LWB': 'LWB',
            'RWB': 'RWB',
            'CDM': 'DM', 'LDM': 'DM', 'RDM': 'DM', // Map to DM
            'CM': 'CM', 'LCM': 'CM', 'RCM': 'CM',
            'CAM': 'AM', 'LAM': 'AM', 'RAM': 'AM', // Map to AM
            'LM': 'LM',
            'RM': 'RM',
            'LW': 'LW', 'LF': 'LW',
            'RW': 'RW', 'RF': 'RW',
            'ST': 'ST', 'CF': 'ST', 'LS': 'ST', 'RS': 'ST'
          };

          for (const row of rows) {
            const a = row.querySelector('a[href^="/player/"]');
            if (!a) continue;
            const href = a.getAttribute('href');
            const name = a.innerText.trim();
            if (name && !seen.has(href)) {
              seen.add(href);
              const id = parseInt(href.split('/')[2]);
              
              // Extract and clean positions
              const posEls = row.querySelectorAll('span.pos');
              let rawPositions = Array.from(posEls).map(el => el.innerText.trim());
              
              // Map to standardized codes and deduplicate
              const cleanedPositions = [...new Set(
                rawPositions
                  .map(p => positionMap[p])
                  .filter(Boolean)
              )];

              // If for some reason we filtered everything out (e.g. only SUB), skip or keep raw
              if (cleanedPositions.length === 0 && rawPositions.length > 0) {
                // Fallback: keep raw if we don't recognize it, but filter out common noise
                const filteredRaw = rawPositions.filter(p => !['SUB', 'RES'].includes(p));
                if (filteredRaw.length > 0) cleanedPositions.push(...filteredRaw);
              }

              unique.push({ id, commonName: name, href, positions: cleanedPositions });
            }
          }
          return unique;
        }, `${SOFIFA_BASE}${team.href}`);

        const teamPlayers = [];
        const BATCH_SIZE = 5;

        for (let j = 0; j < playerLinks.length; j += BATCH_SIZE) {
          const batch = playerLinks.slice(j, j + BATCH_SIZE);
          
          const batchResults = await Promise.all(batch.map(async (pLink) => {
            const hasLeftFb = pLink.positions.includes('LB') || pLink.positions.includes('LWB');
            const hasLeftMid = pLink.positions.includes('LM');
            const hasLeftWing = pLink.positions.includes('LW');
            
            const hasRightFb = pLink.positions.includes('RB') || pLink.positions.includes('RWB');
            const hasRightMid = pLink.positions.includes('RM');
            const hasRightWing = pLink.positions.includes('RW');
            
            let needsRoles = false;
            if (!(pLink.positions.includes('LM') && pLink.positions.includes('RM'))) {
              const leftNeeds = (hasLeftFb && hasLeftMid && !hasLeftWing);
              const rightNeeds = (hasRightFb && hasRightMid && !hasRightWing);
              needsRoles = leftNeeds || rightNeeds;
            }
            
            // Extract a clean full name from the URL slug as a baseline
            const slug = pLink.href.split('/')[3] || '';
            const slugName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            if (!needsRoles) {
              return {
                id: pLink.id,
                commonName: pLink.commonName,
                fullName: slugName,
                positions: pLink.positions,
                roles: []
              };
            }

            // Fetch player details silently via XHR to completely bypass Cloudflare navigation triggers
            try {
              const details = await page.evaluate(async (url) => {
                const res = await fetch(url);
                const html = await res.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                const fullName = doc.querySelector('h1')?.innerText.trim() || '';
                const bodyText = doc.body.innerText;
                const roleIndex = bodyText.indexOf('Roles');
                let roles = [];
                if (roleIndex !== -1) {
                  const chunk = bodyText.substring(roleIndex, roleIndex + 1000);
                  const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                  for (let k = 1; k < Math.min(lines.length, 25); k++) {
                    const line = lines[k];
                    // Categories headers usually follow roles
                    if (['Layout', 'Attacking', 'Skill', 'Movement', 'Power', 'Mentality', 'Defending', 'Goalkeeping'].includes(line)) break;
                    
                    // Skip position labels (both codes and full names)
                    const positionsToSkip = [
                      'GK', 'Goalkeeper', 
                      'CB', 'Centre Back', 'Center Back',
                      'LB', 'Left Back', 'RB', 'Right Back',
                      'LWB', 'Left Wing Back', 'RWB', 'Right Wing Back',
                      'CDM', 'Central Defensive Midfielder',
                      'CM', 'Central Midfielder',
                      'CAM', 'Central Attacking Midfielder',
                      'LM', 'Left Midfielder', 'RM', 'Right Midfielder',
                      'LW', 'Left Winger', 'RW', 'Right Winger',
                      'ST', 'Striker', 'CF', 'Center Forward',
                      'SUB', 'RES', 'Substitutes', 'Reserves'
                    ];
                    if (positionsToSkip.includes(line)) continue;
                    
                    // Skip focus/instruction labels
                    if (['Attack', 'Balanced', 'Roaming', 'Defend', 'Overlap', 'Inverted', 'Stay Wide'].includes(line)) continue;
                    
                    roles.push(line);
                  }
                }
                return { fullName, roles: Array.from(new Set(roles)) };
              }, `${SOFIFA_BASE}${pLink.href}`);

              return {
                id: pLink.id,
                commonName: pLink.commonName,
                fullName: details.fullName || slugName,
                positions: pLink.positions,
                roles: details.roles
              };
            } catch (err) {
              console.error(`\n      ⚠️ Error fetching ${pLink.commonName}: ${err.message}`);
              return {
                id: pLink.id,
                commonName: pLink.commonName,
                fullName: slugName,
                positions: pLink.positions,
                roles: []
              };
            }
          }));

          for (const res of batchResults) {
            console.log(`    (${teamPlayers.length + 1}/${playerLinks.length}) ${res.commonName} [${res.positions.join(', ')}] Roles: ${res.roles.length > 0 ? res.roles.join(' | ') : (res.roles === undefined ? 'Skipped' : 'None')}`);
            teamPlayers.push(res);
          }
          
          await delay(200); // Tiny delay between batches
        }

        preloadedTeams.push({
          id: team.id,
          name: team.name,
          sofifaLeagueId: league.id,
          players: teamPlayers
        });

        // Save progress locally in case of crash
        fs.writeFileSync(DATA_FILE, JSON.stringify(preloadedTeams, null, 2));
      }
      } // end leaguesToScrape loop
    } catch (e) {
      console.error('Scraping error:', e.message);
    } finally {
      if (context) await context.close();
    }
  }

  if (preloadedTeams.length === 0) {
    console.log('⚠️ No teams collected. Exiting.');
    return;
  }

  console.log(`\n🚀 Sending ${preloadedTeams.length} teams to sync route...`);

  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ preloadedTeams }),
    });

    if (res.ok) {
      console.log('✅ Sync route processed data successfully.');
      // Keep DATA_FILE as a backup
    } else {
      const errText = await res.text();
      console.error(`❌ Sync route failed: ${res.status} ${errText}`);
      console.log(`💡 You can retry just the sending part by running: node playwright-sofifa.js --send-only`);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
    console.log(`💡 You can retry just the sending part by running: node playwright-sofifa.js --send-only`);
  }
})();

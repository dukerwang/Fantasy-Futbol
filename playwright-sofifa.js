/**
 * Fetches PL squad + position + role data from sofifa.com using a real browser
 * (bypasses Cloudflare API block by scraping HTML), then POSTs it to the local sync route.
 *
 * Usage:
 *   node playwright-sofifa.js
 *   node playwright-sofifa.js --send-only
 *
 * Requires the dev server to be running on localhost:3000.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const SOFIFA_BASE = 'https://sofifa.com';
const SYNC_URL = 'http://localhost:3000/api/sync/sofifa-players';
const DATA_FILE = 'scraped-sofifa.json';

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
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      console.log('Loading sofifa.com to establish session...');
      await page.goto(SOFIFA_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(2000);

      console.log('Fetching Premier League teams...');
      await page.goto(`${SOFIFA_BASE}/teams?lg=13`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      const teamsData = await page.evaluate(() => {
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

      console.log(`Found ${teamsData.length} teams. Starting extraction...`);

      for (let i = 0; i < teamsData.length; i++) {
        const team = teamsData[i];
        console.log(`\n[${i + 1}/${teamsData.length}] Roster for ${team.name} (ID: ${team.id})...`);
        
        await page.goto(`${SOFIFA_BASE}${team.href}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(1500);

        const playerLinks = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr'));
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
        });

        const teamPlayers = [];
        const BATCH_SIZE = 5;

        for (let j = 0; j < playerLinks.length; j += BATCH_SIZE) {
          const batch = playerLinks.slice(j, j + BATCH_SIZE);
          
          const batchResults = await Promise.all(batch.map(async (pLink) => {
            const widePositions = ['LM', 'RM', 'LB', 'RB', 'LWB', 'RWB'];
            const needsRoles = pLink.positions.some(p => widePositions.includes(p));
            
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

            // If we need roles, visit the page
            const playerPage = await context.newPage();
            try {
              await playerPage.goto(`${SOFIFA_BASE}${pLink.href}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
              const details = await playerPage.evaluate(() => {
                const fullName = document.querySelector('h1')?.innerText.trim() || '';
                const bodyText = document.body.innerText;
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
              });

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
            } finally {
              await playerPage.close();
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
          players: teamPlayers
        });

        // Save progress locally in case of crash
        fs.writeFileSync(DATA_FILE, JSON.stringify(preloadedTeams, null, 2));
      }
    } catch (e) {
      console.error('Scraping error:', e.message);
    } finally {
      await browser.close();
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

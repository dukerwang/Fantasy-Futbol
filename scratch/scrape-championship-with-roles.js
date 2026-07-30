/**
 * Same scraping approach as playwright-sofifa.js (full detail incl. roles,
 * needed for the FB+Mid-no-Wing wingback/fullback disambiguation) but against
 * SoFIFA's Championship grouping (lg=14), which is where Hull/Ipswich/Coventry
 * still live in SoFIFA's own classification. Saves to a separate file; does
 * NOT send to the sync route itself (see send-championship-and-pl.js).
 */
const { chromium } = require('playwright');
const fs = require('fs');

const SOFIFA_BASE = 'https://sofifa.com';
const DATA_FILE = 'scraped-championship.json';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let preloadedTeams = [];
  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('Loading sofifa.com to establish session...');
    await page.goto(SOFIFA_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(2000);

    console.log('Fetching Championship teams (lg=14)...');
    await page.goto(`${SOFIFA_BASE}/teams?lg=14`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('table tbody tr a[href^="/team/"]', { timeout: 15000 }).catch(() => {});

    const teamsData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('table tbody tr a[href^="/team/"]'));
      const unique = []; const seen = new Set();
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

    // Only the 3 clubs we actually care about — no need to drag through 22 others.
    const OF_INTEREST = ['Coventry City', 'Ipswich Town', 'Hull City'];
    const targetTeams = teamsData.filter(t => OF_INTEREST.includes(t.name));
    console.log(`Found ${teamsData.length} Championship teams; scraping ${targetTeams.length} of interest:`, targetTeams.map(t => t.name));

    for (let i = 0; i < targetTeams.length; i++) {
      const team = targetTeams[i];
      console.log(`\n[${i + 1}/${targetTeams.length}] Roster for ${team.name} (ID: ${team.id})...`);
      await delay(2000);

      const playerLinks = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = Array.from(doc.querySelectorAll('table tbody tr'));
        const unique = []; const seen = new Set();
        for (const row of rows) {
          const a = row.querySelector('a[href^="/player/"]');
          if (!a) continue;
          const href = a.getAttribute('href');
          const name = a.innerText.trim();
          if (name && !seen.has(href)) {
            seen.add(href);
            const id = parseInt(href.split('/')[2]);
            const posEls = row.querySelectorAll('span.pos');
            const rawPositions = Array.from(posEls).map(el => el.innerText.trim());
            const cleanedPositions = rawPositions.filter(p => !['SUB', 'RES'].includes(p));
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

          const slug = pLink.href.split('/')[3] || '';
          const slugName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          if (!needsRoles) {
            return { id: pLink.id, commonName: pLink.commonName, fullName: slugName, positions: pLink.positions, roles: [] };
          }

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
                  if (['Layout', 'Attacking', 'Skill', 'Movement', 'Power', 'Mentality', 'Defending', 'Goalkeeping'].includes(line)) break;
                  const positionsToSkip = ['GK','Goalkeeper','CB','Centre Back','Center Back','LB','Left Back','RB','Right Back','LWB','Left Wing Back','RWB','Right Wing Back','CDM','Central Defensive Midfielder','CM','Central Midfielder','CAM','Central Attacking Midfielder','LM','Left Midfielder','RM','Right Midfielder','LW','Left Winger','RW','Right Winger','ST','Striker','CF','Center Forward','SUB','RES','Substitutes','Reserves'];
                  if (positionsToSkip.includes(line)) continue;
                  if (['Attack','Balanced','Roaming','Defend','Overlap','Inverted','Stay Wide'].includes(line)) continue;
                  roles.push(line);
                }
              }
              return { fullName, roles: Array.from(new Set(roles)) };
            }, `${SOFIFA_BASE}${pLink.href}`);
            return { id: pLink.id, commonName: pLink.commonName, fullName: details.fullName || slugName, positions: pLink.positions, roles: details.roles };
          } catch (err) {
            console.error(`\n      Error fetching ${pLink.commonName}: ${err.message}`);
            return { id: pLink.id, commonName: pLink.commonName, fullName: slugName, positions: pLink.positions, roles: [] };
          }
        }));

        for (const res of batchResults) {
          console.log(`    (${teamPlayers.length + 1}/${playerLinks.length}) ${res.commonName} [${res.positions.join(', ')}] Roles: ${res.roles.length > 0 ? res.roles.join(' | ') : 'None'}`);
          teamPlayers.push(res);
        }
        await delay(200);
      }

      preloadedTeams.push({ id: team.id, name: team.name, players: teamPlayers });
      fs.writeFileSync(DATA_FILE, JSON.stringify(preloadedTeams, null, 2));
    }
    console.log(`\nSaved ${preloadedTeams.length} teams to ${DATA_FILE}`);
  } catch (e) {
    console.error('Scraping error:', e.message);
  } finally {
    await context.close();
  }
})();

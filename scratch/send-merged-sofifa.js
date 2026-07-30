const fs = require('fs');

const pl = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));
const champ = JSON.parse(fs.readFileSync('scraped-championship.json', 'utf8'));
const merged = [...pl, ...champ];

let CRON_SECRET = 'change-me-to-a-random-secret';
try {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  const match = envFile.match(/CRON_SECRET=([^\n]+)/);
  if (match) CRON_SECRET = match[1].trim();
} catch (e) {}

(async () => {
  console.log(`Sending ${merged.length} teams (${pl.length} PL + ${champ.length} Championship) to sync route...`);
  const res = await fetch('http://localhost:3000/api/sync/sofifa-players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify({ preloadedTeams: merged }),
  });
  const text = await res.text();
  console.log(res.status, text);
})();

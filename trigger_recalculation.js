const https = require('https');

const VERCEL_URL = 'https://fantasy-futbol-tau.vercel.app/api/sync/stats';
const CRON_SECRET = 'irenie_beanie';

function queryApi(urlPath) {
    return new Promise((resolve, reject) => {
        let body = '';
        https.get(urlPath, { headers: { 'User-Agent': 'FF' } }, (res) => {
            res.on('data', d => body += d);
            res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
    });
}

function triggerNextApi(gw) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${VERCEL_URL}?mode=fpl_live&gw=${gw}`);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CRON_SECRET}`,
                'Content-Length': 0
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    console.error(`Error GW ${gw} [${res.statusCode}]: ${body}`);
                    resolve(null);
                } else {
                    try {
                        resolve(JSON.parse(body));
                    } catch(e) {
                        resolve(body);
                    }
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    console.log("Fetching FPL Bootstrap to determine current Gameweek...");
    const bootstrap = await queryApi('https://fantasy.premierleague.com/api/bootstrap-static/');
    let maxGw = 0;
    const now = new Date();
    for (const ev of bootstrap.events) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            maxGw = Math.max(maxGw, ev.id);
        }
    }
    
    console.log(`Max Gameweek is ${maxGw}. Triggering NextJS API backfill for GW 1 to ${maxGw}...`);

    for (let gw = 1; gw <= maxGw; gw++) {
        console.log(`Triggering fpl_live sync for Gameweek ${gw}...`);
        const result = await triggerNextApi(gw);
        if (result) {
            console.log(`GW ${gw} success! Upserted ${result.saved} player stats.`);
        }
    }

    console.log("✅ Historical Gameweeks completely backfilled using new Sigmoid Engine.");
}

main().catch(console.error);

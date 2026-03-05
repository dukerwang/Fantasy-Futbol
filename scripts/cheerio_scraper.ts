import * as cheerio from 'cheerio';
import * as fs from 'fs';

const PREMIER_LEAGUE_URL = 'https://www.transfermarkt.us/premier-league/startseite/wettbewerb/GB1';

async function fetchHtml(url: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            if (res.status === 403) {
                console.log(`403 on ${url}, waiting 2s...`);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            return await res.text();
        } catch (e) {
            console.warn(`Retry ${i} failed for ${url}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw new Error(`Failed to fetch ${url}`);
}

async function run() {
    console.log('Fetching Premier League Clubs...');
    const plHtml = await fetchHtml(PREMIER_LEAGUE_URL);
    const $pl = cheerio.load(plHtml);

    const clubs: { name: string, url: string }[] = [];

    $pl('table.items tbody tr').each((_, el) => {
        const a = $pl(el).find('td.hauptlink nobr a');
        if (a.length) {
            const name = a.attr('title') || a.text().trim();
            const href = a.attr('href');
            if (name && href) {
                // Transform to detailed squad view
                const squadUrl = `https://www.transfermarkt.us${href.replace('spielplan', 'kader')}/plus/1`;
                clubs.push({ name, url: squadUrl });
            }
        }
    });

    // Fallback selector for clubs
    if (clubs.length === 0) {
        $pl('td.hauptlink a').each((_, el) => {
            const href = $pl(el).attr('href');
            if (href && href.includes('spielplan/verein')) {
                const name = $pl(el).attr('title') || $pl(el).text().trim();
                const squadUrl = `https://www.transfermarkt.us${href.replace('spielplan', 'kader')}/plus/1`;
                if (!clubs.some(c => c.url === squadUrl)) {
                    clubs.push({ name, url: squadUrl });
                }
            }
        });
    }

    console.log(`Found ${clubs.length} clubs`);

    const players: { player_name: string, market_value_raw: string, club_name: string }[] = [];

    for (const club of clubs) {
        console.log(`Fetching squad for ${club.name}...`);
        try {
            const squadHtml = await fetchHtml(club.url);
            const $squad = cheerio.load(squadHtml);

            $squad('table.items tbody tr.odd, table.items tbody tr.even').each((_, tr) => {
                // Name is usually in a td.hauptlink -> table -> tbody -> tr -> td's (it's nested)
                // Look for the main player name link
                const nameLink = $squad(tr).find('td.posrela table tbody tr td.hauptlink a');
                const playerName = nameLink.text().trim() || $squad(tr).find('.hide-for-small a').text().trim();

                // Value is usually in the last column or specific class
                const valueText = $squad(tr).find('.rechts.hauptlink').text().trim() || $squad(tr).find('td.rechts a').text().trim();

                if (playerName && valueText) {
                    players.push({
                        player_name: playerName,
                        market_value_raw: valueText,
                        club_name: club.name
                    });
                }
            });
            await new Promise(r => setTimeout(r, 1000)); // Respectful delay
        } catch (e: any) {
            console.error(`Error fetching ${club.name}:`, e.message);
        }
    }

    console.log(`Scraped ${players.length} players. Writing to players.json...`);
    fs.writeFileSync('players.json', JSON.stringify(players, null, 2));
}

run().catch(console.error);

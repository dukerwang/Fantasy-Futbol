const cheerio = require('cheerio');

async function testTmLive() {
  console.log('Fetching live Premier League page from Transfermarkt...');
  try {
    const res = await fetch('https://www.transfermarkt.com/premier-league/startseite/wettbewerb/GB1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    console.log('Transfermarkt response status:', res.status);
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const clubs = [];
      $('table.items tbody tr').each((_, el) => {
        const name = $(el).find('td.hauptlink a').text().trim();
        const href = $(el).find('td.hauptlink a').attr('href');
        const val = $(el).find('td.rechts.hauptlink').text().trim();
        if (name && href) {
          clubs.push({ name, href, val });
        }
      });
      console.log(`Found ${clubs.length} clubs on Transfermarkt live:`, clubs.slice(0, 5));
    }
  } catch (err) {
    console.error('TM Live error:', err.message);
  }
}

testTmLive();

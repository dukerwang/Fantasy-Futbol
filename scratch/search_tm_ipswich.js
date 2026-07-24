const cheerio = require('cheerio');

async function searchIpswich() {
  const res = await fetch('https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=Ipswich', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  $('td.hauptlink a').each((_, a) => {
    console.log($(a).text().trim(), '->', $(a).attr('href'));
  });
}

searchIpswich();

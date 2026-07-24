async function testCdnFormats() {
  const codes = ['448104.png', '97032.png', '223094.png', '510281.png', '199796.png'];

  for (const code of codes) {
    const u1 = `https://resources.premierleague.com/premierleague/photos/players/250x250/${code}`;
    const u2 = `https://resources.premierleague.com/premierleague/photos/players/110x140/${code}`;
    const u3 = `https://resources.premierleague.com/premierleague25/photos/players/250x250/${code}`;

    const r1 = await fetch(u1, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const r2 = await fetch(u2, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const r3 = await fetch(u3, { headers: { 'User-Agent': 'Mozilla/5.0' } });

    console.log(`${code}:`);
    console.log(`  1. premierleague/250x250/${code} -> HTTP ${r1.status}`);
    console.log(`  2. premierleague/110x140/${code} -> HTTP ${r2.status}`);
    console.log(`  3. premierleague25/250x250/${code} -> HTTP ${r3.status}`);
  }
}

testCdnFormats();
